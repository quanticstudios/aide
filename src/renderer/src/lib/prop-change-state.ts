export function isCurrentWorkspaceRequest(
  currentWorkspaceId: string | null,
  requestWorkspaceId: string,
  currentRequestId: number,
  requestId: number,
): boolean {
  return (
    currentWorkspaceId === requestWorkspaceId && currentRequestId === requestId
  )
}

export function isCurrentWorkspaceDiff(
  diff: { readonly path: string; readonly workspaceId: string } | null,
  workspaceId: string,
  selectedPath: string | null,
): boolean {
  return (
    diff !== null &&
    selectedPath !== null &&
    diff.workspaceId === workspaceId &&
    diff.path === selectedPath
  )
}

export function shouldResetWorkspaceCreationDraft(
  previousOpenProjectId: string | null,
  projectId: string | null,
  isOpen: boolean,
): boolean {
  return isOpen && projectId !== null && previousOpenProjectId !== projectId
}
