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

export interface AttachWorkspaceRequest {
  name: string
  projectId: string
  windowId: string | null
  worktreePath: string
}

export interface DetectWorktreeBranchResult {
  branchName: string | null
  worktreePath: string
}

export type GitChangeKind =
  | 'added'
  | 'copied'
  | 'deleted'
  | 'modified'
  | 'unmerged'
  | 'unmodified'
  | 'untracked'
  | 'renamed'

export interface WorkspaceGitFileStatus {
  isStaged: boolean
  isUnstaged: boolean
  originalPath: string | null
  path: string
  staged: GitChangeKind
  unstaged: GitChangeKind
}

export interface WorkspaceGitStatusSnapshot {
  branchName: string
  files: WorkspaceGitFileStatus[]
  hasStagedChanges: boolean
  hasUnstagedChanges: boolean
  workspaceId: string
  worktreePath: string
}

export interface WorkspaceGitStatusSuccess {
  ok: true
  status: WorkspaceGitStatusSnapshot
}

export interface WorkspaceGitDiffSection {
  isTruncated: boolean
  kind: 'staged' | 'unstaged' | 'untracked'
  patch: string
  title: string
}

export interface WorkspaceGitDiffSnapshot {
  branchName: string
  path: string
  sections: WorkspaceGitDiffSection[]
  workspaceId: string
  worktreePath: string
}

export interface WorkspaceGitDiffSuccess {
  diff: WorkspaceGitDiffSnapshot
  ok: true
}

export interface WorkspaceGitStatusFailure {
  code:
    | 'file-not-found'
    | 'git-command-failed'
    | 'git-unavailable'
    | 'not-a-git-worktree'
    | 'workspace-not-found'
  error: string
  ok: false
}

export type WorkspaceGitStatusResult =
  | WorkspaceGitStatusFailure
  | WorkspaceGitStatusSuccess

export type WorkspaceGitDiffResult =
  | WorkspaceGitDiffSuccess
  | WorkspaceGitStatusFailure

export interface WorktreeBranchStats {
  additions: number
  aheadCount: number
  behindCount: number
  deletions: number
  mergeStatus: 'clean' | 'conflicts' | 'unknown' | 'up-to-date'
}

export interface WorktreeBranchStatsSuccess {
  ok: true
  stats: WorktreeBranchStats
  workspaceId: string
}

export type WorktreeBranchStatsResult =
  | WorktreeBranchStatsSuccess
  | WorkspaceGitStatusFailure
