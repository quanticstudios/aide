import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
  ProjectRefRecord,
} from '../../shared/git'
import type { AideApi } from '../../shared/ipc'
import {
  createEmptyPersistenceSnapshot,
  type PersistenceSnapshot,
  type SaveWorkspaceSurfaceStateInput,
  type SurfaceLayoutRecord,
  type WorkspaceLayoutRecord,
} from '../../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../../shared/preview'
import type { PersistedStateRecovery } from '../../shared/recovery'
import type { SavedTask } from '../../shared/task-library'
import {
  reconcileUpdatePreferencesSnapshot,
  reconcileUpdateSnapshot,
  type UpdateEvent,
  type UpdatePreferencesEvent,
  type UpdatePreferencesInput,
  type UpdatePreferencesSnapshot,
  type UpdateRestartStatus,
  type UpdateSnapshot,
} from '../../shared/update'
import type { WorkspaceActivitySnapshot } from '../../shared/workspace-activity'
import type {
  WorkspaceSetupCollectionSnapshot,
  WorkspaceSetupSnapshot,
} from '../../shared/workspace-setup'
import AppShell from './components/AppShell'
import PersistedStateRecoveryScreen from './components/PersistedStateRecoveryScreen'
import PreviewBrowserHost, {
  type PreviewBrowserControl,
  type PreviewPresentation,
} from './components/PreviewBrowserHost'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import WorkspaceSetupStatus from './components/WorkspaceSetupStatus'
import { buildCommandList } from './lib/command-registry'
import {
  getPaneCatalogEntryForTemplate,
  getPaneTemplateId,
  resolvePaneMetadata,
  resolvePaneType,
} from './lib/pane-catalog'
import { hydrateRevisionedState } from './lib/revisioned-hydration'
import {
  applyPaneSelection,
  applyProjectSelection,
  applySurfaceSelection,
  applyWorkspaceSelection,
  moveRelativePane,
  moveRelativeWorkspace,
  resolveSpatialNavigationState,
  type SpatialNavigationState,
} from './lib/spatial-navigation-state'
import {
  createUpdateSnoozeUntil,
  getUpdatePresentationRefreshDelay,
  resolveUpdatePresentation,
} from './lib/update-presentation'
import { collectWorkspaceLayoutPaneIds } from './lib/workspace-layout'
import {
  addPaneView,
  closeWorkspacePane,
  createWorkspacePaneInstanceId,
  removePaneView,
  resizeWorkspacePane,
  splitWorkspacePane,
  switchPaneView,
} from './lib/workspace-layout-mutations'
import { WorkspaceMutationQueue } from './lib/workspace-mutation-queue'
import { useWorkspaceSelectionStore } from './lib/workspace-selection-store'
import {
  getOrderedWorkspaces,
  resolveProjectShortcutTarget,
} from './lib/workspace-shortcuts'
import { buildWorkspaceSummaryMap } from './lib/workspace-summary'
import {
  createSinglePaneSurface,
  findWorkspaceIdForSurface,
  resolveSurfaceLayout,
  resolveWorkspaceSurfaces,
} from './lib/workspace-surfaces'

const LazyCommandPalette = lazy(() => import('./components/CommandPalette'))
const LazyDiagnosticsModal = lazy(() => import('./components/DiagnosticsModal'))
const LazyUpdateModal = lazy(() => import('./components/UpdateModal'))
const LazyPaneCreationModal = lazy(
  () => import('./components/PaneCreationModal'),
)
const LazyWorkspaceCreationModal = lazy(
  () => import('./components/WorkspaceCreationModal'),
)
const LazyWorkspaceSwitcherOverlay = lazy(
  () => import('./components/WorkspaceSwitcherOverlay'),
)
const LazyProjectSetupModal = lazy(
  () => import('./components/ProjectSetupModal'),
)
const LazySettingsPage = lazy(() => import('./components/SettingsPage'))

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown renderer error'
}

function OverlayLoadFallback() {
  return (
    <div aria-live="polite" className="sr-only">
      Opening workspace controls…
    </div>
  )
}

function shouldIgnoreGlobalNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

function recordsEqual(
  left: Record<string, string | null>,
  right: Record<string, string | null>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)

  if (leftKeys.length !== rightKeys.length) {
    return false
  }

  return leftKeys.every((key) => left[key] === right[key])
}

function prioritizeProjectRefs(
  refs: readonly ProjectRefRecord[],
  defaultBranch: string | null,
): ProjectRefRecord[] {
  const preferredNames = new Set(
    [defaultBranch, defaultBranch ? `origin/${defaultBranch}` : null].filter(
      (candidate): candidate is string => Boolean(candidate),
    ),
  )

  return [...refs].sort((left, right) => {
    const leftPreferred = preferredNames.has(left.name)
    const rightPreferred = preferredNames.has(right.name)

    if (leftPreferred !== rightPreferred) {
      return leftPreferred ? -1 : 1
    }

    if (left.source !== right.source) {
      return left.source === 'local' ? -1 : 1
    }

    return left.displayName.localeCompare(right.displayName)
  })
}

export default function App() {
  const [persistedStateRecovery, setPersistedStateRecovery] = useState<
    PersistedStateRecovery | null | undefined
  >(undefined)
  const [startupError, setStartupError] = useState<string | null>(null)

  useEffect(() => {
    const api = getAideApi()
    if (!api) {
      setStartupError('Desktop bridge did not load. Reload the app window.')
      return
    }

    void api
      .getPersistedStateRecovery()
      .then(setPersistedStateRecovery)
      .catch((error: unknown) => setStartupError(getErrorMessage(error)))
  }, [])

  if (startupError) {
    return (
      <main className="recovery-screen" role="alert">
        <section className="recovery-card">
          <h1>Aide could not check its saved data</h1>
          <p>{startupError}</p>
        </section>
      </main>
    )
  }

  if (persistedStateRecovery === undefined) {
    return (
      <main aria-live="polite" className="recovery-screen">
        <section className="recovery-card">
          <h1>Opening saved data</h1>
        </section>
      </main>
    )
  }

  if (persistedStateRecovery) {
    const api = getAideApi()
    if (!api) {
      return null
    }

    return (
      <PersistedStateRecoveryScreen
        api={api}
        recovery={persistedStateRecovery}
      />
    )
  }

  return <WorkspaceApp />
}

