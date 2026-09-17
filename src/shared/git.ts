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
  fingerprint: string
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
    | 'detached-head'
    | 'file-not-found'
    | 'git-command-failed'
    | 'git-unavailable'
    | 'gh-auth-required'
    | 'gh-command-failed'
    | 'gh-unavailable'
    | 'invalid-input'
    | 'not-a-git-worktree'
    | 'stale-diff'
    | 'workspace-not-owned'
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

export interface WorkspaceGitMutationSuccess {
  ok: true
  status: WorkspaceGitStatusSnapshot
}

export type WorkspaceGitMutationResult =
  | WorkspaceGitMutationSuccess
  | WorkspaceGitStatusFailure

export interface WorkspaceGitFileMutationInput {
  filePath: string
  workspaceId: string
}

export interface WorkspaceGitRevertInput extends WorkspaceGitFileMutationInput {
  fingerprint: string
}

export interface WorkspaceGitCommitInput {
  message: string
  workspaceId: string
}

export interface WorkspaceGitPullRequestInput {
  body: string
  title: string
  workspaceId: string
}

export interface WorkspaceGitPullRequest {
  baseRefName: string
  checks: readonly {
    conclusion: string | null
    detailsUrl: string | null
    name: string
    status: string | null
  }[]
  headRefName: string
  number: number
  state: string
  title: string
  url: string
}

export interface WorkspaceGitPullRequestSuccess {
  ok: true
  pullRequest: WorkspaceGitPullRequest | null
}

export type WorkspaceGitPullRequestResult =
  | WorkspaceGitPullRequestSuccess
  | WorkspaceGitStatusFailure
