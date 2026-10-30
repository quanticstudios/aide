import type { ManagedSessionSnapshot } from '../shared/managed-session'
import type { WorkspaceRecord } from '../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../shared/preview'
import type { WorkspaceActivityCollectionSnapshot } from '../shared/workspace-activity'
import type { WorkspaceWindowContext } from '../shared/workspace-window'

export interface WorkspaceAccessStore {
  getWorkspace: (workspaceId: string) => WorkspaceRecord | null
  listWorkspaces: () => WorkspaceRecord[]
}

export function canAccessWorkspace(
  context: WorkspaceWindowContext,
  workspace: Pick<WorkspaceRecord, 'id' | 'windowId'>,
): boolean {
  if (context.kind === 'main') {
    return workspace.windowId === null
  }

  return (
    workspace.id === context.workspaceId &&
    workspace.windowId === context.windowId
  )
}

export function requireMainWindowAccess(context: WorkspaceWindowContext): void {
  if (context.kind !== 'main') {
    throw new Error('This operation is available only in the main window.')
  }
}

export function requireWorkspaceAccess(
  store: Pick<WorkspaceAccessStore, 'getWorkspace'>,
  context: WorkspaceWindowContext,
  workspaceId: string,
): WorkspaceRecord {
  const workspace = store.getWorkspace(workspaceId)

  if (!workspace) {
    throw new Error('Workspace does not exist.')
  }

  if (!canAccessWorkspace(context, workspace)) {
    throw new Error('Workspace is not owned by this window.')
  }

  return workspace
}

export function getAccessibleWorkspaceIds(
  store: WorkspaceAccessStore,
  context: WorkspaceWindowContext,
): Set<string> {
  return new Set(
    store
      .listWorkspaces()
      .filter((workspace) => canAccessWorkspace(context, workspace))
      .map((workspace) => workspace.id),
  )
}

export function requireSessionAccess(
  context: WorkspaceWindowContext,
  sessionId: string,
  sessionWorkspaceIds: ReadonlyMap<string, string>,
  store: Pick<WorkspaceAccessStore, 'getWorkspace'>,
): string {
  const workspaceId = sessionWorkspaceIds.get(sessionId)

  if (!workspaceId) {
    throw new Error('Unknown session.')
  }

  requireWorkspaceAccess(store, context, workspaceId)

  return workspaceId
}

export function scopeWorkspaceActivitySnapshot(
  snapshot: WorkspaceActivityCollectionSnapshot,
  workspaceIds: ReadonlySet<string>,
): WorkspaceActivityCollectionSnapshot {
  return {
    ...snapshot,
    activitiesByWorkspace: Object.fromEntries(
      Object.entries(snapshot.activitiesByWorkspace).filter(([workspaceId]) =>
        workspaceIds.has(workspaceId),
      ),
    ),
  }
}

export function scopeManagedSessionSnapshots(
  snapshots: Record<string, ManagedSessionSnapshot>,
  workspaceIds: ReadonlySet<string>,
): Record<string, ManagedSessionSnapshot> {
  return Object.fromEntries(
    Object.entries(snapshots).filter(([, snapshot]) =>
      workspaceIds.has(snapshot.workspaceId),
    ),
  )
}

export function scopeWorkspacePreviewSnapshots(
  snapshots: Record<string, WorkspacePreviewSnapshot>,
  workspaceIds: ReadonlySet<string>,
): Record<string, WorkspacePreviewSnapshot> {
  return Object.fromEntries(
    Object.entries(snapshots).filter(([workspaceId]) =>
      workspaceIds.has(workspaceId),
    ),
  )
}