function WorkspaceApp() {
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPaneCreationOpen, setIsPaneCreationOpen] = useState(false)
  const [isWorkspaceSwitcherVisible, setIsWorkspaceSwitcherVisible] =
    useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isFleetOpen, setIsFleetOpen] = useState(false)
  const [isSidebarOpen, setIsSidebarOpen] = useState(
    () => window.localStorage.getItem('aide.sidebar.pinned') === 'true',
  )
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isUpdateOpen, setIsUpdateOpen] = useState(false)
  const [updateSnapshot, setUpdateSnapshot] = useState<UpdateSnapshot | null>(
    null,
  )
  const [updatePreferences, setUpdatePreferences] =
    useState<UpdatePreferencesSnapshot | null>(null)
  const [updateRestartStatus, setUpdateRestartStatus] =
    useState<UpdateRestartStatus | null>(null)
  const [updateActionError, setUpdateActionError] = useState<string | null>(
    null,
  )
  const [updateSnapshotHydrationError, setUpdateSnapshotHydrationError] =
    useState<string | null>(null)
  const [updatePreferencesHydrationError, setUpdatePreferencesHydrationError] =
    useState<string | null>(null)
  const [updatePresentationNow, setUpdatePresentationNow] = useState(
    () => new Date(),
  )
  const [isOverviewVisible, setIsOverviewVisible] = useState(false)
  const [isWorkspaceCreationOpen, setIsWorkspaceCreationOpen] = useState(false)
  const [projectSetupProjectId, setProjectSetupProjectId] = useState<
    string | null
  >(null)
  const [showProjectHints, setShowProjectHints] = useState(false)
  const [workspaceActivities, setWorkspaceActivities] = useState<
    Record<string, WorkspaceActivitySnapshot[]>
  >({})
  const [previewSnapshots, setPreviewSnapshots] = useState<
    Record<string, WorkspacePreviewSnapshot>
  >({})
  const [workspaceSetups, setWorkspaceSetups] = useState<
    Record<string, WorkspaceSetupSnapshot>
  >({})
  const [previewPresentation, setPreviewPresentation] =
    useState<PreviewPresentation | null>(null)
  const [previewBrowserAction, setPreviewBrowserAction] = useState<{
    id: number
    type: PreviewBrowserControl
  } | null>(null)
  const previewRevisionsRef = useRef<Record<string, number>>({})
  const settingsReturnFocusRef = useRef<HTMLElement | null>(null)
  const updateReturnFocusRef = useRef<HTMLElement | null>(null)
  const workspaceActivityRevisionRef = useRef(-1)
  const workspaceSetupRevisionRef = useRef(-1)
  const storageSnapshotRef = useRef<PersistenceSnapshot | null>(null)
  const resolvedNavigationStateRef = useRef<SpatialNavigationState | null>(null)
  const [workspaceMutationQueue] = useState(() => new WorkspaceMutationQueue())
  const closeSettings = useCallback(() => {
    setIsSettingsOpen(false)
    const returnFocus = settingsReturnFocusRef.current
    settingsReturnFocusRef.current = null
    requestAnimationFrame(() => returnFocus?.focus())
  }, [])
  const openSettings = useCallback((trigger: HTMLElement) => {
    settingsReturnFocusRef.current = trigger
    setIsCommandPaletteOpen(false)
    setIsOverviewVisible(false)
    setIsWorkspaceSwitcherVisible(false)
    setIsSettingsOpen(true)
  }, [])
  const lastResolvedNavigationRef = useRef('')
  const activeProjectId = useWorkspaceSelectionStore(
    (state) => state.activeProjectId,
  )
  const activeWorkspaceId = useWorkspaceSelectionStore(
    (state) => state.activeWorkspaceId,
  )
  const activePaneId = useWorkspaceSelectionStore((state) => state.activePaneId)
  const activeSurfaceId = useWorkspaceSelectionStore(
    (state) => state.activeSurfaceId,
  )
  const rememberedPaneIdsBySurface = useWorkspaceSelectionStore(
    (state) => state.rememberedPaneIdsBySurface,
  )
  const rememberedSurfaceIdsByWorkspace = useWorkspaceSelectionStore(
    (state) => state.rememberedSurfaceIdsByWorkspace,
  )
  const rememberedWorkspaceIdsByProject = useWorkspaceSelectionStore(
    (state) => state.rememberedWorkspaceIdsByProject,
  )
  const setSelection = useWorkspaceSelectionStore((state) => state.setSelection)
  const navigationSnapshot = storageSnapshot ?? createEmptyPersistenceSnapshot()
  const updatePreviewSnapshot = useCallback(
    (snapshot: WorkspacePreviewSnapshot) => {
      if (
        (previewRevisionsRef.current[snapshot.workspaceId] ?? -1) >=
        snapshot.revision
      ) {
        return
      }

      previewRevisionsRef.current[snapshot.workspaceId] = snapshot.revision
      setPreviewSnapshots((current) => ({
        ...current,
        [snapshot.workspaceId]: snapshot,
      }))
    },
    [],
  )
  const applyWorkspaceSetupCollection = useCallback(
    (snapshot: WorkspaceSetupCollectionSnapshot) => {
      if (snapshot.revision < workspaceSetupRevisionRef.current) {
        return
      }
      workspaceSetupRevisionRef.current = snapshot.revision
      setWorkspaceSetups(snapshot.setupsByWorkspace)
    },
    [],
  )
  const applyWorkspaceSetupEvent = useCallback(
    (event: { revision: number; setup: WorkspaceSetupSnapshot }) => {
      if (event.revision <= workspaceSetupRevisionRef.current) {
        return
      }
      workspaceSetupRevisionRef.current = event.revision
      setWorkspaceSetups((current) => ({
        ...current,
        [event.setup.workspaceId]: event.setup,
      }))
    },
    [],
  )
  const getSurfaceIdsForSnapshot = useCallback(
    (snapshot: PersistenceSnapshot, workspaceId: string | null) => {
      return resolveWorkspaceSurfaces(snapshot, workspaceId).map(
        (surface) => surface.id,
      )
    },
    [],
  )
  const getPaneIdsForSnapshot = useCallback(
    (
      snapshot: PersistenceSnapshot,
      workspaceId: string | null,
      surfaceId: string | null,
    ) => {
      const layout = resolveSurfaceLayout(snapshot, workspaceId, surfaceId)

      return collectWorkspaceLayoutPaneIds(layout)
    },
    [],
  )
  const getPaneIdsForSnapshotBySurface = useCallback(
    (snapshot: PersistenceSnapshot, surfaceId: string | null) =>
      getPaneIdsForSnapshot(
        snapshot,
        findWorkspaceIdForSurface(snapshot, surfaceId),
        surfaceId,
      ),
    [getPaneIdsForSnapshot],
  )
  const getSurfaceIdsForWorkspace = useCallback(
    (workspaceId: string | null) =>
      getSurfaceIdsForSnapshot(navigationSnapshot, workspaceId),
    [getSurfaceIdsForSnapshot, navigationSnapshot],
  )
  const getPaneIdsForWorkspace = useCallback(
    (surfaceId: string | null) =>
      getPaneIdsForSnapshotBySurface(navigationSnapshot, surfaceId),
    [getPaneIdsForSnapshotBySurface, navigationSnapshot],
  )
  const currentNavigationState = useMemo(
    () => ({
      activePaneId,
      activeSurfaceId,
      activeProjectId,
      activeWorkspaceId,
      rememberedPaneIdsBySurface,
      rememberedSurfaceIdsByWorkspace,
      rememberedWorkspaceIdsByProject,
    }),
    [
      activePaneId,
      rememberedPaneIdsBySurface,
      activeProjectId,
      activeSurfaceId,
      rememberedSurfaceIdsByWorkspace,
      activeWorkspaceId,
      rememberedWorkspaceIdsByProject,
    ],
  )
  const resolvedNavigationState = useMemo(
    () =>
      resolveSpatialNavigationState(
        navigationSnapshot,
        currentNavigationState,
        getSurfaceIdsForWorkspace,
        getPaneIdsForWorkspace,
      ),
    [
      currentNavigationState,
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      navigationSnapshot,
    ],
  )
  storageSnapshotRef.current = storageSnapshot
  useEffect(() => {
    resolvedNavigationStateRef.current = resolvedNavigationState
  }, [resolvedNavigationState])
  const legacyPaneIdsByWorkspace = useMemo(
    () =>
      Object.entries(
        resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
      ).reduce<Record<string, string | null>>(
        (acc, [workspaceId, surfaceId]) => {
          acc[workspaceId] = surfaceId
            ? (resolvedNavigationState.rememberedPaneIdsBySurface[surfaceId] ??
              null)
            : null
          return acc
        },
        {},
      ),
    [
      resolvedNavigationState.rememberedPaneIdsBySurface,
      resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
    ],
  )

  const refreshStorage = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const snapshot = await api.getStorageSnapshot()
      storageSnapshotRef.current = snapshot
      setStorageSnapshot(snapshot)
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [])

  const openProject = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const selectedProject =
        navigationSnapshot.projects.find(
          (project) => project.id === activeProjectId,
        ) ?? null
      const runtimeSnapshot = await api.getRuntimeSnapshot()
      const selectedRepoRoot = await api.pickProjectRoot(
        selectedProject?.repoRoot ?? runtimeSnapshot.workingDirectory,
      )
      if (!selectedRepoRoot) {
        return
      }

      const result = await api.importProject(selectedRepoRoot)
      const nextState = applyWorkspaceSelection(
        result.snapshot,
        resolvedNavigationState,
        result.workspaceId,
        (workspaceId) => getSurfaceIdsForSnapshot(result.snapshot, workspaceId),
        (surfaceId) =>
          getPaneIdsForSnapshotBySurface(result.snapshot, surfaceId),
      )

      setStorageSnapshot(result.snapshot)
      setSelection(nextState)
      setActionError(null)
      setShellError(null)
    } catch (error) {
      setActionError(getErrorMessage(error))
    }
  }, [
    activeProjectId,
    getPaneIdsForSnapshotBySurface,
    getSurfaceIdsForSnapshot,
    navigationSnapshot.projects,
    resolvedNavigationState,
    setSelection,
  ])

  const createWorkspace = useCallback(
    (requestedProjectId?: string) => {
      const project = navigationSnapshot.projects.find(
        (candidate) => candidate.id === (requestedProjectId ?? activeProjectId),
      )
      if (!project || project.kind === 'folder') {
        return
      }

      setIsWorkspaceCreationOpen(true)
    },
    [activeProjectId, navigationSnapshot.projects],
  )

  const renameWorkspace = useCallback(
    async (workspaceId: string, name: string): Promise<string | null> => {
      const api = getAideApi()
      if (!api) return 'Desktop bridge did not load. Reload the app window.'

      try {
        const snapshot = await api.renameWorkspace(workspaceId, name)
        storageSnapshotRef.current = snapshot
        setStorageSnapshot(snapshot)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [],
  )

  const createPane = useCallback(() => {
    if (!resolvedNavigationState.activeWorkspaceId) {
      return
    }

    setIsPaneCreationOpen(true)
  }, [resolvedNavigationState.activeWorkspaceId])

  const submitWorkspaceCreation = useCallback(
    async (input: Omit<CreateWorkspaceRequest, 'windowId'>) => {
      const api = getAideApi()

      if (!api) {
        return 'Desktop bridge did not load. Reload the app window.'
      }

      try {
        const gitValidation = await api.validateExecutableCommand('git')

        if (!gitValidation.ok) {
          return gitValidation.error
        }

        const snapshot = await api.createWorkspace({
          baseBranch: input.baseBranch,
          branchName: input.branchName,
          name: input.name,
          projectId: input.projectId,
          worktreePath: input.worktreePath,
          windowId: null,
        })
        const latestWorkspaceId = snapshot.workspaces.at(-1)?.id ?? null

        if (!latestWorkspaceId) {
          return 'Workspace was created but no workspace record was returned.'
        }

        const nextState = applyWorkspaceSelection(
          snapshot,
          resolvedNavigationStateRef.current ?? resolvedNavigationState,
          latestWorkspaceId,
          (workspaceId) => getSurfaceIdsForSnapshot(snapshot, workspaceId),
          (surfaceId) => getPaneIdsForSnapshotBySurface(snapshot, surfaceId),
        )

        setStorageSnapshot(snapshot)
        resolvedNavigationStateRef.current = nextState
        setSelection(nextState)
        setActionError(null)
        setShellError(null)
        setIsWorkspaceCreationOpen(false)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [
      getPaneIdsForSnapshotBySurface,
      getSurfaceIdsForSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const submitWorkspaceAttachment = useCallback(
    async (input: Omit<AttachWorkspaceRequest, 'windowId'>) => {
      const api = getAideApi()

      if (!api) {
        return 'Desktop bridge did not load. Reload the app window.'
      }

      try {
        const gitValidation = await api.validateExecutableCommand('git')

        if (!gitValidation.ok) {
          return gitValidation.error
        }

        const snapshot = await api.attachWorkspace({
          name: input.name,
          projectId: input.projectId,
          worktreePath: input.worktreePath,
          windowId: null,
        })
        const latestWorkspaceId = snapshot.workspaces.at(-1)?.id ?? null

        if (!latestWorkspaceId) {
          return 'Workspace was attached but no workspace record was returned.'
        }

        const nextState = applyWorkspaceSelection(
          snapshot,
          resolvedNavigationStateRef.current ?? resolvedNavigationState,
          latestWorkspaceId,
          (workspaceId) => getSurfaceIdsForSnapshot(snapshot, workspaceId),
          (surfaceId) => getPaneIdsForSnapshotBySurface(snapshot, surfaceId),
        )

        setStorageSnapshot(snapshot)
        resolvedNavigationStateRef.current = nextState
        setSelection(nextState)
        setActionError(null)
        setShellError(null)
        setIsWorkspaceCreationOpen(false)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [
      getPaneIdsForSnapshotBySurface,
      getSurfaceIdsForSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const saveProjectSetupCommand = useCallback(
    async (projectId: string, command: string | null) => {
      const api = getAideApi()
      if (!api) return 'Desktop bridge did not load. Reload the app window.'

      try {
        const snapshot = await api.updateProjectSetupCommand(projectId, command)
        storageSnapshotRef.current = snapshot
        setStorageSnapshot(snapshot)
        setActionError(null)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [],
  )

  const listProjectRefs = useCallback(
    async (projectId: string) => {
      const api = getAideApi()

      if (!api) {
        throw new Error('Desktop bridge did not load. Reload the app window.')
      }

      const refs = await api.listProjectRefs(projectId)
      const selectedProject =
        navigationSnapshot.projects.find(
          (project) => project.id === projectId,
        ) ?? null

      return prioritizeProjectRefs(refs, selectedProject?.defaultBranch ?? null)
    },
    [navigationSnapshot.projects],
  )

  useEffect(() => {
    const api = getAideApi()

    if (!api) {
      void refreshStorage()
      return
    }

    let isHydrating = true
    let bufferedEvents: Array<{
      revision: number
      snapshot: PersistenceSnapshot
    }> = []
    const applySnapshot = (snapshot: PersistenceSnapshot) => {
      if (
        (storageSnapshotRef.current?.catalogRevision ?? -1) >=
        snapshot.catalogRevision
      ) {
        return
      }
      storageSnapshotRef.current = snapshot
      setStorageSnapshot(snapshot)
    }
    const unsubscribe = api.onWorkspacePersistence((event) => {
      if (isHydrating) {
        bufferedEvents.push(event)
        return
      }
      applySnapshot(event.snapshot)
    })

    void (async () => {
      try {
        const snapshot = await api.getStorageSnapshot()
        storageSnapshotRef.current = snapshot
        setStorageSnapshot(snapshot)
        isHydrating = false
        for (const event of bufferedEvents.sort(
          (left, right) => left.revision - right.revision,
        )) {
          applySnapshot(event.snapshot)
        }
        bufferedEvents = []
        setShellError(null)
      } catch (error) {
        setShellError(getErrorMessage(error))
      } finally {
        isHydrating = false
      }
    })()

    return unsubscribe
  }, [refreshStorage])

  useEffect(() => {
    const api = getAideApi()
    if (!api) return

    const unsubscribeUpdate = hydrateRevisionedState<
      UpdateSnapshot,
      UpdateEvent
    >({
      fetchSnapshot: api.getUpdateSnapshot,
      onError: () => {
        setUpdateSnapshotHydrationError(
          'Software update status is temporarily unavailable. Retrying automatically.',
        )
      },
      onSnapshot: (snapshot) => {
        setUpdateSnapshotHydrationError(null)
        setUpdatePresentationNow(new Date())
        setUpdateSnapshot(snapshot)
      },
      reconcile: reconcileUpdateSnapshot,
      subscribe: api.onUpdateEvent,
    })
    const unsubscribePreferences = hydrateRevisionedState<
      UpdatePreferencesSnapshot,
      UpdatePreferencesEvent
    >({
      fetchSnapshot: api.getUpdatePreferences,
      onError: () => {
        setUpdatePreferencesHydrationError(
          'Software update preferences are temporarily unavailable. Retrying automatically.',
        )
      },
      onSnapshot: (snapshot) => {
        setUpdatePreferencesHydrationError(null)
        setUpdatePresentationNow(new Date())
        setUpdatePreferences(snapshot)
      },
      reconcile: reconcileUpdatePreferencesSnapshot,
      subscribe: api.onUpdatePreferences,
    })

    return () => {
      unsubscribeUpdate()
      unsubscribePreferences()
    }
  }, [])

  useEffect(() => {
    const api = getAideApi()
    if (!api) return

    let isHydrating = true
    let bufferedEvents: WorkspacePreviewSnapshot[] = []
    const unsubscribe = api.onPreviewEvent((event) => {
      if (isHydrating) {
        bufferedEvents.push(event.snapshot)
        return
      }
      updatePreviewSnapshot(event.snapshot)
    })

    void api
      .getWorkspacePreviewSnapshots()
      .then((snapshots) => {
        for (const snapshot of Object.values(snapshots)) {
          updatePreviewSnapshot(snapshot)
        }
        isHydrating = false
        for (const snapshot of bufferedEvents.sort(
          (left, right) => left.revision - right.revision,
        )) {
          updatePreviewSnapshot(snapshot)
        }
        bufferedEvents = []
      })
      .catch((error) => {
        isHydrating = false
        setShellError(getErrorMessage(error))
      })

    return unsubscribe
  }, [updatePreviewSnapshot])

  useEffect(() => {
    const api = getAideApi()
    if (!api) return

    let isHydrating = true
    let bufferedEvents: Array<{
      revision: number
      setup: WorkspaceSetupSnapshot
    }> = []
    const unsubscribe = api.onWorkspaceSetup((event) => {
      if (isHydrating) {
        bufferedEvents.push(event)
        return
      }
      applyWorkspaceSetupEvent(event)
    })

    void api
      .getWorkspaceSetupSnapshot()
      .then((snapshot) => {
        applyWorkspaceSetupCollection(snapshot)
        isHydrating = false
        for (const event of bufferedEvents.sort(
          (left, right) => left.revision - right.revision,
        )) {
          applyWorkspaceSetupEvent(event)
        }
        bufferedEvents = []
      })
      .catch((error) => {
        isHydrating = false
        setShellError(getErrorMessage(error))
      })

    return unsubscribe
  }, [applyWorkspaceSetupCollection, applyWorkspaceSetupEvent])

  useEffect(() => {
    const resolvedSignature = JSON.stringify(resolvedNavigationState)

    if (
      activePaneId === resolvedNavigationState.activePaneId &&
      activeSurfaceId === resolvedNavigationState.activeSurfaceId &&
      activeProjectId === resolvedNavigationState.activeProjectId &&
      activeWorkspaceId === resolvedNavigationState.activeWorkspaceId &&
      recordsEqual(
        rememberedPaneIdsBySurface,
        resolvedNavigationState.rememberedPaneIdsBySurface,
      ) &&
      recordsEqual(
        rememberedSurfaceIdsByWorkspace,
        resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
      ) &&
      recordsEqual(
        rememberedWorkspaceIdsByProject,
        resolvedNavigationState.rememberedWorkspaceIdsByProject,
      )
    ) {
      lastResolvedNavigationRef.current = resolvedSignature
      return
    }

    if (lastResolvedNavigationRef.current === resolvedSignature) {
      return
    }

    lastResolvedNavigationRef.current = resolvedSignature
    setSelection(resolvedNavigationState)
  }, [
    activePaneId,
    activeSurfaceId,
    rememberedPaneIdsBySurface,
    activeProjectId,
    rememberedSurfaceIdsByWorkspace,
    activeWorkspaceId,
    rememberedWorkspaceIdsByProject,
    resolvedNavigationState,
    setSelection,
  ])

  useEffect(() => {
    const api = getAideApi()

    if (!api || !storageSnapshot || storageSnapshot.projects.length === 0) {
      return
    }

    void api
      .setActiveSelection({
        paneIdsBySurface: resolvedNavigationState.rememberedPaneIdsBySurface,
        paneIdsByWorkspace: legacyPaneIdsByWorkspace,
        projectId: resolvedNavigationState.activeProjectId,
        surfaceIdsByWorkspace:
          resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
        workspaceIdsByProject:
          resolvedNavigationState.rememberedWorkspaceIdsByProject,
        workspaceId: resolvedNavigationState.activeWorkspaceId,
      })
      .catch((error: unknown) => {
        setShellError(getErrorMessage(error))
      })
  }, [
    resolvedNavigationState.rememberedPaneIdsBySurface,
    resolvedNavigationState.activeProjectId,
    resolvedNavigationState.activeWorkspaceId,
    resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
    resolvedNavigationState.rememberedWorkspaceIdsByProject,
    legacyPaneIdsByWorkspace,
    storageSnapshot,
  ])

  const handleProjectSelection = useCallback(
    (projectId: string) => {
      setSelection(
        applyProjectSelection(
          navigationSnapshot,
          resolvedNavigationState,
          projectId,
          getSurfaceIdsForWorkspace,
          getPaneIdsForWorkspace,
        ),
      )
    },
    [
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const handleWorkspaceSelection = useCallback(
    (workspaceId: string) => {
      const selection = applyWorkspaceSelection(
        navigationSnapshot,
        resolvedNavigationStateRef.current ?? resolvedNavigationState,
        workspaceId,
        getSurfaceIdsForWorkspace,
        getPaneIdsForWorkspace,
      )
      resolvedNavigationStateRef.current = selection
      setSelection(selection)
      setIsWorkspaceSwitcherVisible(false)
      setIsOverviewVisible(false)
    },
    [
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const handleRelativeWorkspaceSelection = useCallback(
    (direction: -1 | 1) => {
      const selection = moveRelativeWorkspace(
        navigationSnapshot,
        resolvedNavigationStateRef.current ?? resolvedNavigationState,
        direction,
        getSurfaceIdsForWorkspace,
        getPaneIdsForWorkspace,
      )
      resolvedNavigationStateRef.current = selection
      setSelection(selection)
    },
    [
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const handleRelativePaneSelection = useCallback(
    (direction: -1 | 1) => {
      const selection = moveRelativePane(
        navigationSnapshot,
        resolvedNavigationStateRef.current ?? resolvedNavigationState,
        direction,
        getSurfaceIdsForWorkspace,
        getPaneIdsForWorkspace,
      )
      resolvedNavigationStateRef.current = selection
      setSelection(selection)
    },
    [
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const resolveSelectionForSnapshot = useCallback(
    (
      snapshot: PersistenceSnapshot,
      workspaceId: string,
      nextActiveSurfaceId: string | null,
      nextActivePaneId: string | null,
    ) =>
      resolveSpatialNavigationState(
        snapshot,
        {
          ...(resolvedNavigationStateRef.current ?? resolvedNavigationState),
          activePaneId: nextActivePaneId,
          activeSurfaceId: nextActiveSurfaceId,
          rememberedPaneIdsBySurface: nextActiveSurfaceId
            ? {
                ...(
                  resolvedNavigationStateRef.current ?? resolvedNavigationState
                ).rememberedPaneIdsBySurface,
                [nextActiveSurfaceId]: nextActivePaneId,
              }
            : (resolvedNavigationStateRef.current ?? resolvedNavigationState)
                .rememberedPaneIdsBySurface,
          rememberedSurfaceIdsByWorkspace: {
            ...(resolvedNavigationStateRef.current ?? resolvedNavigationState)
              .rememberedSurfaceIdsByWorkspace,
            [workspaceId]: nextActiveSurfaceId,
          },
        },
        (targetWorkspaceId) =>
          getSurfaceIdsForSnapshot(snapshot, targetWorkspaceId),
        (surfaceId) => getPaneIdsForSnapshotBySurface(snapshot, surfaceId),
      ),
    [
      getPaneIdsForSnapshotBySurface,
      getSurfaceIdsForSnapshot,
      resolvedNavigationState,
    ],
  )

  const persistWorkspaceSurfaceStateChange = useCallback(
    async (
      workspaceId: string,
      surfaces: readonly {
        id: string
        orderIndex: number
        rootNodeId: string
        title: string
        workspaceId: string
      }[],
      layouts: Record<string, SurfaceLayoutRecord>,
      nextActiveSurfaceId: string | null,
      nextActivePaneId: string | null,
      shouldUpdateSelection = true,
    ) => {
      const currentSnapshot = storageSnapshotRef.current ?? navigationSnapshot
      const currentSurfaceIds = resolveWorkspaceSurfaces(
        currentSnapshot,
        workspaceId,
      ).map((surface) => surface.id)
      const nextSurfaceLayouts = { ...currentSnapshot.surfaceLayouts }

      for (const surfaceId of currentSurfaceIds) {
        delete nextSurfaceLayouts[surfaceId]
      }

      Object.assign(nextSurfaceLayouts, layouts)

      const api = getAideApi()

      if (!api) {
        setShellError('Desktop bridge did not load. Reload the app window.')
        return
      }

      const result = await api.saveWorkspaceSurfaceState(workspaceId, {
        expectedRevision:
          currentSnapshot.workspaceSurfaceRevisions?.[workspaceId] ?? 0,
        layouts: Object.fromEntries(
          Object.entries(layouts).map(([surfaceId, layout]) => [
            surfaceId,
            {
              nodes: layout.nodes,
              rootNodeId: layout.rootNodeId,
            },
          ]),
        ) as SaveWorkspaceSurfaceStateInput['layouts'],
        surfaces: [...surfaces],
      })

      if (!result.ok) {
        storageSnapshotRef.current = result.snapshot
        setStorageSnapshot(result.snapshot)
        setShellError(
          'Workspace changed elsewhere. The latest layout has been restored.',
        )
        return
      }

      const { snapshot } = result

      storageSnapshotRef.current = snapshot
      setStorageSnapshot(snapshot)
      if (!shouldUpdateSelection) {
        setShellError(null)
        return
      }

      const nextSelection = resolveSelectionForSnapshot(
        snapshot,
        workspaceId,
        nextActiveSurfaceId,
        nextActivePaneId,
      )
      resolvedNavigationStateRef.current = nextSelection
      setSelection(nextSelection)
      setShellError(null)
    },
    [navigationSnapshot, resolveSelectionForSnapshot, setSelection],
  )

  const applyWorkspaceLayoutChange = useCallback(
    async (
      workspaceId: string,
      surfaceId: string,
      mutateLayout: (
        layout: WorkspaceLayoutRecord,
      ) => ReturnType<typeof splitWorkspacePane>,
      shouldUpdateSelection = true,
    ) => {
      const currentSnapshot = storageSnapshotRef.current ?? navigationSnapshot

      const currentLayout = resolveSurfaceLayout(
        currentSnapshot,
        workspaceId,
        surfaceId,
      )

      if (!currentLayout) {
        return
      }

      const surfaces = resolveWorkspaceSurfaces(currentSnapshot, workspaceId)
      const nextLayouts = surfaces.reduce<Record<string, SurfaceLayoutRecord>>(
        (acc, surface) => {
          const layout = resolveSurfaceLayout(
            currentSnapshot,
            workspaceId,
            surface.id,
          )

          if (layout) {
            acc[surface.id] = layout
          }

          return acc
        },
        {},
      )

      const result = mutateLayout(currentLayout)

      if (!result.didChange) {
        return
      }

      const closeRemovedSessions = async (
        nextLayout: WorkspaceLayoutRecord | null,
      ) => {
        const api = getAideApi()

        if (!api) {
          return
        }

        const collectSessionPaneIds = (layout: WorkspaceLayoutRecord) =>
          layout.nodes.flatMap((node) =>
            node.type === 'pane' ? node.viewIds : [],
          )
        const nextPaneIds = new Set(
          nextLayout ? collectSessionPaneIds(nextLayout) : [],
        )
        const removedPaneIds = collectSessionPaneIds(currentLayout).filter(
          (paneId) => !nextPaneIds.has(paneId),
        )

        await Promise.all(
          removedPaneIds.map(async (paneId) => {
            const sessionId = `${workspaceId}:${paneId}`
            await api.closeManagedSession(sessionId)
            if (
              getPaneCatalogEntryForTemplate(getPaneTemplateId(paneId))
                ?.type === 'terminal'
            ) {
              await api.killTerminalSession(sessionId)
            }
          }),
        )
      }

      try {
        if (!result.layout.rootNodeId || result.layout.nodes.length === 0) {
          const remainingSurfaces = surfaces
            .filter((surface) => surface.id !== surfaceId)
            .map((surface, index) => ({
              ...surface,
              orderIndex: index,
            }))
          const nextSurfaceId =
            remainingSurfaces[
              Math.max(
                0,
                surfaces.findIndex((surface) => surface.id === surfaceId) - 1,
              )
            ]?.id ??
            remainingSurfaces[0]?.id ??
            null

          delete nextLayouts[surfaceId]

          await persistWorkspaceSurfaceStateChange(
            workspaceId,
            remainingSurfaces,
            nextLayouts,
            nextSurfaceId,
            nextSurfaceId
              ? nextLayouts[nextSurfaceId]
                ? (collectWorkspaceLayoutPaneIds(
                    nextLayouts[nextSurfaceId],
                  )[0] ?? null)
                : null
              : null,
            shouldUpdateSelection,
          )
          await closeRemovedSessions(null)
          return
        }

        nextLayouts[surfaceId] = {
          ...result.layout,
          surfaceId,
        }

        await persistWorkspaceSurfaceStateChange(
          workspaceId,
          surfaces.map((surface) =>
            surface.id === surfaceId
              ? { ...surface, rootNodeId: result.layout.rootNodeId }
              : surface,
          ),
          nextLayouts,
          surfaceId,
          result.nextActivePaneId,
          shouldUpdateSelection,
        )
        await closeRemovedSessions(result.layout)
      } catch (error) {
        setShellError(getErrorMessage(error))
      }
    },
    [navigationSnapshot, persistWorkspaceSurfaceStateChange],
  )

  const handleOpenTask = useCallback(
    async (task: SavedTask) => {
      await workspaceMutationQueue.enqueue(task.workspaceId, async () => {
        const snapshot = storageSnapshotRef.current ?? navigationSnapshot
        if (
          !snapshot.workspaces.some(
            (workspace) => workspace.id === task.workspaceId,
          )
        ) {
          throw new Error('The conversation workspace is no longer available.')
        }
        const surfaces = resolveWorkspaceSurfaces(snapshot, task.workspaceId)
        const layouts: Record<string, SurfaceLayoutRecord> = {}
        for (const surface of surfaces) {
          const layout = resolveSurfaceLayout(
            snapshot,
            task.workspaceId,
            surface.id,
          )
          if (!layout) continue
          layouts[surface.id] = layout
          if (collectWorkspaceLayoutPaneIds(layout).includes(task.paneId)) {
            const selection = resolveSelectionForSnapshot(
              snapshot,
              task.workspaceId,
              surface.id,
              task.paneId,
            )
            resolvedNavigationStateRef.current = selection
            setSelection(selection)
            return
          }
        }
        const { surface, layout } = createSinglePaneSurface({
          orderIndex: surfaces.length,
          paneId: task.paneId,
          title: 'Agent',
          workspaceId: task.workspaceId,
        })
        layouts[surface.id] = layout
        await persistWorkspaceSurfaceStateChange(
          task.workspaceId,
          [...surfaces, surface],
          layouts,
          surface.id,
          task.paneId,
        )
      })
    },
    [
      navigationSnapshot,
      persistWorkspaceSurfaceStateChange,
      workspaceMutationQueue,
      resolveSelectionForSnapshot,
      setSelection,
    ],
  )

  const handleCreatePane = useCallback(
    async (templatePaneId: string, requestedWorkspaceId?: string) => {
      const workspaceId =
        requestedWorkspaceId ??
        resolvedNavigationStateRef.current?.activeWorkspaceId ??
        resolvedNavigationState.activeWorkspaceId

      if (!workspaceId) {
        return
      }

      try {
        await workspaceMutationQueue.enqueue(workspaceId, async () => {
          const currentSnapshot =
            storageSnapshotRef.current ?? navigationSnapshot
          const surfaces = resolveWorkspaceSurfaces(
            currentSnapshot,
            workspaceId,
          )
          const paneId = createWorkspacePaneInstanceId(templatePaneId)
          const { layout, surface } = createSinglePaneSurface({
            orderIndex: surfaces.length,
            paneId,
            title:
              resolvePaneMetadata(templatePaneId).label ??
              getPaneCatalogEntryForTemplate(templatePaneId)?.defaultMetadata
                .type ??
              'Pane',
            workspaceId,
          })
          const nextLayouts = surfaces.reduce<
            Record<string, SurfaceLayoutRecord>
          >((acc, existingSurface) => {
            const existingLayout = resolveSurfaceLayout(
              currentSnapshot,
              workspaceId,
              existingSurface.id,
            )

            if (existingLayout) {
              acc[existingSurface.id] = existingLayout
            }

            return acc
          }, {})
          nextLayouts[surface.id] = layout

          await persistWorkspaceSurfaceStateChange(
            workspaceId,
            [...surfaces, surface],
            nextLayouts,
            surface.id,
            layout.nodes[0]?.type === 'pane' ? layout.nodes[0].paneId : null,
          )
        })
        setIsPaneCreationOpen(false)
      } catch (error) {
        setShellError(getErrorMessage(error))
      }
    },
    [
      navigationSnapshot,
      persistWorkspaceSurfaceStateChange,
      resolvedNavigationState.activeWorkspaceId,
      workspaceMutationQueue,
    ],
  )

  const handleCreateChat = useCallback(
    (projectId: string) => {
      const currentSnapshot = storageSnapshotRef.current ?? navigationSnapshot
      const currentSelection =
        resolvedNavigationStateRef.current ?? resolvedNavigationState
      const workspaceId =
        (currentSelection.activeProjectId === projectId
          ? currentSelection.activeWorkspaceId
          : null) ??
        currentSelection.rememberedWorkspaceIdsByProject[projectId] ??
        currentSnapshot.workspaces.find(
          (workspace) => workspace.projectId === projectId,
        )?.id ??
        null

      if (workspaceId) {
        void handleCreatePane('agent', workspaceId)
      }
    },
    [handleCreatePane, navigationSnapshot, resolvedNavigationState],
  )

  const handleSplitPane = useCallback(
    (
      paneId: string,
      splitType: 'split-horizontal' | 'split-vertical',
      targetPaneType?: string,
    ) => {
      const { activeSurfaceId, activeWorkspaceId } = resolvedNavigationState
      if (!activeWorkspaceId || !activeSurfaceId) return
      void workspaceMutationQueue.enqueue(activeWorkspaceId, () =>
        applyWorkspaceLayoutChange(
          activeWorkspaceId,
          activeSurfaceId,
          (layout) =>
            splitWorkspacePane(layout, paneId, splitType, targetPaneType),
        ),
      )
    },
    [
      applyWorkspaceLayoutChange,
      resolvedNavigationState,
      workspaceMutationQueue,
    ],
  )

  const handleCloseSurface = useCallback(
    (surfaceId: string) => {
      const currentSelection = resolvedNavigationStateRef.current
      const workspaceId = currentSelection?.activeWorkspaceId
      if (!workspaceId) return

      void workspaceMutationQueue.enqueue(workspaceId, () =>
        applyWorkspaceLayoutChange(
          workspaceId,
          surfaceId,
          (layout) => ({
            blockedReason: null,
            didChange: true,
            layout: { ...layout, nodes: [], rootNodeId: '' },
            nextActivePaneId: null,
          }),
          currentSelection.activeSurfaceId === surfaceId,
        ),
      )
    },
    [applyWorkspaceLayoutChange, workspaceMutationQueue],
  )

  const handleClosePane = useCallback(
    (paneId: string, shouldCloseViewOnly = false, workspaceId?: string) => {
      const snapshot = storageSnapshotRef.current ?? navigationSnapshot
      const targetWorkspaceId =
        workspaceId ?? resolvedNavigationStateRef.current?.activeWorkspaceId
      const paneLocation = snapshot.workspaces
        .filter((workspace) => workspace.id === targetWorkspaceId)
        .flatMap((workspace) =>
          resolveWorkspaceSurfaces(snapshot, workspace.id).map((surface) => ({
            layout: resolveSurfaceLayout(snapshot, workspace.id, surface.id),
            surfaceId: surface.id,
            workspaceId: workspace.id,
          })),
        )
        .find(({ layout }) =>
          layout?.nodes.some(
            (node) =>
              node.type === 'pane' &&
              (node.paneId === paneId || node.viewIds.includes(paneId)),
          ),
        )

      if (!paneLocation) return

      const currentSelection = resolvedNavigationStateRef.current
      const shouldUpdateSelection = Boolean(
        paneLocation.workspaceId === currentSelection?.activeWorkspaceId &&
          paneLocation.surfaceId === currentSelection?.activeSurfaceId &&
          paneLocation.layout?.nodes.some(
            (node) =>
              node.type === 'pane' &&
              node.paneId === currentSelection?.activePaneId &&
              (node.paneId === paneId || node.viewIds.includes(paneId)),
          ),
      )

      void workspaceMutationQueue.enqueue(paneLocation.workspaceId, () =>
        applyWorkspaceLayoutChange(
          paneLocation.workspaceId,
          paneLocation.surfaceId,
          (layout) => {
            const paneNode = layout.nodes.find(
              (node) =>
                node.type === 'pane' &&
                (node.paneId === paneId || node.viewIds.includes(paneId)),
            )

            if (paneNode?.type !== 'pane') {
              return closeWorkspacePane(layout, paneId)
            }

            if (shouldCloseViewOnly && paneNode.viewIds.length > 1) {
              return removePaneView(
                layout,
                paneNode.paneId,
                paneNode.viewIds.indexOf(paneId),
              )
            }

            return closeWorkspacePane(layout, paneNode.paneId)
          },
          shouldUpdateSelection,
        ),
      )
    },
    [applyWorkspaceLayoutChange, navigationSnapshot, workspaceMutationQueue],
  )

  const handleResizePane = useCallback(
    (paneId: string, delta: number) => {
      const { activeSurfaceId, activeWorkspaceId } = resolvedNavigationState
      if (!activeWorkspaceId || !activeSurfaceId) return
      void workspaceMutationQueue.enqueue(activeWorkspaceId, () =>
        applyWorkspaceLayoutChange(
          activeWorkspaceId,
          activeSurfaceId,
          (layout) => resizeWorkspacePane(layout, paneId, delta),
        ),
      )
    },
    [
      applyWorkspaceLayoutChange,
      resolvedNavigationState,
      workspaceMutationQueue,
    ],
  )

  const handleAddView = useCallback(
    (paneId: string, templateViewId: string) => {
      const { activeSurfaceId, activeWorkspaceId } = resolvedNavigationState
      if (!activeWorkspaceId || !activeSurfaceId) return
      void workspaceMutationQueue.enqueue(activeWorkspaceId, () =>
        applyWorkspaceLayoutChange(
          activeWorkspaceId,
          activeSurfaceId,
          (layout) => addPaneView(layout, paneId, templateViewId),
        ),
      )
    },
    [
      applyWorkspaceLayoutChange,
      resolvedNavigationState,
      workspaceMutationQueue,
    ],
  )

  const handleRemoveView = useCallback(
    (paneId: string, viewIndex: number) => {
      const { activeSurfaceId, activeWorkspaceId } = resolvedNavigationState
      if (!activeWorkspaceId || !activeSurfaceId) return
      void workspaceMutationQueue.enqueue(activeWorkspaceId, () =>
        applyWorkspaceLayoutChange(
          activeWorkspaceId,
          activeSurfaceId,
          (layout) => removePaneView(layout, paneId, viewIndex),
        ),
      )
    },
    [
      applyWorkspaceLayoutChange,
      resolvedNavigationState,
      workspaceMutationQueue,
    ],
  )

  const handleSwitchView = useCallback(
    (paneId: string, viewIndex: number) => {
      const { activeSurfaceId, activeWorkspaceId } = resolvedNavigationState
      if (!activeWorkspaceId || !activeSurfaceId) return
      void workspaceMutationQueue.enqueue(activeWorkspaceId, () =>
        applyWorkspaceLayoutChange(
          activeWorkspaceId,
          activeSurfaceId,
          (layout) => switchPaneView(layout, paneId, viewIndex),
        ),
      )
    },
    [
      applyWorkspaceLayoutChange,
      resolvedNavigationState,
      workspaceMutationQueue,
    ],
  )

  const handleAppShortcut = useCallback(
    (shortcut: {
      projectId?: string
      type:
        | 'command-palette-open'
        | 'pane-create'
        | 'pane-next'
        | 'pane-previous'
        | 'project-jump'
        | 'workspace-next'
        | 'workspace-previous'
        | 'workspace-switcher-toggle'
    }) => {
      if (shortcut.type === 'command-palette-open') {
        setIsOverviewVisible(false)
        setIsWorkspaceSwitcherVisible(false)
        setIsCommandPaletteOpen(true)
        return
      }

      if (shortcut.type === 'workspace-switcher-toggle') {
        setIsCommandPaletteOpen(false)
        setIsOverviewVisible(false)
        setIsWorkspaceSwitcherVisible((prev) => !prev)
        return
      }

      if (shortcut.type === 'pane-create') {
        setIsPaneCreationOpen(true)
        return
      }

      if (shortcut.type === 'pane-previous') {
        handleRelativePaneSelection(-1)
        return
      }

      if (shortcut.type === 'pane-next') {
        handleRelativePaneSelection(1)
        return
      }

      if (shortcut.type === 'workspace-previous') {
        handleRelativeWorkspaceSelection(-1)
        return
      }

      if (shortcut.type === 'workspace-next') {
        handleRelativeWorkspaceSelection(1)
        return
      }

      if (shortcut.type === 'project-jump') {
        if (shortcut.projectId) {
          handleProjectSelection(shortcut.projectId)
        }
      }
    },
    [
      handleRelativePaneSelection,
      handleRelativeWorkspaceSelection,
      handleProjectSelection,
    ],
  )

  const dispatchShortcut = useCallback(
    (shortcut: {
      projectId?: string
      type:
        | 'command-palette-open'
        | 'pane-create'
        | 'pane-next'
        | 'pane-previous'
        | 'project-jump'
        | 'workspace-next'
        | 'workspace-previous'
        | 'workspace-switcher-toggle'
    }) => {
      handleAppShortcut(shortcut)
    },
    [handleAppShortcut],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') {
        setShowProjectHints(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control' || event.key === 'Meta') {
        setShowProjectHints(false)
      }
    }

    const handleWindowBlur = () => {
      setIsCommandPaletteOpen(false)
      setIsWorkspaceSwitcherVisible(false)
      setIsOverviewVisible(false)
      setShowProjectHints(false)
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', handleWindowBlur)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', handleWindowBlur)
    }
  }, [])

  useEffect(() => {
    return window.aide.onAppShortcut((event) => {
      if (isSettingsOpen) return

      if (event.type === 'sidebar-toggle') {
        setIsSidebarOpen((current) => !current)
        return
      }

      if (event.type === 'overview-open') {
        setIsCommandPaletteOpen(false)
        setIsWorkspaceSwitcherVisible(false)
        setIsOverviewVisible(true)
      }

      if (event.type === 'command-palette-open') {
        setIsOverviewVisible(false)
        setIsWorkspaceSwitcherVisible(false)
        setIsCommandPaletteOpen(true)
      }
    })
  }, [isSettingsOpen])

  useEffect(() => {
    const api = getAideApi()

    if (!api) {
      return
    }

    let isHydrating = true
    let bufferedEvents: Array<{
      activities: WorkspaceActivitySnapshot[]
      revision: number
      workspaceId: string
    }> = []
    const applyEvent = (event: {
      activities: WorkspaceActivitySnapshot[]
      revision: number
      workspaceId: string
    }) => {
      if (workspaceActivityRevisionRef.current >= event.revision) return
      workspaceActivityRevisionRef.current = event.revision
      setWorkspaceActivities((current) => {
        if (event.activities.length === 0) {
          if (!(event.workspaceId in current)) {
            return current
          }

          const next = { ...current }
          delete next[event.workspaceId]
          return next
        }

        return {
          ...current,
          [event.workspaceId]: event.activities,
        }
      })
    }
    const unsubscribe = api.onWorkspaceActivity((event) => {
      if (isHydrating) {
        bufferedEvents.push(event)
        return
      }
      applyEvent(event)
    })

    void api
      .getWorkspaceActivitySnapshot()
      .then((snapshot) => {
        if (workspaceActivityRevisionRef.current <= snapshot.revision) {
          workspaceActivityRevisionRef.current = snapshot.revision
          setWorkspaceActivities(snapshot.activitiesByWorkspace)
        }
        isHydrating = false
        for (const event of bufferedEvents.sort(
          (left, right) => left.revision - right.revision,
        )) {
          applyEvent(event)
        }
        bufferedEvents = []
      })
      .catch((error) => {
        isHydrating = false
        setShellError(getErrorMessage(error))
      })

    return unsubscribe
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const normalizedKey = event.key.toLowerCase()
      const normalizedCode = event.code.toLowerCase()
      const isAltChord = event.altKey && !event.metaKey && !event.ctrlKey
      const isCtrlChord = event.ctrlKey && !event.metaKey && !event.altKey
      const isOverviewChord =
        event.key === 'Tab' && (event.ctrlKey || event.metaKey)

      if (event.defaultPrevented) {
        return
      }

      if (isSettingsOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          closeSettings()
        }
        return
      }

      if (event.key === 'Escape') {
        if (isOverviewVisible) {
          event.preventDefault()
          setIsOverviewVisible(false)
          return
        }

        if (isWorkspaceSwitcherVisible) {
          event.preventDefault()
          setIsWorkspaceSwitcherVisible(false)
          return
        }
      }

      if (
        shouldIgnoreGlobalNavigation(event.target) &&
        !isAltChord &&
        !isCtrlChord &&
        !isOverviewChord
      ) {
        return
      }

      if (isOverviewChord) {
        event.preventDefault()
        setIsCommandPaletteOpen(false)
        setIsWorkspaceSwitcherVisible(false)
        setIsOverviewVisible(true)
        return
      }

      if (isCtrlChord && normalizedKey === 'b') {
        event.preventDefault()
        if (!event.repeat) setIsSidebarOpen((current) => !current)
        return
      }

      if (isCtrlChord && normalizedKey === 'k') {
        event.preventDefault()
        setIsOverviewVisible(false)
        setIsWorkspaceSwitcherVisible(false)
        setIsCommandPaletteOpen(true)
        return
      }

      if (isAltChord && normalizedKey === ' ') {
        event.preventDefault()
        setIsCommandPaletteOpen(false)
        setIsOverviewVisible(false)
        setIsWorkspaceSwitcherVisible((prev) => !prev)
        return
      }

      const shortcutProject =
        (event.ctrlKey || event.metaKey) &&
        !(
          event.target instanceof Element &&
          event.target.closest('[data-model-selector-menu]')
        )
          ? resolveProjectShortcutTarget(navigationSnapshot.projects, event.key)
          : null

      if (shortcutProject) {
        event.preventDefault()
        dispatchShortcut({
          projectId: shortcutProject.id,
          type: 'project-jump',
        })
        return
      }

      if (isAltChord && normalizedKey === 'n') {
        event.preventDefault()
        dispatchShortcut({ type: 'pane-create' })
        return
      }

      if (isAltChord && event.key === 'ArrowUp') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-previous' })
      }

      if (isAltChord && event.key === 'ArrowDown') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-next' })
      }

      if (isAltChord && isWorkspaceSwitcherVisible && normalizedKey === 'k') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-previous' })
      }

      if (isAltChord && isWorkspaceSwitcherVisible && normalizedKey === 'j') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-next' })
      }

      if (
        (isAltChord && event.key === 'ArrowLeft') ||
        (normalizedKey === 'h' && isAltChord) ||
        (normalizedCode === 'keyh' && isAltChord)
      ) {
        event.preventDefault()
        dispatchShortcut({ type: 'pane-previous' })
      }

      if (
        (isAltChord && event.key === 'ArrowRight') ||
        (normalizedKey === 'l' && isAltChord) ||
        (normalizedCode === 'keyl' && isAltChord)
      ) {
        event.preventDefault()
        dispatchShortcut({ type: 'pane-next' })
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [
    dispatchShortcut,
    closeSettings,
    isOverviewVisible,
    isSettingsOpen,
    isWorkspaceSwitcherVisible,
    navigationSnapshot.projects,
  ])

  useEffect(() => {
    if (isSettingsOpen) return
    let openedByHold = false

    const handleAltDown = (event: KeyboardEvent) => {
      if (
        event.key !== 'Alt' ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return
      }

      if (event.repeat || openedByHold) {
        return
      }

      openedByHold = true
      setIsCommandPaletteOpen(false)
      setIsOverviewVisible(false)
      setIsWorkspaceSwitcherVisible(true)
    }

    const handleAltUp = (event: KeyboardEvent) => {
      if (event.key !== 'Alt') {
        return
      }

      if (openedByHold) {
        openedByHold = false
        setIsWorkspaceSwitcherVisible(false)
      }
    }

    const handleBlur = () => {
      if (openedByHold) {
        openedByHold = false
        setIsWorkspaceSwitcherVisible(false)
      }
    }

    window.addEventListener('keydown', handleAltDown, true)
    window.addEventListener('keyup', handleAltUp, true)
    window.addEventListener('blur', handleBlur)

    return () => {
      window.removeEventListener('keydown', handleAltDown, true)
      window.removeEventListener('keyup', handleAltUp, true)
      window.removeEventListener('blur', handleBlur)
    }
  }, [isSettingsOpen])

  useEffect(() => {
    if (
      isCommandPaletteOpen ||
      isOverviewVisible ||
      isSettingsOpen ||
      isWorkspaceSwitcherVisible ||
      !resolvedNavigationState.activePaneId ||
      resolvePaneType(
        resolvePaneMetadata(resolvedNavigationState.activePaneId).type,
      ) !== 'terminal'
    ) {
      return
    }

    const timeoutIds: number[] = []

    const cancelFocusAttempts = () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId)
      }
    }

    const focusTerminal = () => {
      const activePaneElement = document.querySelector<HTMLElement>(
        '[data-active-pane="true"]',
      )
      const textarea =
        activePaneElement?.querySelector<HTMLTextAreaElement>(
          '.terminal-pane .xterm-helper-textarea',
        ) ?? null

      if (!textarea) {
        return
      }

      const activeElement = document.activeElement
      const isEditingOutsideTerminal =
        activeElement instanceof HTMLElement &&
        activeElement !== document.body &&
        !activePaneElement?.contains(activeElement) &&
        (activeElement.matches('input, textarea, select') ||
          activeElement.isContentEditable)

      if (isEditingOutsideTerminal) {
        cancelFocusAttempts()
        return
      }

      textarea.focus()
      if (document.activeElement === textarea) {
        cancelFocusAttempts()
      }
    }

    for (const delay of [0, 50, 150, 300, 600]) {
      timeoutIds.push(window.setTimeout(focusTerminal, delay))
    }

    return cancelFocusAttempts
  }, [
    isCommandPaletteOpen,
    isOverviewVisible,
    isSettingsOpen,
    isWorkspaceSwitcherVisible,
    resolvedNavigationState.activePaneId,
  ])

  const projects = navigationSnapshot.projects
  const allWorkspaces = navigationSnapshot.workspaces
  const activeProject =
    projects.find((p) => p.id === resolvedNavigationState.activeProjectId) ??
    null
  const activeWorkspace =
    allWorkspaces.find(
      (ws) => ws.id === resolvedNavigationState.activeWorkspaceId,
    ) ?? null
  const activePreviewSnapshot = activeWorkspace
    ? (previewSnapshots[activeWorkspace.id] ?? null)
    : null
  const projectWorkspaces = useMemo(
    () =>
      activeProject
        ? allWorkspaces.filter(
            (workspace) => workspace.projectId === activeProject.id,
          )
        : [],
    [activeProject, allWorkspaces],
  )
  const activeWorkspaceSurfaces = useMemo(
    () =>
      activeWorkspace
        ? resolveWorkspaceSurfaces(navigationSnapshot, activeWorkspace.id)
        : [],
    [activeWorkspace, navigationSnapshot],
  )
  const surfaceManagedSessionIds = useMemo(() => {
    if (!activeWorkspace) return {}
    const map: Record<string, string | null> = {}
    for (const surface of activeWorkspaceSurfaces) {
      const layout = resolveSurfaceLayout(
        navigationSnapshot,
        activeWorkspace.id,
        surface.id,
      )
      if (!layout) {
        map[surface.id] = null
        continue
      }
      const managedViewId = layout.nodes
        .flatMap((n) => (n.type === 'pane' ? n.viewIds : []))
        .find((viewId) => {
          const entry = getPaneCatalogEntryForTemplate(
            getPaneTemplateId(viewId),
          )
          return (
            entry?.terminalMode === 'agent' ||
            entry?.terminalMode === 'claude' ||
            entry?.terminalMode === 'codex'
          )
        })
      map[surface.id] = managedViewId
        ? `${activeWorkspace.id}:${managedViewId}`
        : null
    }
    return map
  }, [activeWorkspace, activeWorkspaceSurfaces, navigationSnapshot])
  const workspaceSummaries = useMemo(
    () =>
      buildWorkspaceSummaryMap(projects, allWorkspaces, workspaceActivities),
    [allWorkspaces, projects, workspaceActivities],
  )
  const orderedWorkspaces = useMemo(
    () =>
      getOrderedWorkspaces(
        navigationSnapshot.projects,
        navigationSnapshot.workspaces,
      ),
    [navigationSnapshot.projects, navigationSnapshot.workspaces],
  )
  const updatePresentation = useMemo(
    () =>
      resolveUpdatePresentation(
        updateSnapshot,
        updatePreferences,
        updatePresentationNow,
      ),
    [updatePreferences, updatePresentationNow, updateSnapshot],
  )
  useEffect(() => {
    const refreshDelay = getUpdatePresentationRefreshDelay(
      updateSnapshot,
      updatePreferences,
      updatePresentationNow,
    )
    if (refreshDelay === null) return

    const timer = window.setTimeout(
      () => setUpdatePresentationNow(new Date()),
      refreshDelay,
    )
    return () => window.clearTimeout(timer)
  }, [updatePreferences, updatePresentationNow, updateSnapshot])
  const openUpdateModal = useCallback(() => {
    if (
      typeof document !== 'undefined' &&
      document.activeElement instanceof HTMLElement
    ) {
      updateReturnFocusRef.current = document.activeElement
    }
    setIsUpdateOpen(true)
  }, [])
  const handleUpdateOpenChange = useCallback((isOpen: boolean) => {
    setIsUpdateOpen(isOpen)
    if (isOpen) return

    setUpdateRestartStatus(null)
    setUpdateActionError(null)
    const returnFocus = updateReturnFocusRef.current
    updateReturnFocusRef.current = null
    requestAnimationFrame(() => {
      if (returnFocus?.isConnected) {
        returnFocus.focus()
        return
      }

      const fallback = document.querySelector<HTMLElement>(
        '[data-testid="update-indicator"], [aria-label="Open diagnostics"]',
      )
      fallback?.focus()
    })
  }, [])
  const acceptUpdateSnapshot = useCallback((snapshot: UpdateSnapshot) => {
    setUpdatePresentationNow(new Date())
    setUpdateSnapshot((current) =>
      !current || snapshot.revision >= current.revision ? snapshot : current,
    )
  }, [])
  const acceptUpdatePreferences = useCallback(
    (snapshot: UpdatePreferencesSnapshot) => {
      setUpdatePresentationNow(new Date())
      setUpdatePreferences((current) =>
        !current || snapshot.revision >= current.revision ? snapshot : current,
      )
    },
    [],
  )
  const performUpdateAction = useCallback(
    async (operation: () => Promise<void>) => {
      setUpdateActionError(null)
      try {
        await operation()
      } catch (error) {
        setUpdateActionError(getErrorMessage(error))
        throw error
      }
    },
    [],
  )
  const checkForSoftwareUpdate = useCallback(async () => {
    await performUpdateAction(async () => {
      const api = getAideApi()
      if (!api) throw new Error('Desktop bridge did not load.')
      acceptUpdateSnapshot(await api.checkForUpdates())
    })
  }, [acceptUpdateSnapshot, performUpdateAction])
  const downloadSoftwareUpdate = useCallback(async () => {
    await performUpdateAction(async () => {
      const api = getAideApi()
      if (!api) throw new Error('Desktop bridge did not load.')
      acceptUpdateSnapshot(await api.downloadUpdate())
    })
  }, [acceptUpdateSnapshot, performUpdateAction])
  const retrySoftwareUpdate = useCallback(async () => {
    await performUpdateAction(async () => {
      const api = getAideApi()
      if (!api) throw new Error('Desktop bridge did not load.')
      acceptUpdateSnapshot(await api.retryUpdate())
    })
  }, [acceptUpdateSnapshot, performUpdateAction])
  const updateSoftwarePreferences = useCallback(
    async (input: UpdatePreferencesInput) => {
      await performUpdateAction(async () => {
        const api = getAideApi()
        if (!api) throw new Error('Desktop bridge did not load.')
        acceptUpdatePreferences(await api.updatePreferences(input))
      })
    },
    [acceptUpdatePreferences, performUpdateAction],
  )
  const snoozeSoftwareUpdate = useCallback(
    () =>
      updateSoftwarePreferences({
        snoozedUntil: createUpdateSnoozeUntil(),
      }),
    [updateSoftwarePreferences],
  )
  const requestSoftwareUpdateRestart = useCallback(async () => {
    await performUpdateAction(async () => {
      const api = getAideApi()
      if (!api) throw new Error('Desktop bridge did not load.')
      setUpdateRestartStatus(await api.restartUpdate(false))
    })
  }, [performUpdateAction])
  const confirmSoftwareUpdateRestart = useCallback(async () => {
    await performUpdateAction(async () => {
      const api = getAideApi()
      if (!api) throw new Error('Desktop bridge did not load.')
      setUpdateRestartStatus(await api.restartUpdate(true))
    })
  }, [performUpdateAction])
  const runUpdatePaletteAction = useCallback(
    (operation?: () => Promise<void>) => {
      openUpdateModal()
      if (!operation) return
      void operation().catch(() => {})
    },
    [openUpdateModal],
  )
  const paletteUpdateAction = useMemo(() => {
    if (updatePresentation.canCheck) {
      return {
        id: 'check-for-updates' as const,
        label: 'Check for updates',
        onSelect: () => runUpdatePaletteAction(checkForSoftwareUpdate),
      }
    }
    if (updatePresentation.canDownload) {
      return {
        id: 'download-update' as const,
        label: updatePresentation.isCritical
          ? 'Download critical update'
          : 'Download update',
        onSelect: () => runUpdatePaletteAction(downloadSoftwareUpdate),
      }
    }
    if (updatePresentation.canRetry) {
      return {
        id: 'retry-update' as const,
        label: 'Retry update',
        onSelect: () => runUpdatePaletteAction(retrySoftwareUpdate),
      }
    }
    if (updatePresentation.canRestart) {
      return {
        id: 'restart-to-update' as const,
        label: 'Restart to update…',
        onSelect: () => runUpdatePaletteAction(),
      }
    }
    return undefined
  }, [
    checkForSoftwareUpdate,
    downloadSoftwareUpdate,
    retrySoftwareUpdate,
    runUpdatePaletteAction,
    updatePresentation.canCheck,
    updatePresentation.canDownload,
    updatePresentation.canRestart,
    updatePresentation.canRetry,
    updatePresentation.isCritical,
  ])
  const paletteCommands = useMemo(
    () =>
      buildCommandList({
        activePaneId: resolvedNavigationState.activePaneId,
        canCreateWorkspace: activeProject?.kind === 'git',
        onClosePane: handleClosePane,
        onCreatePane: createPane,
        onCreateWorkspace: createWorkspace,
        onOpenOverview: () => setIsOverviewVisible(true),
        onOpenProject: openProject,
        onOpenSoftwareUpdate: openUpdateModal,
        onResizePane: handleResizePane,
        onSelectProject: handleProjectSelection,
        onSelectWorkspace: handleWorkspaceSelection,
        onToggleFleet: () => setIsFleetOpen((current) => !current),
        onToggleSidebar: () => setIsSidebarOpen((current) => !current),
        projects,
        updateAction: paletteUpdateAction,
        workspaces: projectWorkspaces,
      }),
    [
      activeProject?.kind,
      createPane,
      createWorkspace,
      handleClosePane,
      handleResizePane,
      handleProjectSelection,
      handleWorkspaceSelection,
      openProject,
      openUpdateModal,
      paletteUpdateAction,
      projects,
      projectWorkspaces,
      resolvedNavigationState.activePaneId,
    ],
  )

  const activePaneIsPreview =
    activePaneId !== null &&
    getPaneCatalogEntryForTemplate(getPaneTemplateId(activePaneId))?.type ===
      'preview'

  useEffect(() => {
    const aide = getAideApi()
    if (!aide || !activeWorkspace || !activePaneIsPreview) return

    void aide
      .getWorkspacePreviewSnapshot(activeWorkspace.id)
      .then(updatePreviewSnapshot)
      .catch((error: unknown) => setActionError(getErrorMessage(error)))
  }, [activePaneIsPreview, activeWorkspace, updatePreviewSnapshot])

  const withPreviewSnapshot = useCallback(
    (operation: () => Promise<WorkspacePreviewSnapshot>) => {
      void operation()
        .then(updatePreviewSnapshot)
        .catch((error: unknown) => setActionError(getErrorMessage(error)))
    },
    [updatePreviewSnapshot],
  )
  const handlePreviewBrowserControl = useCallback(
    (type: PreviewBrowserControl) =>
      setPreviewBrowserAction((current) => ({
        id: (current?.id ?? 0) + 1,
        type,
      })),
    [],
  )
  const activeWorkspaceSetup = activeWorkspace
    ? (workspaceSetups[activeWorkspace.id] ?? null)
    : null
  const runActiveWorkspaceSetup = useCallback(() => {
    if (!activeWorkspace) return
    const api = getAideApi()
    if (!api) {
      setActionError('Desktop bridge did not load. Reload the app window.')
      return
    }
    void api
      .runWorkspaceSetup(activeWorkspace.id)
      .then(() => api.getWorkspaceSetupSnapshot())
      .then(applyWorkspaceSetupCollection)
      .catch((error) => setActionError(getErrorMessage(error)))
  }, [activeWorkspace, applyWorkspaceSetupCollection])
  const cancelActiveWorkspaceSetup = useCallback(() => {
    if (!activeWorkspace) return
    const api = getAideApi()
    if (!api) return
    void api
      .cancelWorkspaceSetup(activeWorkspace.id)
      .then(() => api.getWorkspaceSetupSnapshot())
      .then(applyWorkspaceSetupCollection)
      .catch((error) => setActionError(getErrorMessage(error)))
  }, [activeWorkspace, applyWorkspaceSetupCollection])
  const setupProject = projectSetupProjectId
    ? (navigationSnapshot.projects.find(
        (project) => project.id === projectSetupProjectId,
      ) ?? null)
    : null

  return (
    <AppShell
      activePaneId={resolvedNavigationState.activePaneId}
      activeSurfaceId={resolvedNavigationState.activeSurfaceId}
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      isSidebarOpen={isSidebarOpen}
      onToggleSidebar={() => setIsSidebarOpen((current) => !current)}
      isFleetOpen={isFleetOpen}
      onFleetOpenChange={setIsFleetOpen}
      onClosePane={handleClosePane}
      onCloseSurface={handleCloseSurface}
      onResizePane={handleResizePane}
      onSplitPane={handleSplitPane}
      surfaces={activeWorkspaceSurfaces}
      surfaceManagedSessionIds={surfaceManagedSessionIds}
      showProjectHints={showProjectHints}
      onSelectPane={(paneId: string) => {
        const selection = applySurfaceSelection(
          navigationSnapshot,
          resolvedNavigationStateRef.current ?? resolvedNavigationState,
          paneId,
          getSurfaceIdsForWorkspace,
          getPaneIdsForWorkspace,
        )
        resolvedNavigationStateRef.current = selection
        setSelection(selection)
      }}
      onCreateProject={openProject}
      onCreatePane={createPane}
      onCreateChat={handleCreateChat}
      onCreateWorkspace={createWorkspace}
      onRenameWorkspace={renameWorkspace}
      onConfigureProjectSetup={setProjectSetupProjectId}
      onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
      onOpenSettings={openSettings}
      onOpenTask={handleOpenTask}
      onOpenUpdate={openUpdateModal}
      onSelectProject={handleProjectSelection}
      onSelectWorkspace={handleWorkspaceSelection}
      projects={projects}
      workspaces={orderedWorkspaces}
      workspaceSummaries={workspaceSummaries}
      updatePresentation={updatePresentation}
    >
      <>
        {isSettingsOpen ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazySettingsPage
              onClose={closeSettings}
              onOpenUpdate={() => {
                updateReturnFocusRef.current = settingsReturnFocusRef.current
                settingsReturnFocusRef.current = null
                setIsSettingsOpen(false)
                setIsUpdateOpen(true)
              }}
              onUpdatePreferences={updateSoftwarePreferences}
              updatePreferences={updatePreferences}
              updatePreferencesError={updatePreferencesHydrationError}
            />
          </Suspense>
        ) : null}
        {isDiagnosticsOpen ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyDiagnosticsModal isOpen onOpenChange={setIsDiagnosticsOpen} />
          </Suspense>
        ) : null}
        {isUpdateOpen ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyUpdateModal
              actionError={
                updateActionError ??
                updateSnapshotHydrationError ??
                updatePreferencesHydrationError
              }
              isOpen
              onCheck={checkForSoftwareUpdate}
              onConfirmRestart={confirmSoftwareUpdateRestart}
              onDownload={downloadSoftwareUpdate}
              onOpenChange={handleUpdateOpenChange}
              onClearActionError={() => setUpdateActionError(null)}
              onRequestRestart={requestSoftwareUpdateRestart}
              onRetry={retrySoftwareUpdate}
              onSnooze={snoozeSoftwareUpdate}
              onUpdatePreferences={updateSoftwarePreferences}
              preferences={updatePreferences}
              presentationNow={updatePresentationNow}
              restartStatus={updateRestartStatus}
              snapshot={updateSnapshot}
            />
          </Suspense>
        ) : null}
        {isCommandPaletteOpen ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyCommandPalette
              commands={paletteCommands}
              isOpen
              onClose={() => setIsCommandPaletteOpen(false)}
            />
          </Suspense>
        ) : null}
        {isPaneCreationOpen ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyPaneCreationModal
              isOpen
              onCreatePane={(paneId) => void handleCreatePane(paneId)}
              onOpenChange={setIsPaneCreationOpen}
              projectKind={activeProject?.kind ?? 'git'}
            />
          </Suspense>
        ) : null}
        {isWorkspaceCreationOpen && activeProject?.kind === 'git' ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyWorkspaceCreationModal
              existingRootWorkspaceName={
                activeProject
                  ? (projectWorkspaces.find(
                      (workspace) =>
                        workspace.worktreePath === activeProject.repoRoot,
                    )?.name ?? null)
                  : null
              }
              isOpen
              loadProjectRefs={listProjectRefs}
              onAttach={submitWorkspaceAttachment}
              onOpenChange={setIsWorkspaceCreationOpen}
              onSubmit={submitWorkspaceCreation}
              project={activeProject}
              workspaceCount={projectWorkspaces.length}
            />
          </Suspense>
        ) : null}
        {setupProject ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyProjectSetupModal
              isOpen
              onOpenChange={(isOpen) => {
                if (!isOpen) setProjectSetupProjectId(null)
              }}
              onSave={(command) =>
                saveProjectSetupCommand(setupProject.id, command)
              }
              project={setupProject}
            />
          </Suspense>
        ) : null}
        {isWorkspaceSwitcherVisible ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyWorkspaceSwitcherOverlay
              activeWorkspaceId={activeWorkspace?.id ?? null}
              mode="workspace-switcher"
              onRequestClose={() => setIsWorkspaceSwitcherVisible(false)}
              onSelectWorkspace={handleWorkspaceSelection}
              projectName={activeProject?.name ?? null}
              summaries={workspaceSummaries}
              visible
              workspaces={projectWorkspaces}
            />
          </Suspense>
        ) : null}
        {isOverviewVisible ? (
          <Suspense fallback={<OverlayLoadFallback />}>
            <LazyWorkspaceSwitcherOverlay
              activeWorkspaceId={activeWorkspace?.id ?? null}
              mode="overview"
              onRequestClose={() => setIsOverviewVisible(false)}
              onSelectWorkspace={handleWorkspaceSelection}
              projectName={activeProject?.name ?? null}
              summaries={workspaceSummaries}
              visible
              workspaces={orderedWorkspaces}
            />
          </Suspense>
        ) : null}
        <WorkspaceSetupStatus
          onCancel={cancelActiveWorkspaceSetup}
          onRun={runActiveWorkspaceSetup}
          setup={activeWorkspaceSetup}
        />
        <WorkspaceCanvas
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          actionError={actionError}
          onAddView={handleAddView}
          onCreateProject={openProject}
          onCreateWorkspace={createWorkspace}
          onClosePane={handleClosePane}
          onRemoveView={handleRemoveView}
          onPreviewBrowserControl={handlePreviewBrowserControl}
          onPreviewCloseTab={(workspace, tabId) => {
            const aide = getAideApi()
            if (aide)
              withPreviewSnapshot(() =>
                aide.closePreviewTab(workspace.id, tabId),
              )
          }}
          onPreviewNavigate={(workspace, tabId, url) => {
            const aide = getAideApi()
            if (aide)
              withPreviewSnapshot(() =>
                aide.navigatePreviewTab(workspace.id, tabId, url),
              )
          }}
          onPreviewOpenTab={(workspace, url) => {
            const aide = getAideApi()
            if (aide)
              withPreviewSnapshot(() => aide.openPreviewTab(workspace.id, url))
          }}
          onPreviewPresentationChange={setPreviewPresentation}
          onPreviewSelectTab={(workspace, tabId) => {
            const aide = getAideApi()
            if (aide)
              withPreviewSnapshot(() =>
                aide.selectPreviewTab(workspace.id, tabId),
              )
          }}
          onSelectPane={(paneId: string) =>
            setSelection(
              applyPaneSelection(
                navigationSnapshot,
                resolvedNavigationState,
                paneId,
                getSurfaceIdsForWorkspace,
                getPaneIdsForWorkspace,
              ),
            )
          }
          onSwitchView={handleSwitchView}
          previewSnapshot={activePreviewSnapshot}
          allWorkspaces={projectWorkspaces}
          projects={projects}
          shellError={shellError}
          activePaneId={resolvedNavigationState.activePaneId}
          activeSurfaceId={resolvedNavigationState.activeSurfaceId}
          surfaceLayouts={navigationSnapshot.surfaceLayouts ?? {}}
          workspaceSurfaces={navigationSnapshot.workspaceSurfaces ?? {}}
          workspaceLayouts={navigationSnapshot.workspaceLayouts}
        />
        <PreviewBrowserHost
          action={previewBrowserAction}
          presentation={previewPresentation}
          snapshots={previewSnapshots}
        />
      </>
    </AppShell>
  )
}
