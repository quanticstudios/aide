import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'

import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistedLayoutNode,
  PersistenceSnapshot,
  ProjectRecord,
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
  SurfaceLayoutRecord,
  UpdateProjectInput,
  UpdateWorkspaceInput,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../shared/persistence'
import type {
  PreviewNavStatus,
  PreviewTabSnapshot,
  WorkspacePreviewSnapshot,
} from '../shared/preview'

interface SqlProjectRow {
  created_at: string
  default_branch: string
  id: string
  name: string
  remote_url: string | null
  repo_root: string
  updated_at: string
}

interface SqlWorkspaceRow {
  branch_name: string
  created_at: string
  id: string
  name: string
  project_id: string
  updated_at: string
  window_id: string | null
  worktree_path: string
}

interface SqlAppStateRow {
  catalog_revision: number
  last_active_project_id: string | null
  last_active_pane_ids_by_surface: string
  last_active_workspace_ids_by_project: string
  last_active_surface_ids_by_workspace: string
  last_active_pane_ids_by_workspace: string
  last_active_workspace_id: string | null
}

interface SqlWorkspaceLayoutRow {
  nodes_json: string
  revision: number
  root_node_id: string
  workspace_id: string
}

interface SqlWorkspaceSurfaceStateRow {
  layouts_json: string
  revision: number
  surfaces_json: string
  workspace_id: string
}

interface SqlWorkspacePreviewStateRow {
  active_tab_id: string | null
  initialized: number
  revision: number
  tabs_json: string
  workspace_id: string
}

const MIGRATION_STRATEGY =
  'Ordered SQL migrations tracked with PRAGMA user_version.'

const LEGACY_SURFACE_SUFFIX = ':surface:legacy-root'

const PREVIEW_NAV_STATUSES = new Set<PreviewNavStatus>([
  'idle',
  'loading',
  'success',
  'load-failed',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePersistedJson(value: string, description: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new Error(`${description} is not valid JSON.`)
  }
}

function requireRecord(
  value: unknown,
  description: string,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${description} must be an object.`)
  }

  return value
}

function requireArray(value: unknown, description: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${description} must be an array.`)
  }

  return value
}

function requireString(value: unknown, description: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${description} must be a string.`)
  }

  return value
}

function requireNonEmptyString(value: unknown, description: string): string {
  const string = requireString(value, description)
  if (!string) {
    throw new Error(`${description} must not be empty.`)
  }

  return string
}

function requireNullableString(
  value: unknown,
  description: string,
): string | null {
  if (value === null || typeof value === 'string') {
    return value
  }

  throw new Error(`${description} must be a string or null.`)
}

function requireNonNegativeInteger(
  value: unknown,
  description: string,
): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${description} must be a non-negative integer.`)
  }

  return value as number
}

