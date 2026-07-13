import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

/**
 * Compute the persisted navigation order: project order followed by each
 * project's workspace order. Runtime activity is display metadata and must
 * never alter the spatial camera or shortcut sequence.
 */
export function getOrderedWorkspaces(
  projects: readonly ProjectRecord[],
  workspaces: readonly WorkspaceRecord[],
): WorkspaceRecord[] {
  const ordered: WorkspaceRecord[] = []

  for (const project of projects) {
    const projectWorkspaces = workspaces.filter(
      (workspace) => workspace.projectId === project.id,
    )

    for (const workspace of projectWorkspaces) {
      ordered.push(workspace)
    }
  }

  for (const workspace of workspaces) {
    if (!ordered.some((entry) => entry.id === workspace.id)) {
      ordered.push(workspace)
    }
  }

  return ordered
}

/**
 * Resolve a Ctrl/Cmd + digit keypress to the nth persisted project. Selecting
 * a project restores its remembered workspace, surface, and pane path.
 */
export function resolveProjectShortcutTarget(
  projects: readonly ProjectRecord[],
  key: string,
): ProjectRecord | null {
  if (!/^[1-9]$/.test(key)) {
    return null
  }

  const index = Number(key) - 1

  return projects[index] ?? null
}
