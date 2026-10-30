import type {
  PersistenceSnapshot,
  SetActiveSelectionInput,
  WorkspaceRecord,
} from '../shared/persistence'
import type { WorkspaceWindowContext } from '../shared/workspace-window'
import { canAccessWorkspace } from './workspace-access'

type SelectionRecord = Record<string, string | null>

interface SelectionScope {
  paneIdsBySurface: ReadonlyMap<string, ReadonlySet<string>>
  paneIdsByWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  projectIds: ReadonlySet<string>
  surfaceIdsByWorkspace: ReadonlyMap<string, ReadonlySet<string>>
  writableWorkspaceSelectionProjectIds: ReadonlySet<string>
  workspaceIdsByProject: ReadonlyMap<string, ReadonlySet<string>>
  workspaceIds: ReadonlySet<string>
  workspacesById: ReadonlyMap<string, WorkspaceRecord>
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function requireNullableId(value: unknown, label: string): string | null {
  if (!isNullableString(value)) {
    throw new Error(`Invalid ${label}.`)
  }

  return value
}

function collectPaneIds(nodes: { paneId: string | null }[]): Set<string> {
  return new Set(
    nodes.flatMap((node) => (node.paneId === null ? [] : [node.paneId])),
  )
}

function collectSelectionScope(
  snapshot: PersistenceSnapshot,
  context: WorkspaceWindowContext,
): SelectionScope {
  const workspaces = snapshot.workspaces.filter((workspace) =>
    canAccessWorkspace(context, workspace),
  )
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.id))
  const projectIds = new Set(workspaces.map((workspace) => workspace.projectId))
  const writableWorkspaceSelectionProjectIds = new Set(
    context.kind === 'main'
      ? projectIds
      : [...projectIds].filter((projectId) =>
          snapshot.workspaces
            .filter((workspace) => workspace.projectId === projectId)
            .every((workspace) => canAccessWorkspace(context, workspace)),
        ),
  )
  const workspacesById = new Map(
    workspaces.map((workspace) => [workspace.id, workspace]),
  )
  const workspaceIdsByProject = new Map<string, Set<string>>()
  const surfaceIdsByWorkspace = new Map<string, Set<string>>()
  const paneIdsByWorkspace = new Map<string, Set<string>>()
  const paneIdsBySurface = new Map<string, Set<string>>()

  for (const workspace of workspaces) {
    const projectWorkspaces =
      workspaceIdsByProject.get(workspace.projectId) ?? new Set<string>()
    projectWorkspaces.add(workspace.id)
    workspaceIdsByProject.set(workspace.projectId, projectWorkspaces)

    const surfaceIds = new Set<string>()
    const paneIds = new Set<string>()
    for (const surface of snapshot.workspaceSurfaces?.[workspace.id] ?? []) {
      surfaceIds.add(surface.id)
      const layout = snapshot.surfaceLayouts?.[surface.id]
      const surfacePaneIds = layout
        ? collectPaneIds(layout.nodes)
        : new Set<string>()
      paneIdsBySurface.set(surface.id, surfacePaneIds)
      for (const paneId of surfacePaneIds) {
        paneIds.add(paneId)
      }
    }
    for (const layout of Object.values(snapshot.surfaceLayouts ?? {})) {
      if (layout.workspaceId !== workspace.id) {
        continue
      }

      surfaceIds.add(layout.surfaceId)
      const surfacePaneIds = collectPaneIds(layout.nodes)
      paneIdsBySurface.set(layout.surfaceId, surfacePaneIds)
      for (const paneId of surfacePaneIds) {
        paneIds.add(paneId)
      }
    }
    const legacyLayout = snapshot.workspaceLayouts[workspace.id]
    if (legacyLayout) {
      for (const paneId of collectPaneIds(legacyLayout.nodes)) {
        paneIds.add(paneId)
      }
    }

    surfaceIdsByWorkspace.set(workspace.id, surfaceIds)
    paneIdsByWorkspace.set(workspace.id, paneIds)
  }

  return {
    paneIdsBySurface,
    paneIdsByWorkspace,
    projectIds,
    surfaceIdsByWorkspace,
    writableWorkspaceSelectionProjectIds,
    workspaceIdsByProject,
    workspaceIds,
    workspacesById,
  }
}

