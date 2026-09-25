import type { IconName } from 'lucide-react/dynamic'

export type ProjectKind = 'folder' | 'git'
export const PROJECT_COLOR_IDS = [
  'neutral',
  'blue',
  'violet',
  'green',
  'amber',
  'red',
  'orange',
  'yellow',
  'lime',
  'emerald',
  'teal',
  'cyan',
  'sky',
  'indigo',
  'purple',
  'fuchsia',
  'pink',
  'rose',
] as const
export type ProjectIcon = IconName
export type ProjectColor = (typeof PROJECT_COLOR_IDS)[number]
export interface ProjectAppearance {
  color: ProjectColor
  icon: ProjectIcon
}
export type WorkspaceNameSource = 'default' | 'generated' | 'manual'

export interface ProjectRecord {
  color?: ProjectColor
  id: string
  icon?: ProjectIcon
  kind: ProjectKind
  name: string
  repoRoot: string
  remoteUrl: string | null
  defaultBranch: string
  /**
   * A trusted, local command configured by the owner of this project. It is
   * deliberately not part of diagnostics or support-bundle contracts.
   */
  setupCommand: string | null
  worktreeSetupRevision: number
  createdAt: string
  updatedAt: string
}

export interface WorkspaceRecord {
  id: string
  projectId: string
  name: string
  nameSource?: WorkspaceNameSource
  branchName: string
  worktreePath: string
  windowId: string | null
  /** Whether this workspace shows the left sidebar; null until the workspace is toggled. */
  sidebarOpen?: boolean | null
  /** Archived workspaces stay on disk and in storage but leave navigation. */
  archived?: boolean
  createdAt: string
  updatedAt: string
}

export type PersistedLayoutNodeType =
  | 'split-horizontal'
  | 'split-vertical'
  | 'pane'

export interface PersistedSplitLayoutNode {
  children: string[]
  id: string
  paneId: null
  parentId: string | null
  sizeWeights: number[]
  type: 'split-horizontal' | 'split-vertical'
  workspaceId: string
}

export interface PersistedPaneLayoutNode {
  activeViewIndex: number
  children: []
  id: string
  paneId: string
  parentId: string | null
  sizeWeights: []
  type: 'pane'
  viewIds: string[]
  workspaceId: string
}

export type PersistedLayoutNode =
  | PersistedSplitLayoutNode
  | PersistedPaneLayoutNode

export interface WorkspaceLayoutRecord {
  nodes: PersistedLayoutNode[]
  rootNodeId: string
  workspaceId: string
}

export interface WorkspaceSurfaceRecord {
  id: string
  orderIndex: number
  rootNodeId: string
  title: string
  workspaceId: string
}

export interface SurfaceLayoutRecord extends WorkspaceLayoutRecord {
  surfaceId: string
}

export interface PersistenceSnapshot {
  catalogRevision: number
  databasePath: string
  lastActivePaneIdsByWorkspace: Record<string, string | null>
  lastActivePaneIdsBySurface?: Record<string, string | null>
  lastActiveProjectId: string | null
  lastActiveSurfaceIdsByWorkspace?: Record<string, string | null>
  lastActiveWorkspaceIdsByProject: Record<string, string | null>
  lastActiveWorkspaceId: string | null
  migrationStrategy: string
  schemaVersion: number
  projects: ProjectRecord[]
  surfaceLayouts?: Record<string, SurfaceLayoutRecord>
  workspaceLayoutRevisions: Record<string, number>
  workspaceLayouts: Record<string, WorkspaceLayoutRecord>
  workspaceSurfaceRevisions: Record<string, number>
  workspaceSurfaces?: Record<string, WorkspaceSurfaceRecord[]>
  /** Navigable workspaces only; archived ones are in `archivedWorkspaces`. */
  workspaces: WorkspaceRecord[]
  archivedWorkspaces?: WorkspaceRecord[]
}

export interface SetActiveSelectionInput {
  paneIdsBySurface?: Record<string, string | null>
  paneIdsByWorkspace?: Record<string, string | null>
  projectId: string | null
  surfaceIdsByWorkspace?: Record<string, string | null>
  workspaceIdsByProject?: Record<string, string | null>
  workspaceId: string | null
}

export interface CreateProjectInput {
  defaultBranch: string
  kind?: ProjectKind
  name: string
  remoteUrl: string | null
  repoRoot: string
}

export interface UpdateProjectInput {
  color?: ProjectColor
  defaultBranch?: string
  icon?: ProjectIcon
  kind?: ProjectKind
  name?: string
  remoteUrl?: string | null
  repoRoot?: string
  setupCommand?: string | null
}

export interface CreateWorkspaceInput {
  branchName: string
  name: string
  nameSource?: WorkspaceNameSource
  projectId: string
  windowId: string | null
  worktreePath: string
}

export interface UpdateWorkspaceInput {
  archived?: boolean
  branchName?: string
  name?: string
  nameSource?: WorkspaceNameSource
  projectId?: string
  sidebarOpen?: boolean
  windowId?: string | null
  worktreePath?: string
}

export interface SaveWorkspaceLayoutInput {
  expectedRevision?: number
  nodes: PersistedLayoutNode[]
  rootNodeId: string
}

export interface SaveWorkspaceSurfaceStateInput {
  expectedRevision?: number
  layouts: Record<string, SaveWorkspaceLayoutInput>
  surfaces: WorkspaceSurfaceRecord[]
}

export interface WorkspacePersistenceSuccess {
  ok: true
  snapshot: PersistenceSnapshot
  workspaceId: string
  workspaceRevision: number
}

export interface WorkspacePersistenceConflict {
  code: 'stale-workspace-revision'
  currentRevision: number
  ok: false
  snapshot: PersistenceSnapshot
  workspaceId: string
}

export type WorkspacePersistenceResult =
  | WorkspacePersistenceConflict
  | WorkspacePersistenceSuccess

export interface WorkspacePersistenceEvent {
  revision: number
  snapshot: PersistenceSnapshot
}

export function createEmptyPersistenceSnapshot(
  databasePath = '.aide.sqlite3',
): PersistenceSnapshot {
  return {
    catalogRevision: 0,
    databasePath,
    lastActivePaneIdsBySurface: {},
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveSurfaceIdsByWorkspace: {},
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: 'Pending runtime snapshot',
    schemaVersion: 0,
    projects: [],
    surfaceLayouts: {},
    workspaceLayoutRevisions: {},
    workspaceLayouts: {},
    workspaceSurfaces: {},
    workspaceSurfaceRevisions: {},
    workspaces: [],
  }
}

/**
 * True when the workspace is a linked worktree rather than the project's own
 * checkout or a folder project. Stored paths are resolved on write, so a plain
 * comparison holds.
 */
export function isLinkedWorktree(
  project: Pick<ProjectRecord, 'kind' | 'repoRoot'>,
  workspace: Pick<WorkspaceRecord, 'worktreePath'>,
): boolean {
  return project.kind === 'git' && workspace.worktreePath !== project.repoRoot
}
