export interface ProjectRecord {
  id: string
  name: string
  repoRoot: string
  remoteUrl: string | null
  defaultBranch: string
  createdAt: string
  updatedAt: string
}

export interface WorkspaceRecord {
  id: string
  projectId: string
  name: string
  branchName: string
  worktreePath: string
  windowId: string | null
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
  workspaceLayouts: Record<string, WorkspaceLayoutRecord>
  workspaceSurfaces?: Record<string, WorkspaceSurfaceRecord[]>
  workspaces: WorkspaceRecord[]
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
  name: string
  remoteUrl: string | null
  repoRoot: string
}

export interface UpdateProjectInput {
  defaultBranch?: string
  name?: string
  remoteUrl?: string | null
  repoRoot?: string
}

export interface CreateWorkspaceInput {
  branchName: string
  name: string
  projectId: string
  windowId: string | null
  worktreePath: string
}

export interface UpdateWorkspaceInput {
  branchName?: string
  name?: string
  projectId?: string
  windowId?: string | null
  worktreePath?: string
}

export interface SaveWorkspaceLayoutInput {
  nodes: PersistedLayoutNode[]
  rootNodeId: string
}

export interface SaveWorkspaceSurfaceStateInput {
  layouts: Record<string, SaveWorkspaceLayoutInput>
  surfaces: WorkspaceSurfaceRecord[]
}

export function createEmptyPersistenceSnapshot(
  databasePath = '.aide.sqlite3',
): PersistenceSnapshot {
  return {
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
    workspaceLayouts: {},
    workspaceSurfaces: {},
    workspaces: [],
  }
}