function mergeScopedRecord(
  current: SelectionRecord,
  incoming: SelectionRecord | undefined,
  ownsKey: (key: string) => boolean,
  acceptsValue: (key: string, value: string | null) => boolean,
): SelectionRecord {
  if (incoming === undefined) {
    return { ...current }
  }

  const next = Object.fromEntries(
    Object.entries(current).filter(([key]) => !ownsKey(key)),
  ) as SelectionRecord

  for (const [key, value] of Object.entries(incoming)) {
    if (ownsKey(key) && isNullableString(value) && acceptsValue(key, value)) {
      next[key] = value
    }
  }

  return next
}

function acceptsMappedId(
  valuesByKey: ReadonlyMap<string, ReadonlySet<string>>,
  key: string,
  value: string | null,
): boolean {
  return value === null || valuesByKey.get(key)?.has(value) === true
}

function validateActiveIds(
  input: SetActiveSelectionInput,
  scope: SelectionScope,
): { projectId: string | null; workspaceId: string | null } {
  const projectId = requireNullableId(input.projectId, 'project id')
  const workspaceId = requireNullableId(input.workspaceId, 'workspace id')

  if (projectId !== null && !scope.projectIds.has(projectId)) {
    throw new Error('Project is not owned by this window.')
  }
  if (workspaceId !== null && !scope.workspaceIds.has(workspaceId)) {
    throw new Error('Workspace is not owned by this window.')
  }
  if (
    projectId !== null &&
    workspaceId !== null &&
    scope.workspacesById.get(workspaceId)?.projectId !== projectId
  ) {
    throw new Error('Workspace does not belong to the selected project.')
  }
  return { projectId, workspaceId }
}

/**
 * Applies only the sender's selection descendants, leaving persisted state for
 * every other window owner untouched. Foreign mapping entries are dropped.
 */
export function scopeActiveSelectionInput(
  snapshot: PersistenceSnapshot,
  context: WorkspaceWindowContext,
  input: SetActiveSelectionInput,
): SetActiveSelectionInput {
  const scope = collectSelectionScope(snapshot, context)
  const activeIds = validateActiveIds(input, scope)
  const current: SetActiveSelectionInput = {
    paneIdsBySurface: snapshot.lastActivePaneIdsBySurface ?? {},
    paneIdsByWorkspace: snapshot.lastActivePaneIdsByWorkspace,
    projectId: snapshot.lastActiveProjectId,
    surfaceIdsByWorkspace: snapshot.lastActiveSurfaceIdsByWorkspace ?? {},
    workspaceId: snapshot.lastActiveWorkspaceId,
    workspaceIdsByProject: snapshot.lastActiveWorkspaceIdsByProject,
  }
  const isMain = context.kind === 'main'

  return {
    paneIdsBySurface: mergeScopedRecord(
      current.paneIdsBySurface ?? {},
      input.paneIdsBySurface,
      (surfaceId) => scope.paneIdsBySurface.has(surfaceId),
      (surfaceId, paneId) =>
        acceptsMappedId(scope.paneIdsBySurface, surfaceId, paneId),
    ),
    paneIdsByWorkspace: mergeScopedRecord(
      current.paneIdsByWorkspace ?? {},
      input.paneIdsByWorkspace,
      (workspaceId) => scope.paneIdsByWorkspace.has(workspaceId),
      (workspaceId, paneId) =>
        acceptsMappedId(scope.paneIdsByWorkspace, workspaceId, paneId),
    ),
    projectId: isMain ? activeIds.projectId : current.projectId,
    surfaceIdsByWorkspace: mergeScopedRecord(
      current.surfaceIdsByWorkspace ?? {},
      input.surfaceIdsByWorkspace,
      (workspaceId) => scope.surfaceIdsByWorkspace.has(workspaceId),
      (workspaceId, surfaceId) =>
        acceptsMappedId(scope.surfaceIdsByWorkspace, workspaceId, surfaceId),
    ),
    workspaceId: isMain ? activeIds.workspaceId : current.workspaceId,
    workspaceIdsByProject: mergeScopedRecord(
      current.workspaceIdsByProject ?? {},
      input.workspaceIdsByProject,
      (projectId) => scope.writableWorkspaceSelectionProjectIds.has(projectId),
      (projectId, workspaceId) =>
        acceptsMappedId(scope.workspaceIdsByProject, projectId, workspaceId),
    ),
  }
}