function requireBoolean(value: unknown, description: string): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`${description} must be a boolean.`)
  }

  return value
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        remote_url TEXT,
        default_branch TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        window_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_project_id
      ON workspaces(project_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_active_project_id TEXT,
        last_active_workspace_id TEXT,
        last_active_workspace_ids_by_project TEXT NOT NULL DEFAULT '{}',
        last_active_pane_ids_by_workspace TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      INSERT INTO app_state (id, last_active_project_id, last_active_workspace_id, last_active_workspace_ids_by_project, last_active_pane_ids_by_workspace, updated_at)
      VALUES (1, NULL, NULL, '{}', '{}', CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE app_state ADD COLUMN last_active_workspace_ids_by_project TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE app_state ADD COLUMN last_active_pane_ids_by_workspace TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_layouts (
        workspace_id TEXT PRIMARY KEY,
        root_node_id TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_surface_states (
        workspace_id TEXT PRIMARY KEY,
        surfaces_json TEXT NOT NULL,
        layouts_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      ALTER TABLE app_state ADD COLUMN last_active_surface_ids_by_workspace TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE app_state ADD COLUMN last_active_pane_ids_by_surface TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE app_state ADD COLUMN catalog_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_layouts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_surface_states ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS workspace_preview_states (
        workspace_id TEXT PRIMARY KEY,
        active_tab_id TEXT,
        initialized INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        tabs_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workspace_activity_visits (
        workspace_id TEXT PRIMARY KEY,
        processed_through TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
]

export const AIDE_DATABASE_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1].version

export function createAideDatabase(databasePath: string): AideDatabase {
  return new AideDatabase(databasePath)
}

export class AideDatabase {
  private readonly database: DatabaseSync

  public constructor(private readonly databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    try {
      this.database.exec('PRAGMA foreign_keys = ON;')
      this.runMigrations()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  public close(): void {
    this.database.close()
  }

  public getWorkspaceActivityVisitWatermarks(): Record<string, string> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, processed_through
          FROM workspace_activity_visits
        `,
      )
      .all() as unknown as Array<{
      processed_through: string
      workspace_id: string
    }>

    return Object.fromEntries(
      rows.map((row) => [row.workspace_id, row.processed_through]),
    )
  }

  public setWorkspaceActivityVisitWatermark(
    workspaceId: string,
    processedThrough: string,
  ): void {
    this.database
      .prepare(
        `
          INSERT INTO workspace_activity_visits (workspace_id, processed_through)
          VALUES (?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET processed_through = excluded.processed_through
        `,
      )
      .run(workspaceId, processedThrough)
  }

  public createProject(input: CreateProjectInput): ProjectRecord {
    const now = new Date().toISOString()
    const project: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      repoRoot: input.repoRoot,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      createdAt: now,
      updatedAt: now,
    }

    this.database
      .prepare(
        `
          INSERT INTO projects (id, name, repo_root, remote_url, default_branch, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        project.id,
        project.name,
        project.repoRoot,
        project.remoteUrl,
        project.defaultBranch,
        project.createdAt,
        project.updatedAt,
      )

    this.incrementCatalogRevision()

    return project
  }

  public deleteProject(projectId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM projects
          WHERE id = ?
        `,
      )
      .run(projectId) as { changes: number }

    if (result.changes > 0) {
      this.incrementCatalogRevision()
      return true
    }

    return false
  }

  public getProject(projectId: string): ProjectRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, name, repo_root, remote_url, default_branch, created_at, updated_at
          FROM projects
          WHERE id = ?
        `,
      )
      .get(projectId) as SqlProjectRow | undefined

    return row ? this.mapProjectRow(row) : null
  }

  public listProjects(): ProjectRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, name, repo_root, remote_url, default_branch, created_at, updated_at
          FROM projects
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all() as unknown as SqlProjectRow[]

    return rows.map((row) => this.mapProjectRow(row))
  }

  public findProjectByRepoRoot(repoRoot: string): ProjectRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, name, repo_root, remote_url, default_branch, created_at, updated_at
          FROM projects
          WHERE repo_root = ?
          LIMIT 1
        `,
      )
      .get(repoRoot) as SqlProjectRow | undefined

    return row ? this.mapProjectRow(row) : null
  }

  public updateProject(
    projectId: string,
    input: UpdateProjectInput,
  ): ProjectRecord | null {
    const existingProject = this.getProject(projectId)

    if (!existingProject) {
      return null
    }

    const updatedProject: ProjectRecord = {
      ...existingProject,
      defaultBranch: input.defaultBranch ?? existingProject.defaultBranch,
      name: input.name ?? existingProject.name,
      remoteUrl:
        input.remoteUrl !== undefined
          ? input.remoteUrl
          : existingProject.remoteUrl,
      repoRoot: input.repoRoot ?? existingProject.repoRoot,
      updatedAt: new Date().toISOString(),
    }

    this.database
      .prepare(
        `
          UPDATE projects
          SET name = ?, repo_root = ?, remote_url = ?, default_branch = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updatedProject.name,
        updatedProject.repoRoot,
        updatedProject.remoteUrl,
        updatedProject.defaultBranch,
        updatedProject.updatedAt,
        projectId,
      )

    this.incrementCatalogRevision()

    return this.getProject(projectId)
  }

  public createWorkspace(input: CreateWorkspaceInput): WorkspaceRecord {
    const now = new Date().toISOString()
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      projectId: input.projectId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      windowId: input.windowId,
      createdAt: now,
      updatedAt: now,
    }

    this.database
      .prepare(
        `
          INSERT INTO workspaces (id, project_id, name, branch_name, worktree_path, window_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        workspace.id,
        workspace.projectId,
        workspace.name,
        workspace.branchName,
        workspace.worktreePath,
        workspace.windowId,
        workspace.createdAt,
        workspace.updatedAt,
      )

    this.incrementCatalogRevision()

    return workspace
  }

  public deleteWorkspace(workspaceId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM workspaces
          WHERE id = ?
        `,
      )
      .run(workspaceId) as { changes: number }

    if (result.changes > 0) {
      this.incrementCatalogRevision()
      return true
    }

    return false
  }

  public getWorkspace(workspaceId: string): WorkspaceRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, project_id, name, branch_name, worktree_path, window_id, created_at, updated_at
          FROM workspaces
          WHERE id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceRow | undefined

    return row ? this.mapWorkspaceRow(row) : null
  }

  public listWorkspaces(): WorkspaceRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, project_id, name, branch_name, worktree_path, window_id, created_at, updated_at
          FROM workspaces
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceRow[]

    return rows.map((row) => this.mapWorkspaceRow(row))
  }

  public listProjectWorkspaces(projectId: string): WorkspaceRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, project_id, name, branch_name, worktree_path, window_id, created_at, updated_at
          FROM workspaces
          WHERE project_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(projectId) as unknown as SqlWorkspaceRow[]

    return rows.map((row) => this.mapWorkspaceRow(row))
  }

  public findWorkspaceByWorktreePath(
    projectId: string,
    worktreePath: string,
  ): WorkspaceRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, project_id, name, branch_name, worktree_path, window_id, created_at, updated_at
          FROM workspaces
          WHERE project_id = ? AND worktree_path = ?
          LIMIT 1
        `,
      )
      .get(projectId, worktreePath) as SqlWorkspaceRow | undefined

    return row ? this.mapWorkspaceRow(row) : null
  }

  public updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): WorkspaceRecord | null {
    const existingWorkspace = this.getWorkspace(workspaceId)

    if (!existingWorkspace) {
      return null
    }

    const updatedWorkspace: WorkspaceRecord = {
      ...existingWorkspace,
      branchName: input.branchName ?? existingWorkspace.branchName,
      name: input.name ?? existingWorkspace.name,
      projectId: input.projectId ?? existingWorkspace.projectId,
      windowId:
        input.windowId !== undefined
          ? input.windowId
          : existingWorkspace.windowId,
      worktreePath: input.worktreePath ?? existingWorkspace.worktreePath,
      updatedAt: new Date().toISOString(),
    }

    this.database
      .prepare(
        `
          UPDATE workspaces
          SET project_id = ?, name = ?, branch_name = ?, worktree_path = ?, window_id = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updatedWorkspace.projectId,
        updatedWorkspace.name,
        updatedWorkspace.branchName,
        updatedWorkspace.worktreePath,
        updatedWorkspace.windowId,
        updatedWorkspace.updatedAt,
        workspaceId,
      )

    this.incrementCatalogRevision()

    return this.getWorkspace(workspaceId)
  }

  public getSnapshot(): PersistenceSnapshot {
    const activeSelection = this.getActiveSelection()
    const workspaces = this.listWorkspaces()
    // Load every persisted JSON field during startup validation, including
    // preview state which is otherwise fetched lazily by the renderer.
    void this.getWorkspacePreviewStates()
    const legacyWorkspaceLayouts = this.listWorkspaceLayouts().reduce<
      Record<string, WorkspaceLayoutRecord>
    >((layouts, layout) => {
      layouts[layout.workspaceId] = layout
      return layouts
    }, {})
    const persistedSurfaceStateByWorkspace = new Map(
      this.listWorkspaceSurfaceStates().map((state) => [
        state.workspaceId,
        state,
      ]),
    )
    const workspaceSurfaces: Record<string, WorkspaceSurfaceRecord[]> = {}
    const workspaceLayoutRevisions: Record<string, number> = {}
    const workspaceSurfaceRevisions: Record<string, number> = {}
    const surfaceLayouts: Record<string, SurfaceLayoutRecord> = {}

    for (const workspace of workspaces) {
      const surfaceState =
        persistedSurfaceStateByWorkspace.get(workspace.id) ?? null

      if (surfaceState) {
        workspaceSurfaces[workspace.id] = surfaceState.surfaces
        workspaceLayoutRevisions[workspace.id] = surfaceState.revision
        workspaceSurfaceRevisions[workspace.id] = surfaceState.revision

        for (const layout of Object.values(surfaceState.layouts)) {
          surfaceLayouts[layout.surfaceId] = layout
        }

        continue
      }

      const legacyLayout = legacyWorkspaceLayouts[workspace.id]
      workspaceLayoutRevisions[workspace.id] = this.getWorkspaceLayoutRevision(
        workspace.id,
      )

      if (
        !legacyLayout ||
        !legacyLayout.rootNodeId ||
        legacyLayout.nodes.length === 0
      ) {
        workspaceSurfaces[workspace.id] = []
        continue
      }

      const legacySurfaceId = this.createLegacySurfaceId(workspace.id)
      workspaceSurfaces[workspace.id] = [
        {
          id: legacySurfaceId,
          orderIndex: 0,
          rootNodeId: legacyLayout.rootNodeId,
          title: workspace.name,
          workspaceId: workspace.id,
        },
      ]
      surfaceLayouts[legacySurfaceId] = {
        ...legacyLayout,
        surfaceId: legacySurfaceId,
      }
    }

    return {
      catalogRevision: this.getCatalogRevision(),
      databasePath: this.databasePath,
      lastActivePaneIdsBySurface: activeSelection.paneIdsBySurface ?? {},
      lastActivePaneIdsByWorkspace: activeSelection.paneIdsByWorkspace ?? {},
      lastActiveProjectId: activeSelection.projectId,
      lastActiveSurfaceIdsByWorkspace:
        activeSelection.surfaceIdsByWorkspace ?? {},
      lastActiveWorkspaceIdsByProject:
        activeSelection.workspaceIdsByProject ?? {},
      lastActiveWorkspaceId: activeSelection.workspaceId,
      migrationStrategy: MIGRATION_STRATEGY,
      schemaVersion: this.getSchemaVersion(),
      projects: this.listProjects(),
      surfaceLayouts,
      workspaceLayoutRevisions,
      workspaceLayouts: legacyWorkspaceLayouts,
      workspaceSurfaces,
      workspaceSurfaceRevisions,
      workspaces,
    }
  }

  public getWorkspaceLayout(workspaceId: string): WorkspaceLayoutRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, root_node_id, nodes_json, revision
          FROM workspace_layouts
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceLayoutRow | undefined

    return row ? this.mapWorkspaceLayoutRow(row) : null
  }

  public listWorkspaceLayouts(): WorkspaceLayoutRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, root_node_id, nodes_json, revision
          FROM workspace_layouts
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceLayoutRow[]

    return rows.map((row) => this.mapWorkspaceLayoutRow(row))
  }

  public saveWorkspaceLayout(
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ): WorkspaceLayoutRecord | null {
    if (!this.getWorkspace(workspaceId)) {
      return null
    }

    const layout = this.normalizeWorkspaceLayout(workspaceId, input)

    this.database
      .prepare(
        `
          INSERT INTO workspace_layouts (workspace_id, root_node_id, nodes_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            root_node_id = excluded.root_node_id,
            nodes_json = excluded.nodes_json,
            revision = workspace_layouts.revision + 1,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        layout.workspaceId,
        layout.rootNodeId,
        JSON.stringify(layout.nodes),
        new Date().toISOString(),
      )

    this.incrementCatalogRevision()
    return this.getWorkspaceLayout(workspaceId)
  }

  public saveWorkspaceSurfaceState(
    workspaceId: string,
    input: SaveWorkspaceSurfaceStateInput,
  ): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } | null {
    if (!this.getWorkspace(workspaceId)) {
      return null
    }

    const persistedInput = requireRecord(input, 'Workspace surface state')
    const surfaceInputs = requireArray(
      persistedInput.surfaces,
      'Workspace surfaces',
    )
    const layoutInputs = requireRecord(
      persistedInput.layouts,
      'Workspace surface layouts',
    )
    const surfaces = surfaceInputs
      .map((surface) => this.normalizeWorkspaceSurface(workspaceId, surface))
      .sort((left, right) => left.orderIndex - right.orderIndex)
    const layouts = surfaces.reduce<Record<string, SurfaceLayoutRecord>>(
      (acc, surface) => {
        const layoutInput = layoutInputs[surface.id]

        if (!layoutInput) {
          throw new Error('Each workspace surface requires a layout.')
        }

        const layout = {
          ...this.normalizeWorkspaceLayout(workspaceId, layoutInput),
          surfaceId: surface.id,
        }

        if (layout.rootNodeId !== surface.rootNodeId) {
          throw new Error(
            'Workspace surface root node id must match its layout root node id.',
          )
        }

        acc[surface.id] = layout
        return acc
      },
      {},
    )

    this.database
      .prepare(
        `
          INSERT INTO workspace_surface_states (workspace_id, surfaces_json, layouts_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            surfaces_json = excluded.surfaces_json,
            layouts_json = excluded.layouts_json,
            revision = workspace_surface_states.revision + 1,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        workspaceId,
        JSON.stringify(surfaces),
        JSON.stringify(layouts),
        new Date().toISOString(),
      )

    this.incrementCatalogRevision()
    return this.getWorkspaceSurfaceState(workspaceId)
  }

  public getWorkspacePreviewState(
    workspaceId: string,
  ): WorkspacePreviewSnapshot | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, active_tab_id, initialized, revision, tabs_json
          FROM workspace_preview_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspacePreviewStateRow | undefined

    return row ? this.mapWorkspacePreviewStateRow(row) : null
  }

  public getWorkspacePreviewStates(): Record<string, WorkspacePreviewSnapshot> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, active_tab_id, initialized, revision, tabs_json
          FROM workspace_preview_states
          ORDER BY updated_at ASC, workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspacePreviewStateRow[]

    return Object.fromEntries(
      rows.map((row) => {
        const snapshot = this.mapWorkspacePreviewStateRow(row)
        return [snapshot.workspaceId, snapshot]
      }),
    )
  }

  public saveWorkspacePreviewState(
    input: WorkspacePreviewSnapshot,
  ): WorkspacePreviewSnapshot | null {
    const snapshot = this.normalizeWorkspacePreviewState(input)
    if (!this.getWorkspace(snapshot.workspaceId)) {
      return null
    }

    this.database
      .prepare(
        `
          INSERT INTO workspace_preview_states (workspace_id, active_tab_id, initialized, revision, tabs_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            active_tab_id = excluded.active_tab_id,
            initialized = excluded.initialized,
            revision = excluded.revision,
            tabs_json = excluded.tabs_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        snapshot.workspaceId,
        snapshot.activeTabId,
        snapshot.initialized ? 1 : 0,
        snapshot.revision,
        JSON.stringify(snapshot.tabs),
        new Date().toISOString(),
      )

    return this.getWorkspacePreviewState(snapshot.workspaceId)
  }

  public setActiveSelection(input: SetActiveSelectionInput): void {
    const selection = this.normalizeActiveSelection(input)
    this.database
      .prepare(
        `
          UPDATE app_state
          SET last_active_project_id = ?, last_active_workspace_id = ?, last_active_workspace_ids_by_project = ?, last_active_pane_ids_by_workspace = ?, last_active_surface_ids_by_workspace = ?, last_active_pane_ids_by_surface = ?, updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        selection.projectId,
        selection.workspaceId,
        JSON.stringify(selection.workspaceIdsByProject),
        JSON.stringify(selection.paneIdsByWorkspace),
        JSON.stringify(selection.surfaceIdsByWorkspace),
        JSON.stringify(selection.paneIdsBySurface),
        new Date().toISOString(),
      )
  }

  private getSchemaVersion(): number {
    const row = this.database.prepare('PRAGMA user_version;').get() as {
      user_version: number
    }

    return row.user_version
  }

  private getCatalogRevision(): number {
    const row = this.database
      .prepare('SELECT catalog_revision FROM app_state WHERE id = 1')
      .get() as Pick<SqlAppStateRow, 'catalog_revision'> | undefined

    return row?.catalog_revision ?? 0
  }

  private incrementCatalogRevision(): void {
    this.database
      .prepare(
        'UPDATE app_state SET catalog_revision = catalog_revision + 1 WHERE id = 1',
      )
      .run()
  }

  private getActiveSelection(): SetActiveSelectionInput {
    const row = this.database
      .prepare(
        `
          SELECT last_active_project_id, last_active_workspace_id, last_active_workspace_ids_by_project, last_active_pane_ids_by_workspace, last_active_surface_ids_by_workspace, last_active_pane_ids_by_surface
          FROM app_state
          WHERE id = 1
        `,
      )
      .get() as SqlAppStateRow | undefined

    return this.normalizeActiveSelection({
      paneIdsBySurface: parsePersistedJson(
        row?.last_active_pane_ids_by_surface ?? '{}',
        'Active surface pane selection',
      ),
      paneIdsByWorkspace: parsePersistedJson(
        row?.last_active_pane_ids_by_workspace ?? '{}',
        'Active workspace pane selection',
      ),
      projectId: row?.last_active_project_id ?? null,
      surfaceIdsByWorkspace: parsePersistedJson(
        row?.last_active_surface_ids_by_workspace ?? '{}',
        'Active workspace surface selection',
      ),
      workspaceIdsByProject: parsePersistedJson(
        row?.last_active_workspace_ids_by_project ?? '{}',
        'Active project workspace selection',
      ),
      workspaceId: row?.last_active_workspace_id ?? null,
    })
  }

  private mapProjectRow(row: SqlProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      repoRoot: row.repo_root,
      remoteUrl: row.remote_url,
      defaultBranch: row.default_branch,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapWorkspaceRow(row: SqlWorkspaceRow): WorkspaceRecord {
    return {
      id: row.id,
      name: row.name,
      projectId: row.project_id,
      branchName: row.branch_name,
      worktreePath: row.worktree_path,
      windowId: row.window_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapWorkspaceLayoutRow(
    row: SqlWorkspaceLayoutRow,
  ): WorkspaceLayoutRecord {
    const parsedNodes = parsePersistedJson(
      row.nodes_json,
      'Workspace layout nodes',
    )

    return this.normalizeWorkspaceLayout(row.workspace_id, {
      nodes: parsedNodes,
      rootNodeId: row.root_node_id,
    })
  }

  private createLegacySurfaceId(workspaceId: string): string {
    return `${workspaceId}${LEGACY_SURFACE_SUFFIX}`
  }

  private getWorkspaceSurfaceState(workspaceId: string): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, surfaces_json, layouts_json, revision
          FROM workspace_surface_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceSurfaceStateRow | undefined

    return row ? this.mapWorkspaceSurfaceStateRow(row) : null
  }

  private getWorkspaceLayoutRevision(workspaceId: string): number {
    const row = this.database
      .prepare('SELECT revision FROM workspace_layouts WHERE workspace_id = ?')
      .get(workspaceId) as Pick<SqlWorkspaceLayoutRow, 'revision'> | undefined

    return row?.revision ?? 0
  }

  private listWorkspaceSurfaceStates(): Array<{
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  }> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, surfaces_json, layouts_json, revision
          FROM workspace_surface_states
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceSurfaceStateRow[]

    return rows.map((row) => this.mapWorkspaceSurfaceStateRow(row))
  }

  private mapWorkspaceSurfaceStateRow(row: SqlWorkspaceSurfaceStateRow): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } {
    const parsedSurfaces = requireArray(
      parsePersistedJson(row.surfaces_json, 'Workspace surfaces'),
      'Workspace surfaces',
    )
    const parsedLayouts = requireRecord(
      parsePersistedJson(row.layouts_json, 'Workspace surface layouts'),
      'Workspace surface layouts',
    )
    const layouts = Object.entries(parsedLayouts).reduce<
      Record<string, SurfaceLayoutRecord>
    >((acc, [surfaceId, layout]) => {
      acc[surfaceId] = {
        ...this.normalizeWorkspaceLayout(row.workspace_id, layout),
        surfaceId,
      }
      return acc
    }, {})
    const surfaces = parsedSurfaces.map((surface) =>
      this.normalizeWorkspaceSurface(row.workspace_id, surface),
    )
    const surfaceIds = new Set<string>()
    for (const surface of surfaces) {
      if (surfaceIds.has(surface.id)) {
        throw new Error('Workspace surfaces must have unique ids.')
      }
      surfaceIds.add(surface.id)

      const layout = layouts[surface.id]
      if (!layout || layout.rootNodeId !== surface.rootNodeId) {
        throw new Error('Each workspace surface requires a matching layout.')
      }
    }
    if (Object.keys(layouts).some((surfaceId) => !surfaceIds.has(surfaceId))) {
      throw new Error('Workspace surface layouts must belong to a surface.')
    }

    return {
      layouts,
      revision: requireNonNegativeInteger(
        row.revision,
        'Workspace surface revision',
      ),
      surfaces,
      workspaceId: row.workspace_id,
    }
  }

  private mapWorkspacePreviewStateRow(
    row: SqlWorkspacePreviewStateRow,
  ): WorkspacePreviewSnapshot {
    if (row.initialized !== 0 && row.initialized !== 1) {
      throw new Error('Workspace preview initialization must be 0 or 1.')
    }

    return this.normalizeWorkspacePreviewState({
      activeTabId: row.active_tab_id,
      initialized: row.initialized === 1,
      revision: row.revision,
      tabs: parsePersistedJson(row.tabs_json, 'Workspace preview tabs'),
      workspaceId: row.workspace_id,
    })
  }

  private normalizeActiveSelection(input: unknown): SetActiveSelectionInput {
    const selection = requireRecord(input, 'Active selection')
    const normalizeIdMap = (
      value: unknown,
      description: string,
    ): Record<string, string | null> => {
      const map = requireRecord(value ?? {}, description)
      return Object.fromEntries(
        Object.entries(map).map(([key, item]) => [
          key,
          requireNullableString(item, `${description} values`),
        ]),
      )
    }

    return {
      paneIdsBySurface: normalizeIdMap(
        selection.paneIdsBySurface,
        'Active surface pane selection',
      ),
      paneIdsByWorkspace: normalizeIdMap(
        selection.paneIdsByWorkspace,
        'Active workspace pane selection',
      ),
      projectId: requireNullableString(
        selection.projectId,
        'Active project id',
      ),
      surfaceIdsByWorkspace: normalizeIdMap(
        selection.surfaceIdsByWorkspace,
        'Active workspace surface selection',
      ),
      workspaceIdsByProject: normalizeIdMap(
        selection.workspaceIdsByProject,
        'Active project workspace selection',
      ),
      workspaceId: requireNullableString(
        selection.workspaceId,
        'Active workspace id',
      ),
    }
  }

  private normalizeWorkspacePreviewState(
    input: unknown,
  ): WorkspacePreviewSnapshot {
    const snapshot = requireRecord(input, 'Workspace preview state')
    const workspaceId = requireNonEmptyString(
      snapshot.workspaceId,
      'Workspace preview workspace id',
    )
    const tabs = requireArray(snapshot.tabs, 'Workspace preview tabs').map(
      (tab) => this.normalizeWorkspacePreviewTab(workspaceId, tab),
    )
    const tabIds = new Set(tabs.map((tab) => tab.id))
    if (tabIds.size !== tabs.length) {
      throw new Error('Workspace preview tabs must have unique ids.')
    }
    const activeTabId = requireNullableString(
      snapshot.activeTabId,
      'Workspace preview active tab id',
    )
    if (activeTabId !== null && !tabIds.has(activeTabId)) {
      throw new Error('Workspace preview active tab id must reference a tab.')
    }

    return {
      activeTabId,
      initialized: requireBoolean(
        snapshot.initialized,
        'Workspace preview initialization',
      ),
      revision: requireNonNegativeInteger(
        snapshot.revision,
        'Workspace preview revision',
      ),
      tabs,
      workspaceId,
    }
  }

  private normalizeWorkspacePreviewTab(
    workspaceId: string,
    input: unknown,
  ): PreviewTabSnapshot {
    const tab = requireRecord(input, 'Workspace preview tab')
    if (tab.workspaceId !== workspaceId) {
      throw new Error('Workspace preview tabs must belong to their workspace.')
    }
    if (!PREVIEW_NAV_STATUSES.has(tab.navStatus as PreviewNavStatus)) {
      throw new Error('Workspace preview tabs must have a supported status.')
    }

    return {
      canGoBack: requireBoolean(
        tab.canGoBack,
        'Workspace preview tab back navigation',
      ),
      canGoForward: requireBoolean(
        tab.canGoForward,
        'Workspace preview tab forward navigation',
      ),
      error: requireNullableString(tab.error, 'Workspace preview tab error'),
      id: requireNonEmptyString(tab.id, 'Workspace preview tab id'),
      label: requireString(tab.label, 'Workspace preview tab label'),
      navStatus: tab.navStatus as PreviewNavStatus,
      title: requireNullableString(tab.title, 'Workspace preview tab title'),
      updatedAt: requireString(
        tab.updatedAt,
        'Workspace preview tab update time',
      ),
      url: requireString(tab.url, 'Workspace preview tab URL'),
      workspaceId,
    }
  }

  private normalizeWorkspaceLayout(
    workspaceId: string,
    input: unknown,
  ): WorkspaceLayoutRecord {
    const layout = requireRecord(input, 'Workspace layout')
    const rootNodeId = requireNonEmptyString(
      layout.rootNodeId,
      'Workspace layout root node id',
    )
    const inputNodes = requireArray(layout.nodes, 'Workspace layout nodes')
    if (inputNodes.length === 0) {
      throw new Error('Workspace layouts require at least one layout node.')
    }

    const nodes = inputNodes.map((node) =>
      this.normalizeLayoutNode(workspaceId, node),
    )
    const nodesById = new Map(nodes.map((node) => [node.id, node]))
    if (nodesById.size !== nodes.length) {
      throw new Error('Workspace layout nodes must have unique ids.')
    }

    if (!nodesById.has(rootNodeId)) {
      throw new Error('Workspace layout root node must exist in the node list.')
    }
    if (nodesById.get(rootNodeId)?.parentId !== null) {
      throw new Error('Workspace layout root node cannot have a parent.')
    }

    for (const node of nodes) {
      if (node.parentId !== null && !nodesById.has(node.parentId)) {
        throw new Error('Workspace layout node parents must exist.')
      }
      if (node.type === 'pane') {
        continue
      }

      for (const childId of node.children) {
        const child = nodesById.get(childId)
        if (!child || child.parentId !== node.id) {
          throw new Error('Workspace layout children must match their parent.')
        }
      }
    }

    const reachableNodeIds = new Set<string>()
    const visit = (nodeId: string): void => {
      if (reachableNodeIds.has(nodeId)) {
        throw new Error('Workspace layout nodes must form a tree.')
      }
      reachableNodeIds.add(nodeId)
      const node = nodesById.get(nodeId)
      if (node?.type !== 'pane') {
        node?.children.forEach(visit)
      }
    }
    visit(rootNodeId)
    if (reachableNodeIds.size !== nodes.length) {
      throw new Error('Workspace layout nodes must be reachable from the root.')
    }

    return {
      nodes,
      rootNodeId,
      workspaceId,
    }
  }

  private normalizeWorkspaceSurface(
    workspaceId: string,
    input: unknown,
  ): WorkspaceSurfaceRecord {
    const surface = requireRecord(input, 'Workspace surface')
    if (surface.workspaceId !== workspaceId) {
      throw new Error(
        'Workspace surfaces must belong to the workspace being saved.',
      )
    }

    const id = requireNonEmptyString(surface.id, 'Workspace surface id')
    const rootNodeId = requireNonEmptyString(
      surface.rootNodeId,
      'Workspace surface root node id',
    )
    const orderIndex = requireNonNegativeInteger(
      surface.orderIndex,
      'Workspace surface order index',
    )
    const title = requireString(surface.title, 'Workspace surface title')

    return {
      id,
      orderIndex,
      rootNodeId,
      title: title.trim() || 'Pane',
      workspaceId,
    }
  }

  private normalizeLayoutNode(
    workspaceId: string,
    input: unknown,
  ): PersistedLayoutNode {
    const node = requireRecord(input, 'Workspace layout node')
    if (node.workspaceId !== workspaceId) {
      throw new Error('Layout nodes must belong to the workspace being saved.')
    }

    const id = requireNonEmptyString(node.id, 'Workspace layout node id')
    const parentId = requireNullableString(
      node.parentId,
      'Workspace layout node parent id',
    )
    const children = requireArray(
      node.children,
      'Workspace layout node children',
    )
    const sizeWeights = requireArray(
      node.sizeWeights,
      'Workspace layout node weights',
    )
    if (!children.every((childId) => typeof childId === 'string' && childId)) {
      throw new Error('Workspace layout node children must be non-empty ids.')
    }
    if (
      !sizeWeights.every(
        (weight) =>
          typeof weight === 'number' && Number.isFinite(weight) && weight >= 0,
      )
    ) {
      throw new Error('Workspace layout node weights must be finite numbers.')
    }

    if (node.type === 'pane') {
      if (children.length > 0 || sizeWeights.length > 0) {
        throw new Error('Pane layout nodes cannot declare children or weights.')
      }

      const paneId = requireNonEmptyString(node.paneId, 'Pane layout node id')
      const viewIds = requireArray(node.viewIds, 'Pane layout node views')
      if (
        viewIds.length === 0 ||
        !viewIds.every((viewId) => typeof viewId === 'string' && viewId)
      ) {
        throw new Error('Pane layout nodes require non-empty view ids.')
      }
      const activeViewIndex = requireNonNegativeInteger(
        node.activeViewIndex,
        'Pane layout active view index',
      )
      if (activeViewIndex >= viewIds.length) {
        throw new Error('Pane layout active view index must reference a view.')
      }

      return {
        activeViewIndex,
        children: [],
        id,
        paneId,
        parentId,
        sizeWeights: [],
        type: 'pane',
        viewIds: viewIds as string[],
        workspaceId,
      }
    }

    if (node.type !== 'split-horizontal' && node.type !== 'split-vertical') {
      throw new Error('Workspace layout nodes must have a supported type.')
    }
    if (node.paneId !== null) {
      throw new Error('Split layout nodes cannot declare a pane id.')
    }

    if (children.length !== sizeWeights.length) {
      throw new Error(
        'Split layout nodes must keep children and weight counts aligned.',
      )
    }

    return {
      children: children as string[],
      id,
      paneId: null,
      parentId,
      sizeWeights: sizeWeights as number[],
      type: node.type,
      workspaceId,
    }
  }

  private runMigrations(): void {
    const currentVersion = this.getSchemaVersion()
    const pendingMigrations = MIGRATIONS.filter(
      (migration) => migration.version > currentVersion,
    )

    for (const migration of pendingMigrations) {
      this.database.exec('BEGIN IMMEDIATE;')
      try {
        for (const statement of migration.sql.split(';')) {
          if (statement.trim().length === 0) {
            continue
          }

          try {
            this.database.exec(statement)
          } catch (error) {
            if (
              error instanceof Error &&
              error.message.includes('duplicate column name')
            ) {
              // Existing local databases can have a column before its version.
              continue
            }

            throw error
          }
        }
        this.database.exec(`PRAGMA user_version = ${migration.version};`)
        this.database.exec('COMMIT;')
      } catch (error) {
        this.database.exec('ROLLBACK;')
        throw error
      }
    }
  }
}
