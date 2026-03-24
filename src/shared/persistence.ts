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

export interface PersistenceSnapshot {
  databasePath: string
  lastActivePaneIdsByWorkspace: Record<string, string | null>
  lastActiveProjectId: string | null
  lastActiveWorkspaceIdsByProject: Record<string, string | null>
  lastActiveWorkspaceId: string | null
  migrationStrategy: string
  schemaVersion: number
  projects: ProjectRecord[]
  workspaces: WorkspaceRecord[]
}

export interface SetActiveSelectionInput {
  paneIdsByWorkspace?: Record<string, string | null>
  projectId: string | null
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
