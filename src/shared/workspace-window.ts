import type { PersistenceSnapshot } from './persistence'

export type WorkspaceWindowContext =
  | {
      kind: 'main'
      windowId: null
      workspaceId: null
    }
  | {
      kind: 'workspace'
      windowId: string
      workspaceId: string
    }

export interface DetachWorkspaceResult {
  outcome: 'detached' | 'focused-existing'
  snapshot: PersistenceSnapshot
  windowId: string
  workspaceId: string
}

export function scopePersistenceSnapshot(
  snapshot: PersistenceSnapshot,
  context: WorkspaceWindowContext,
): PersistenceSnapshot {
  const workspaces = snapshot.workspaces.filter((workspace) =>
    context.kind === 'main'
      ? workspace.windowId === null
      : workspace.id === context.workspaceId &&
        workspace.windowId === context.windowId,
  )
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const projectIds = new Set(workspaces.map((workspace) => workspace.projectId))
  const surfaceIds = new Set(
    Object.values(snapshot.workspaceSurfaces ?? {})
      .filter((surfaces) => workspaceIds.has(surfaces[0]?.workspaceId ?? ''))
      .flatMap((surfaces) => surfaces.map((surface) => surface.id)),
  )
  const pickWorkspaceRecords = <T>(records: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(records).filter(([workspaceId]) =>
        workspaceIds.has(workspaceId),
      ),
    ) as Record<string, T>
  const pickSurfaceRecords = <T>(records: Record<string, T>) =>
    Object.fromEntries(
      Object.entries(records).filter(([surfaceId]) =>
        surfaceIds.has(surfaceId),
      ),
    ) as Record<string, T>

  return {
    ...snapshot,
    lastActivePaneIdsBySurface: pickSurfaceRecords(
      snapshot.lastActivePaneIdsBySurface ?? {},
    ),
    lastActivePaneIdsByWorkspace: pickWorkspaceRecords(
      snapshot.lastActivePaneIdsByWorkspace,
    ),
    lastActiveProjectId: projectIds.has(snapshot.lastActiveProjectId ?? '')
      ? snapshot.lastActiveProjectId
      : null,
    lastActiveSurfaceIdsByWorkspace: pickWorkspaceRecords(
      snapshot.lastActiveSurfaceIdsByWorkspace ?? {},
    ),
    lastActiveWorkspaceId: workspaceIds.has(
      snapshot.lastActiveWorkspaceId ?? '',
    )
      ? snapshot.lastActiveWorkspaceId
      : null,
    lastActiveWorkspaceIdsByProject: Object.fromEntries(
      Object.entries(snapshot.lastActiveWorkspaceIdsByProject).filter(
        ([projectId, workspaceId]) =>
          projectIds.has(projectId) && workspaceIds.has(workspaceId ?? ''),
      ),
    ),
    projects: snapshot.projects.filter((project) => projectIds.has(project.id)),
    surfaceLayouts: pickSurfaceRecords(snapshot.surfaceLayouts ?? {}),
    workspaceLayoutRevisions: pickWorkspaceRecords(
      snapshot.workspaceLayoutRevisions,
    ),
    workspaceLayouts: pickWorkspaceRecords(snapshot.workspaceLayouts),
    workspaceSurfaceRevisions: pickWorkspaceRecords(
      snapshot.workspaceSurfaceRevisions,
    ),
    workspaceSurfaces: pickWorkspaceRecords(snapshot.workspaceSurfaces ?? {}),
    workspaces,
  }
}
