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
import type { WorkspacePreviewSnapshot } from '../shared/preview'
import type {
  WorkspaceSetupSnapshot,
  WorkspaceSetupStatus,
} from '../shared/workspace-setup'

interface SqlProjectRow {
  created_at: string
  default_branch: string
  id: string
  name: string
  remote_url: string | null
  repo_root: string
  setup_command: string | null
  updated_at: string
  worktree_setup_revision: number
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
  workspace_setup_revision: number
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

interface SqlWorkspaceSetupStateRow {
  attempt: number
  ended_at: string | null
  error_summary: string | null
  exit_code: number | null
  output_byte_length: number
  output_line_count: number
  output_tail: string
  output_truncated: number
  project_setup_revision: number
  revision: number
  signal: string | null
  started_at: string | null
  state: WorkspaceSetupStatus
  updated_at: string
  workspace_id: string
}

const MIGRATION_STRATEGY =
  'Ordered SQL migrations tracked with PRAGMA user_version.'

const LEGACY_SURFACE_SUFFIX = ':surface:legacy-root'

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
  {
    version: 7,
    sql: `
      ALTER TABLE projects ADD COLUMN setup_command TEXT;
      ALTER TABLE projects ADD COLUMN worktree_setup_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE app_state ADD COLUMN workspace_setup_revision INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS workspace_setup_states (
        workspace_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        project_setup_revision INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        signal TEXT,
        error_summary TEXT,
        output_tail TEXT NOT NULL DEFAULT '',
        output_byte_length INTEGER NOT NULL DEFAULT 0,
        output_line_count INTEGER NOT NULL DEFAULT 0,
        output_truncated INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
]

export function createAideDatabase(databasePath: string): AideDatabase {
  return new AideDatabase(databasePath)
}

export class AideDatabase {
  private readonly database: DatabaseSync

  public constructor(private readonly databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    this.database.exec('PRAGMA foreign_keys = ON;')
    this.runMigrations()
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

  public getWorkspaceSetupRevision(): number {
    const row = this.database
      .prepare('SELECT workspace_setup_revision FROM app_state WHERE id = 1')
      .get() as Pick<SqlAppStateRow, 'workspace_setup_revision'> | undefined

    return row?.workspace_setup_revision ?? 0
  }

  public getWorkspaceSetupState(
    workspaceId: string,
  ): WorkspaceSetupSnapshot | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, state, attempt, project_setup_revision, started_at,
                 ended_at, exit_code, signal, error_summary, output_tail,
                 output_byte_length, output_line_count, output_truncated,
                 revision, updated_at
          FROM workspace_setup_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceSetupStateRow | undefined

    return row ? this.mapWorkspaceSetupStateRow(row) : null
  }

  public getWorkspaceSetupStates(): Record<string, WorkspaceSetupSnapshot> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, state, attempt, project_setup_revision, started_at,
                 ended_at, exit_code, signal, error_summary, output_tail,
                 output_byte_length, output_line_count, output_truncated,
                 revision, updated_at
          FROM workspace_setup_states
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceSetupStateRow[]

    return Object.fromEntries(
      rows.map((row) => {
        const snapshot = this.mapWorkspaceSetupStateRow(row)
        return [snapshot.workspaceId, snapshot]
      }),
    )
  }

  public saveWorkspaceSetupState(
    input: WorkspaceSetupSnapshot,
  ): WorkspaceSetupSnapshot | null {
    if (!this.getWorkspace(input.workspaceId)) {
      return null
    }

    const revision = this.incrementWorkspaceSetupRevision()
    const updatedAt = new Date().toISOString()

    this.database
      .prepare(
        `
          INSERT INTO workspace_setup_states (
            workspace_id, state, attempt, project_setup_revision, started_at,
            ended_at, exit_code, signal, error_summary, output_tail,
            output_byte_length, output_line_count, output_truncated, revision,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            state = excluded.state,
            attempt = excluded.attempt,
            project_setup_revision = excluded.project_setup_revision,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            exit_code = excluded.exit_code,
            signal = excluded.signal,
            error_summary = excluded.error_summary,
            output_tail = excluded.output_tail,
            output_byte_length = excluded.output_byte_length,
            output_line_count = excluded.output_line_count,
            output_truncated = excluded.output_truncated,
            revision = excluded.revision,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.workspaceId,
        input.state,
        input.attempt,
        input.projectSetupRevision,
        input.startedAt,
        input.endedAt,
        input.exitCode,
        input.signal,
        input.errorSummary,
        input.outputTail,
        input.outputByteLength,
        input.outputLineCount,
        input.outputTruncated ? 1 : 0,
        revision,
        updatedAt,
      )

    return this.getWorkspaceSetupState(input.workspaceId)
  }

