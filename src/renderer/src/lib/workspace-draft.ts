export interface WorkspaceDraftValues {
  branchName: string
  name: string
  worktreePath: string
}

export function slugifyWorkspaceSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function buildDefaultWorktreePath(
  repoRoot: string,
  branchName: string,
): string {
  const slug = slugifyWorkspaceSegment(branchName) || 'workspace'

  return `${repoRoot}/.worktrees/${slug}`
}

export function createWorkspaceDraftValues(
  repoRoot: string,
  index: number,
): WorkspaceDraftValues {
  const name = `Workspace ${index}`
  const branchName = `workspace-${index}`

  return {
    branchName,
    name,
    worktreePath: buildDefaultWorktreePath(repoRoot, branchName),
  }
}
