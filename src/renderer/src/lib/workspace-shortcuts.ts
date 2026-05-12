import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../../shared/workspace-activity'
import { compareWorkspacesByAttentionTier } from '../../../shared/workspace-activity'

/**
 * Compute the flat, ordered workspace list as displayed in the sidebar: for
 * each project (in project order), workspaces of that project sorted by
 * attention tier. This is the canonical order used for `Ctrl+1..Ctrl+9`
 * keycaps and the `workspace-jump` shortcut.
 */
export function getOrderedWorkspaces(
  projects: readonly ProjectRecord[],
  workspaces: readonly WorkspaceRecord[],
  resolveActivity: (workspaceId: string) => WorkspaceActivitySnapshot | null,
): WorkspaceRecord[] {
  const ordered: WorkspaceRecord[] = []

  for (const project of projects) {
    const projectWorkspaces = workspaces
      .filter((workspace) => workspace.projectId === project.id)
      .sort((a, b) =>
        compareWorkspacesByAttentionTier(
          resolveActivity(a.id),
          a.updatedAt,
          resolveActivity(b.id),
          b.updatedAt,
        ),
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
 * Resolve a `Ctrl/Cmd + digit` keypress to the nth workspace in the global
 * sidebar order. Mirrors what the sidebar tree shows: the first 9 workspaces
 * across projects get a `Ctrl+N` keycap.
 */
export function resolveWorkspaceShortcutTarget(
  workspaces: readonly WorkspaceRecord[],
  key: string,
): WorkspaceRecord | null {
  if (!/^[1-9]$/.test(key)) {
    return null
  }

  const index = Number(key) - 1

  return workspaces[index] ?? null
}