  public reconcileInterruptedWorkspaceSetups(): WorkspaceSetupSnapshot[] {
    const running = Object.values(this.getWorkspaceSetupStates()).filter(
      (setup) => setup.state === 'queued' || setup.state === 'running',
    )

    return running.flatMap((setup) => {
      const updated = this.saveWorkspaceSetupState({
        ...setup,
        endedAt: new Date().toISOString(),
        errorSummary: 'Setup was interrupted when Aide closed.',
        state: 'failed',
      })
      return updated ? [updated] : []
    })
  }

  public createProject(input: CreateProjectInput): ProjectRecord {
    const now = new Date().toISOString()
    const project: ProjectRecord = {
      id: randomUUID(),
      name: input.name,
      repoRoot: input.repoRoot,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      setupCommand: null,
      worktreeSetupRevision: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.database
      .prepare(
        `
          INSERT INTO projects (id, name, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        project.id,
        project.name,
        project.repoRoot,
        project.remoteUrl,
        project.defaultBranch,
        project.setupCommand,
        project.worktreeSetupRevision,
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
          SELECT id, name, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
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
          SELECT id, name, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
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
          SELECT id, name, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
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
      setupCommand:
        input.setupCommand !== undefined
          ? input.setupCommand
          : existingProject.setupCommand,
      worktreeSetupRevision:
        input.setupCommand !== undefined &&
        input.setupCommand !== existingProject.setupCommand
          ? existingProject.worktreeSetupRevision + 1
          : existingProject.worktreeSetupRevision,
      updatedAt: new Date().toISOString(),
    }

    this.database
      .prepare(
        `
          UPDATE projects
          SET name = ?, repo_root = ?, remote_url = ?, default_branch = ?, setup_command = ?, worktree_setup_revision = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updatedProject.name,
        updatedProject.repoRoot,
        updatedProject.remoteUrl,
        updatedProject.defaultBranch,
        updatedProject.setupCommand,
        updatedProject.worktreeSetupRevision,
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

    const surfaces = [...input.surfaces]
      .map((surface) => this.normalizeWorkspaceSurface(workspaceId, surface))
      .sort((left, right) => left.orderIndex - right.orderIndex)
    const layouts = surfaces.reduce<Record<string, SurfaceLayoutRecord>>(
      (acc, surface) => {
        const layoutInput = input.layouts[surface.id]

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
    if (!this.getWorkspace(input.workspaceId)) {
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
        input.workspaceId,
        input.activeTabId,
        input.initialized ? 1 : 0,
        input.revision,
        JSON.stringify(input.tabs),
        new Date().toISOString(),
      )

    return this.getWorkspacePreviewState(input.workspaceId)
  }

  public setActiveSelection(input: SetActiveSelectionInput): void {
    this.database
      .prepare(
        `
          UPDATE app_state
          SET last_active_project_id = ?, last_active_workspace_id = ?, last_active_workspace_ids_by_project = ?, last_active_pane_ids_by_workspace = ?, last_active_surface_ids_by_workspace = ?, last_active_pane_ids_by_surface = ?, updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        input.projectId,
        input.workspaceId,
        JSON.stringify(input.workspaceIdsByProject ?? {}),
        JSON.stringify(input.paneIdsByWorkspace ?? {}),
        JSON.stringify(input.surfaceIdsByWorkspace ?? {}),
        JSON.stringify(input.paneIdsBySurface ?? {}),
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

  private incrementWorkspaceSetupRevision(): number {
    this.database
      .prepare(
        'UPDATE app_state SET workspace_setup_revision = workspace_setup_revision + 1 WHERE id = 1',
      )
      .run()

    return this.getWorkspaceSetupRevision()
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

    return {
      paneIdsBySurface: row?.last_active_pane_ids_by_surface
        ? JSON.parse(row.last_active_pane_ids_by_surface)
        : {},
      paneIdsByWorkspace: row?.last_active_pane_ids_by_workspace
        ? JSON.parse(row.last_active_pane_ids_by_workspace)
        : {},
      projectId: row?.last_active_project_id ?? null,
      surfaceIdsByWorkspace: row?.last_active_surface_ids_by_workspace
        ? JSON.parse(row.last_active_surface_ids_by_workspace)
        : {},
      workspaceIdsByProject: row?.last_active_workspace_ids_by_project
        ? JSON.parse(row.last_active_workspace_ids_by_project)
        : {},
      workspaceId: row?.last_active_workspace_id ?? null,
    }
  }

  private mapProjectRow(row: SqlProjectRow): ProjectRecord {
    return {
      id: row.id,
      name: row.name,
      repoRoot: row.repo_root,
      remoteUrl: row.remote_url,
      defaultBranch: row.default_branch,
      setupCommand: row.setup_command,
      worktreeSetupRevision: row.worktree_setup_revision,
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

  private mapWorkspaceSetupStateRow(
    row: SqlWorkspaceSetupStateRow,
  ): WorkspaceSetupSnapshot {
    return {
      attempt: row.attempt,
      commandRequired: false,
      endedAt: row.ended_at,
      errorSummary: row.error_summary,
      exitCode: row.exit_code,
      outputByteLength: row.output_byte_length,
      outputLineCount: row.output_line_count,
      outputTail: row.output_tail,
      outputTruncated: row.output_truncated === 1,
      projectSetupRevision: row.project_setup_revision,
      revision: row.revision,
      signal: row.signal,
      startedAt: row.started_at,
      state: row.state,
      updatedAt: row.updated_at,
      workspaceId: row.workspace_id,
    }
  }

  private mapWorkspaceLayoutRow(
    row: SqlWorkspaceLayoutRow,
  ): WorkspaceLayoutRecord {
    const parsedNodes = JSON.parse(row.nodes_json) as PersistedLayoutNode[]

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
    const parsedSurfaces = JSON.parse(
      row.surfaces_json,
    ) as WorkspaceSurfaceRecord[]
    const parsedLayouts = JSON.parse(row.layouts_json) as Record<
      string,
      SaveWorkspaceLayoutInput
    >

    return {
      layouts: Object.entries(parsedLayouts).reduce<
        Record<string, SurfaceLayoutRecord>
      >((acc, [surfaceId, layout]) => {
        acc[surfaceId] = {
          ...this.normalizeWorkspaceLayout(row.workspace_id, layout),
          surfaceId,
        }
        return acc
      }, {}),
      revision: row.revision,
      surfaces: parsedSurfaces.map((surface) =>
        this.normalizeWorkspaceSurface(row.workspace_id, surface),
      ),
      workspaceId: row.workspace_id,
    }
  }

  private mapWorkspacePreviewStateRow(
    row: SqlWorkspacePreviewStateRow,
  ): WorkspacePreviewSnapshot {
    return {
      activeTabId: row.active_tab_id,
      initialized: row.initialized === 1,
      revision: row.revision,
      tabs: JSON.parse(row.tabs_json),
      workspaceId: row.workspace_id,
    }
  }

  private normalizeWorkspaceLayout(
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ): WorkspaceLayoutRecord {
    if (!input.rootNodeId) {
      throw new Error('Workspace layouts require a root node id.')
    }

    if (input.nodes.length === 0) {
      throw new Error('Workspace layouts require at least one layout node.')
    }

    const nodes = input.nodes.map((node) =>
      this.normalizeLayoutNode(workspaceId, node),
    )

    if (!nodes.some((node) => node.id === input.rootNodeId)) {
      throw new Error('Workspace layout root node must exist in the node list.')
    }

    return {
      nodes,
      rootNodeId: input.rootNodeId,
      workspaceId,
    }
  }

  private normalizeWorkspaceSurface(
    workspaceId: string,
    surface: WorkspaceSurfaceRecord,
  ): WorkspaceSurfaceRecord {
    if (surface.workspaceId !== workspaceId) {
      throw new Error(
        'Workspace surfaces must belong to the workspace being saved.',
      )
    }

    if (!surface.id || !surface.rootNodeId) {
      throw new Error('Workspace surfaces require ids and root node ids.')
    }

    return {
      ...surface,
      orderIndex: Math.max(0, Math.trunc(surface.orderIndex)),
      title: surface.title.trim() || 'Pane',
    }
  }

  private normalizeLayoutNode(
    workspaceId: string,
    node: PersistedLayoutNode,
  ): PersistedLayoutNode {
    if (node.workspaceId !== workspaceId) {
      throw new Error('Layout nodes must belong to the workspace being saved.')
    }

    if (node.type === 'pane') {
      if (node.children.length > 0 || node.sizeWeights.length > 0) {
        throw new Error('Pane layout nodes cannot declare children or weights.')
      }

      if (!node.paneId) {
        throw new Error('Pane layout nodes require a pane id.')
      }

      const viewIds =
        Array.isArray(node.viewIds) && node.viewIds.length > 0
          ? node.viewIds
          : [node.paneId]
      const activeViewIndex =
        typeof node.activeViewIndex === 'number'
          ? Math.min(Math.max(node.activeViewIndex, 0), viewIds.length - 1)
          : 0

      return {
        ...node,
        activeViewIndex,
        children: [],
        sizeWeights: [],
        viewIds,
      }
    }

    if (node.paneId !== null) {
      throw new Error('Split layout nodes cannot declare a pane id.')
    }

    if (node.children.length !== node.sizeWeights.length) {
      throw new Error(
        'Split layout nodes must keep children and weight counts aligned.',
      )
    }

    return {
      ...node,
      children: [...node.children],
      sizeWeights: [...node.sizeWeights],
    }
  }

  private runMigrations(): void {
    const currentVersion = this.getSchemaVersion()
    const pendingMigrations = MIGRATIONS.filter(
      (migration) => migration.version > currentVersion,
    )

    for (const migration of pendingMigrations) {
      try {
        this.database.exec(migration.sql)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('duplicate column name')
        ) {
          // Ignore duplicate column errors when migrating existing local databases.
        } else {
          throw error
        }
      }
      this.database.exec(`PRAGMA user_version = ${migration.version};`)
    }
  }
}
