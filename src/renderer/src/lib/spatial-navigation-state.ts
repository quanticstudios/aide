import type {
  PersistenceSnapshot,
  WorkspaceRecord,
} from '../../../shared/persistence'

export interface SpatialNavigationState {
  activePaneId: string | null
  activeProjectId: string | null
  activeWorkspaceId: string | null
  rememberedPaneIdsByWorkspace: Record<string, string | null>
  rememberedWorkspaceIdsByProject: Record<string, string | null>
}

type PaneResolver = (workspaceId: string | null) => string[]
type PaneNeighborResolver = (
  workspaceId: string | null,
  activePaneId: string | null,
  direction: -1 | 1,
) => string | null

function getProjectWorkspaces(
  snapshot: PersistenceSnapshot,
  projectId: string,
): WorkspaceRecord[] {
  return snapshot.workspaces.filter(
    (workspace) => workspace.projectId === projectId,
  )
}

function resolveProjectId(
  snapshot: PersistenceSnapshot,
  activeProjectId: string | null,
): string | null {
  if (snapshot.projects.length === 0) {
    return null
  }

  return (
    snapshot.projects.find((project) => project.id === activeProjectId)?.id ??
    snapshot.projects.find(
      (project) => project.id === snapshot.lastActiveProjectId,
    )?.id ??
    snapshot.projects[0]?.id ??
    null
  )
}

function resolveWorkspaceId(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  projectId: string | null,
  activeWorkspaceId: string | null,
): string | null {
  if (!projectId) {
    return null
  }

  const projectWorkspaces = getProjectWorkspaces(snapshot, projectId)

  if (projectWorkspaces.length === 0) {
    return null
  }

  const candidates = [
    activeWorkspaceId,
    state.rememberedWorkspaceIdsByProject[projectId] ?? null,
    snapshot.lastActiveWorkspaceIdsByProject[projectId] ?? null,
    snapshot.lastActiveWorkspaceId,
  ]

  for (const candidate of candidates) {
    if (
      candidate &&
      projectWorkspaces.some((workspace) => workspace.id === candidate)
    ) {
      return candidate
    }
  }

  return projectWorkspaces[0]?.id ?? null
}

function resolvePaneId(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  workspaceId: string | null,
  activePaneId: string | null,
  getPaneIdsForWorkspace: PaneResolver,
): string | null {
  const paneIds = getPaneIdsForWorkspace(workspaceId)

  if (paneIds.length === 0) {
    return null
  }

  const candidates = [
    activePaneId,
    workspaceId
      ? (state.rememberedPaneIdsByWorkspace[workspaceId] ?? null)
      : null,
    workspaceId
      ? (snapshot.lastActivePaneIdsByWorkspace[workspaceId] ?? null)
      : null,
  ]

  for (const candidate of candidates) {
    if (candidate && paneIds.includes(candidate)) {
      return candidate
    }
  }

  return paneIds[0] ?? null
}

export function createDefaultSpatialNavigationState(): SpatialNavigationState {
  return {
    activePaneId: null,
    activeProjectId: null,
    activeWorkspaceId: null,
    rememberedPaneIdsByWorkspace: {},
    rememberedWorkspaceIdsByProject: {},
  }
}

export function resolveSpatialNavigationState(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  getPaneIdsForWorkspace: PaneResolver,
): SpatialNavigationState {
  const activeProjectId = resolveProjectId(snapshot, state.activeProjectId)
  const activeWorkspaceId = resolveWorkspaceId(
    snapshot,
    state,
    activeProjectId,
    state.activeWorkspaceId,
  )
  const activePaneId = resolvePaneId(
    snapshot,
    state,
    activeWorkspaceId,
    state.activePaneId,
    getPaneIdsForWorkspace,
  )

  return {
    activePaneId,
    activeProjectId,
    activeWorkspaceId,
    rememberedPaneIdsByWorkspace: activeWorkspaceId
      ? {
          ...state.rememberedPaneIdsByWorkspace,
          [activeWorkspaceId]: activePaneId,
        }
      : state.rememberedPaneIdsByWorkspace,
    rememberedWorkspaceIdsByProject: activeProjectId
      ? {
          ...state.rememberedWorkspaceIdsByProject,
          [activeProjectId]: activeWorkspaceId,
        }
      : state.rememberedWorkspaceIdsByProject,
  }
}

