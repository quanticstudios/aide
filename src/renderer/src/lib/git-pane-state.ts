import type { GitChangeKind, WorkspaceGitFileStatus } from '../../../shared/git'

export function resolveSelectedGitFilePath(
  files: readonly WorkspaceGitFileStatus[],
  selectedPath: string | null,
): string | null {
  if (!files.length) {
    return null
  }

  if (selectedPath && files.some((file) => file.path === selectedPath)) {
    return selectedPath
  }

  return files[0]?.path ?? null
}

export function formatGitChangeKind(kind: GitChangeKind): string {
  switch (kind) {
    case 'added':
      return 'Added'
    case 'copied':
      return 'Copied'
    case 'deleted':
      return 'Deleted'
    case 'modified':
      return 'Modified'
    case 'renamed':
      return 'Renamed'
    case 'unmerged':
      return 'Unmerged'
    case 'untracked':
      return 'Untracked'
    case 'unmodified':
      return 'Unmodified'
  }
}

export function getGitFileChangeBadges(file: WorkspaceGitFileStatus): string[] {
  const badges: string[] = []

  if (file.isStaged) {
    badges.push(`Staged: ${formatGitChangeKind(file.staged)}`)
  }

  if (file.isUnstaged) {
    badges.push(`Unstaged: ${formatGitChangeKind(file.unstaged)}`)
  }

  return badges.length > 0 ? badges : ['Clean']
}
