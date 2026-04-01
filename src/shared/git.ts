import type { PersistenceSnapshot } from './persistence'

export interface ProjectRefRecord {
  displayName: string
  name: string
  source: 'local' | 'remote'
}

export interface ImportProjectResult {
  projectId: string
  snapshot: PersistenceSnapshot
  workspaceId: string
}

export interface CreateWorkspaceRequest {
  baseBranch: string
  branchName: string
  name: string
  projectId: string
  windowId: string | null
  worktreePath: string
}