export function applyProjectSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  projectId: string,
  getPaneIdsForWorkspace: PaneResolver,
): SpatialNavigationState {
  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: null,
      activeProjectId: projectId,
      activeWorkspaceId: null,
    },
    getPaneIdsForWorkspace,
  )
}

export function applyWorkspaceSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  workspaceId: string,
  getPaneIdsForWorkspace: PaneResolver,
): SpatialNavigationState {
  const workspace = snapshot.workspaces.find(
    (candidate) => candidate.id === workspaceId,
  )

  if (!workspace) {
    return state
  }

  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: null,
      activeProjectId: workspace.projectId,
      activeWorkspaceId: workspace.id,
      rememberedWorkspaceIdsByProject: {
        ...state.rememberedWorkspaceIdsByProject,
        [workspace.projectId]: workspace.id,
      },
    },
    getPaneIdsForWorkspace,
  )
}

export function applyPaneSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  paneId: string,
  getPaneIdsForWorkspace: PaneResolver,
): SpatialNavigationState {
  const workspaceId = state.activeWorkspaceId
  const paneIds = getPaneIdsForWorkspace(workspaceId)

  if (!workspaceId || !paneIds.includes(paneId)) {
    return state
  }

  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: paneId,
      rememberedPaneIdsByWorkspace: {
        ...state.rememberedPaneIdsByWorkspace,
        [workspaceId]: paneId,
      },
    },
    getPaneIdsForWorkspace,
  )
}

export function moveRelativeWorkspace(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  direction: -1 | 1,
  getPaneIdsForWorkspace: PaneResolver,
): SpatialNavigationState {
  if (!state.activeProjectId || !state.activeWorkspaceId) {
    return state
  }

  const projectWorkspaces = getProjectWorkspaces(
    snapshot,
    state.activeProjectId,
  )

  if (projectWorkspaces.length === 0) {
    return state
  }

  const currentIndex = projectWorkspaces.findIndex(
    (workspace) => workspace.id === state.activeWorkspaceId,
  )

  if (currentIndex === -1) {
    return state
  }

  const nextIndex =
    (currentIndex + direction + projectWorkspaces.length) %
    projectWorkspaces.length
  const nextWorkspace = projectWorkspaces[nextIndex]

  return nextWorkspace
    ? applyWorkspaceSelection(
        snapshot,
        state,
        nextWorkspace.id,
        getPaneIdsForWorkspace,
      )
    : state
}

export function moveRelativePane(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  direction: -1 | 1,
  getPaneIdsForWorkspace: PaneResolver,
  resolvePaneNeighbor?: PaneNeighborResolver,
): SpatialNavigationState {
  const paneIds = getPaneIdsForWorkspace(state.activeWorkspaceId)

  if (!state.activeWorkspaceId || paneIds.length === 0) {
    return state
  }

  const currentPaneId = resolvePaneId(
    snapshot,
    state,
    state.activeWorkspaceId,
    state.activePaneId,
    getPaneIdsForWorkspace,
  )
  const currentIndex = paneIds.findIndex((paneId) => paneId === currentPaneId)

  if (currentIndex === -1) {
    return state
  }

  const resolvedNeighborPaneId = resolvePaneNeighbor?.(
    state.activeWorkspaceId,
    currentPaneId,
    direction,
  )
  const nextPaneId =
    resolvedNeighborPaneId && paneIds.includes(resolvedNeighborPaneId)
      ? resolvedNeighborPaneId
      : paneIds[(currentIndex + direction + paneIds.length) % paneIds.length]

  return nextPaneId
    ? applyPaneSelection(snapshot, state, nextPaneId, getPaneIdsForWorkspace)
    : state
}
