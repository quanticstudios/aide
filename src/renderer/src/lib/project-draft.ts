export interface ProjectDraftValues {
  defaultBranch: string
  name: string
  remoteUrl: string
  repoRoot: string
}

export function getPathLeaf(pathValue: string): string {
  return pathValue.split(/[/\\]/).filter(Boolean).at(-1) ?? 'project'
}

export function createProjectDraftValues(repoRoot: string): ProjectDraftValues {
  return {
    defaultBranch: 'main',
    name: getPathLeaf(repoRoot),
    remoteUrl: '',
    repoRoot,
  }
}

export function shouldReplaceProjectName(
  currentName: string,
  previousRepoRoot: string,
): boolean {
  const trimmedName = currentName.trim()

  return (
    trimmedName.length === 0 || trimmedName === getPathLeaf(previousRepoRoot)
  )
}
