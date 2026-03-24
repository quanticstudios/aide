export interface WorkspaceTrackStyle {
  height: string
  transform: string
}

export function getWorkspaceTrackStyle(
  workspaceCount: number,
  activeWorkspaceIndex: number,
): WorkspaceTrackStyle {
  const safeWorkspaceCount = Math.max(workspaceCount, 1)
  const safeWorkspaceIndex = Math.min(
    Math.max(activeWorkspaceIndex, 0),
    safeWorkspaceCount - 1,
  )

  return {
    height: `${safeWorkspaceCount * 100}%`,
    transform: `translateY(calc(-${safeWorkspaceIndex} * (100% / ${safeWorkspaceCount})))`,
  }
}

export function getWorkspaceSlideHeight(workspaceCount: number): string {
  return `${100 / Math.max(workspaceCount, 1)}%`
}
