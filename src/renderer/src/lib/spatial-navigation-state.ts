import type {
  PersistenceSnapshot,
  WorkspaceRecord,
} from '../../../shared/persistence'

export interface SpatialNavigationState {
  activePaneId: string | null
  activeProjectId: string | null
  activeSurfaceId: string | null
  activeWorkspaceId: string | null
  rememberedPaneIdsBySurface: Record<string, string | null>
  rememberedSurfaceIdsByWorkspace: Record<string, string | null>
  rememberedWorkspaceIdsByProject: Record<string, string | null>
}

type SurfaceResolver = (workspaceId: string | null) => string[]
type PaneResolver = (surfaceId: string | null) => string[]

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

function resolveSurfaceId(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  workspaceId: string | null,
  activeSurfaceId: string | null,
  getSurfaceIdsForWorkspace: SurfaceResolver,
): string | null {
  const surfaceIds = getSurfaceIdsForWorkspace(workspaceId)

  if (surfaceIds.length === 0) {
    return null
  }

  const candidates = [
    activeSurfaceId,
    workspaceId
      ? (state.rememberedSurfaceIdsByWorkspace[workspaceId] ?? null)
      : null,
    workspaceId
      ? (snapshot.lastActiveSurfaceIdsByWorkspace?.[workspaceId] ?? null)
      : null,
  ]

  for (const candidate of candidates) {
    if (candidate && surfaceIds.includes(candidate)) {
      return candidate
    }
  }

  return surfaceIds[0] ?? null
}

function resolvePaneId(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  surfaceId: string | null,
  activePaneId: string | null,
  getPaneIdsForSurface: PaneResolver,
): string | null {
  const paneIds = getPaneIdsForSurface(surfaceId)

  if (paneIds.length === 0) {
    return null
  }

  const candidates = [
    activePaneId,
    surfaceId ? (state.rememberedPaneIdsBySurface[surfaceId] ?? null) : null,
    surfaceId
      ? (snapshot.lastActivePaneIdsBySurface?.[surfaceId] ?? null)
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
    activeSurfaceId: null,
    activeWorkspaceId: null,
    rememberedPaneIdsBySurface: {},
    rememberedSurfaceIdsByWorkspace: {},
    rememberedWorkspaceIdsByProject: {},
  }
}

export function resolveSpatialNavigationState(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
): SpatialNavigationState {
  const activeProjectId = resolveProjectId(snapshot, state.activeProjectId)
  const activeWorkspaceId = resolveWorkspaceId(
    snapshot,
    state,
    activeProjectId,
    state.activeWorkspaceId,
  )
  const activeSurfaceId = resolveSurfaceId(
    snapshot,
    state,
    activeWorkspaceId,
    state.activeSurfaceId,
    getSurfaceIdsForWorkspace,
  )
  const activePaneId = resolvePaneId(
    snapshot,
    state,
    activeSurfaceId,
    state.activePaneId,
    getPaneIdsForSurface,
  )

  return {
    activePaneId,
    activeProjectId,
    activeSurfaceId,
    activeWorkspaceId,
    rememberedPaneIdsBySurface: activeSurfaceId
      ? {
          ...state.rememberedPaneIdsBySurface,
          [activeSurfaceId]: activePaneId,
        }
      : state.rememberedPaneIdsBySurface,
    rememberedSurfaceIdsByWorkspace: activeWorkspaceId
      ? {
          ...state.rememberedSurfaceIdsByWorkspace,
          [activeWorkspaceId]: activeSurfaceId,
        }
      : state.rememberedSurfaceIdsByWorkspace,
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
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
): SpatialNavigationState {
  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: null,
      activeProjectId: projectId,
      activeSurfaceId: null,
      activeWorkspaceId: null,
    },
    getSurfaceIdsForWorkspace,
    getPaneIdsForSurface,
  )
}

export function applyWorkspaceSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  workspaceId: string,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
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
      activeSurfaceId: null,
      activeWorkspaceId: workspace.id,
      rememberedWorkspaceIdsByProject: {
        ...state.rememberedWorkspaceIdsByProject,
        [workspace.projectId]: workspace.id,
      },
    },
    getSurfaceIdsForWorkspace,
    getPaneIdsForSurface,
  )
}

export function applySurfaceSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  surfaceId: string,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
): SpatialNavigationState {
  const surfaceIds = getSurfaceIdsForWorkspace(state.activeWorkspaceId)

  if (!state.activeWorkspaceId || !surfaceIds.includes(surfaceId)) {
    return state
  }

  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: null,
      activeSurfaceId: surfaceId,
      rememberedSurfaceIdsByWorkspace: {
        ...state.rememberedSurfaceIdsByWorkspace,
        [state.activeWorkspaceId]: surfaceId,
      },
    },
    getSurfaceIdsForWorkspace,
    getPaneIdsForSurface,
  )
}

export function applyPaneSelection(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  paneId: string,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
): SpatialNavigationState {
  const paneIds = getPaneIdsForSurface(state.activeSurfaceId)

  if (!state.activeSurfaceId || !paneIds.includes(paneId)) {
    return state
  }

  return resolveSpatialNavigationState(
    snapshot,
    {
      ...state,
      activePaneId: paneId,
      rememberedPaneIdsBySurface: {
        ...state.rememberedPaneIdsBySurface,
        [state.activeSurfaceId]: paneId,
      },
    },
    getSurfaceIdsForWorkspace,
    getPaneIdsForSurface,
  )
}

export function moveRelativeWorkspace(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  direction: -1 | 1,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
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
        getSurfaceIdsForWorkspace,
        getPaneIdsForSurface,
      )
    : state
}

export function moveRelativePane(
  snapshot: PersistenceSnapshot,
  state: SpatialNavigationState,
  direction: -1 | 1,
  getSurfaceIdsForWorkspace: SurfaceResolver,
  getPaneIdsForSurface: PaneResolver,
): SpatialNavigationState {
  const surfaceIds = getSurfaceIdsForWorkspace(state.activeWorkspaceId)

  if (!state.activeWorkspaceId || surfaceIds.length === 0) {
    return state
  }

  const currentSurfaceId = resolveSurfaceId(
    snapshot,
    state,
    state.activeWorkspaceId,
    state.activeSurfaceId,
    getSurfaceIdsForWorkspace,
  )
  const currentIndex = surfaceIds.findIndex(
    (surfaceId) => surfaceId === currentSurfaceId,
  )

  if (currentIndex === -1) {
    return state
  }

  const nextSurfaceId =
    surfaceIds[
      (currentIndex + direction + surfaceIds.length) % surfaceIds.length
    ]

  return nextSurfaceId
    ? applySurfaceSelection(
        snapshot,
        state,
        nextSurfaceId,
        getSurfaceIdsForWorkspace,
        getPaneIdsForSurface,
      )
    : state
}
