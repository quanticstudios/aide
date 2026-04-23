import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { CreateWorkspaceRequest, ProjectRefRecord } from '../../shared/git'
import type { AideApi } from '../../shared/ipc'
import {
  type PersistenceSnapshot,
  type SaveWorkspaceSurfaceStateInput,
  type SurfaceLayoutRecord,
  type WorkspaceLayoutRecord,
  type WorkspaceRecord,
  createEmptyPersistenceSnapshot,
} from '../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../shared/workspace-activity'
import AppShell from './components/AppShell'
import CommandPalette from './components/CommandPalette'
import PaneCreationModal from './components/PaneCreationModal'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import WorkspaceCreationModal from './components/WorkspaceCreationModal'
import WorkspaceSwitcherOverlay from './components/WorkspaceSwitcherOverlay'
import { buildCommandList } from './lib/command-registry'
import {
  getPaneCatalogEntryForTemplate,
  resolvePaneMetadata,
  resolvePaneType,
} from './lib/pane-catalog'
import { resolveProjectShortcutTarget } from './lib/project-shortcuts'
import {
  applyPaneSelection,
  applyProjectSelection,
  applySurfaceSelection,
  applyWorkspaceSelection,
  moveRelativePane,
  moveRelativeWorkspace,
  resolveSpatialNavigationState,
} from './lib/spatial-navigation-state'
import { collectWorkspaceLayoutPaneIds } from './lib/workspace-layout'
import {
  addPaneView,
  closeWorkspacePane,
  removePaneView,
  resizeWorkspacePane,
  splitWorkspacePane,
  switchPaneView,
} from './lib/workspace-layout-mutations'
import {
  type WorkspaceRuntimeState,
  getWorkspacePreviewState,
  selectWorkspacePreviewTarget,
  upsertWorkspacePreviewTarget,
} from './lib/workspace-runtime'
import { useWorkspaceSelectionStore } from './lib/workspace-selection-store'
import { buildWorkspaceSummaryMap } from './lib/workspace-summary'
import {
  createSinglePaneSurface,
  findWorkspaceIdForSurface,
  resolveSurfaceLayout,
  resolveWorkspaceSurfaces,
} from './lib/workspace-surfaces'

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
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isPaneCreationOpen, setIsPaneCreationOpen] = useState(false)
  const [isWorkspaceSwitcherVisible, setIsWorkspaceSwitcherVisible] =
    useState(false)
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false)
  const [isOverviewVisible, setIsOverviewVisible] = useState(false)
  const [isWorkspaceCreationOpen, setIsWorkspaceCreationOpen] = useState(false)
  const [showProjectHints, setShowProjectHints] = useState(false)
  const [workspaceActivities, setWorkspaceActivities] = useState<
    Record<string, WorkspaceActivitySnapshot[]>
  >({})
  const [workspaceRuntimeState, setWorkspaceRuntimeState] =
    useState<WorkspaceRuntimeState>({})
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
  const activePaneIdsBySurface = useWorkspaceSelectionStore(
    (state) => state.activePaneIdsBySurface,
  )
  const activeSurfaceIdsByWorkspace = useWorkspaceSelectionStore(
    (state) => state.activeSurfaceIdsByWorkspace,
  )
  const rememberedWorkspaceIdsByProject = useWorkspaceSelectionStore(
    (state) => state.rememberedWorkspaceIdsByProject,
  )
  const setSelection = useWorkspaceSelectionStore((state) => state.setSelection)
  const navigationSnapshot = storageSnapshot ?? createEmptyPersistenceSnapshot()
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
      rememberedPaneIdsBySurface: activePaneIdsBySurface,
      rememberedSurfaceIdsByWorkspace: activeSurfaceIdsByWorkspace,
      rememberedWorkspaceIdsByProject,
    }),
    [
      activePaneId,
      activePaneIdsBySurface,
      activeProjectId,
      activeSurfaceId,
      activeSurfaceIdsByWorkspace,
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
      const [snapshot, activitySnapshot] = await Promise.all([
        api.getStorageSnapshot(),
        api.getWorkspaceActivitySnapshot(),
      ])
      setStorageSnapshot(snapshot)
      setWorkspaceActivities(activitySnapshot)
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

  const createWorkspace = useCallback(() => {
    if (!activeProjectId) {
      return
    }

    setIsWorkspaceCreationOpen(true)
  }, [activeProjectId])

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
          resolvedNavigationState,
          latestWorkspaceId,
          getSurfaceIdsForWorkspace,
          getPaneIdsForWorkspace,
        )

        setStorageSnapshot(snapshot)
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
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      resolvedNavigationState,
      setSelection,
    ],
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
    void refreshStorage()
  }, [refreshStorage])

  useEffect(() => {
    const resolvedSignature = JSON.stringify(resolvedNavigationState)

    if (
      activePaneId === resolvedNavigationState.activePaneId &&
      activeSurfaceId === resolvedNavigationState.activeSurfaceId &&
      activeProjectId === resolvedNavigationState.activeProjectId &&
      activeWorkspaceId === resolvedNavigationState.activeWorkspaceId &&
      recordsEqual(
        activePaneIdsBySurface,
        resolvedNavigationState.rememberedPaneIdsBySurface,
      ) &&
      recordsEqual(
        activeSurfaceIdsByWorkspace,
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
    activePaneIdsBySurface,
    activeProjectId,
    activeSurfaceIdsByWorkspace,
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
      setSelection(
        applyWorkspaceSelection(
          navigationSnapshot,
          resolvedNavigationState,
          workspaceId,
          getSurfaceIdsForWorkspace,
          getPaneIdsForWorkspace,
        ),
      )
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
      if (
        isWorkspaceSwitcherVisible &&
        navigationSnapshot.workspaces.length > 0
      ) {
        const workspaces = navigationSnapshot.workspaces
        const currentIndex = Math.max(
          workspaces.findIndex(
            (workspace) =>
              workspace.id === resolvedNavigationState.activeWorkspaceId,
          ),
          0,
        )
        const nextIndex =
          (currentIndex + direction + workspaces.length) % workspaces.length
        const nextWorkspace = workspaces[nextIndex]

        if (nextWorkspace) {
          handleWorkspaceSelection(nextWorkspace.id)
        }
        return
      }

      setSelection(
        moveRelativeWorkspace(
          navigationSnapshot,
          resolvedNavigationState,
          direction,
          getSurfaceIdsForWorkspace,
          getPaneIdsForWorkspace,
        ),
      )
    },
    [
      getPaneIdsForWorkspace,
      getSurfaceIdsForWorkspace,
      handleWorkspaceSelection,
      isWorkspaceSwitcherVisible,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const handleRelativePaneSelection = useCallback(
    (direction: -1 | 1) => {
      setSelection(
        moveRelativePane(
          navigationSnapshot,
          resolvedNavigationState,
          direction,
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
          ...resolvedNavigationState,
          activePaneId: nextActivePaneId,
          activeSurfaceId: nextActiveSurfaceId,
          rememberedPaneIdsBySurface: nextActiveSurfaceId
            ? {
                ...resolvedNavigationState.rememberedPaneIdsBySurface,
                [nextActiveSurfaceId]: nextActivePaneId,
              }
            : resolvedNavigationState.rememberedPaneIdsBySurface,
          rememberedSurfaceIdsByWorkspace: {
            ...resolvedNavigationState.rememberedSurfaceIdsByWorkspace,
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
    ) => {
      const currentSurfaceIds = resolveWorkspaceSurfaces(
        navigationSnapshot,
        workspaceId,
      ).map((surface) => surface.id)
      const nextSurfaceLayouts = { ...navigationSnapshot.surfaceLayouts }

      for (const surfaceId of currentSurfaceIds) {
        delete nextSurfaceLayouts[surfaceId]
      }

      Object.assign(nextSurfaceLayouts, layouts)

      const api = getAideApi()

      if (!api) {
        setShellError('Desktop bridge did not load. Reload the app window.')
        return
      }

      const snapshot = await api.saveWorkspaceSurfaceState(workspaceId, {
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

      setStorageSnapshot(snapshot)
      setSelection(
        resolveSelectionForSnapshot(
          snapshot,
          workspaceId,
          nextActiveSurfaceId,
          nextActivePaneId,
        ),
      )
      setShellError(null)
    },
    [navigationSnapshot, resolveSelectionForSnapshot, setSelection],
  )

  const applyWorkspaceLayoutChange = useCallback(
    async (
      mutateLayout: (
        layout: WorkspaceLayoutRecord,
      ) => ReturnType<typeof splitWorkspacePane>,
    ) => {
      const workspaceId = resolvedNavigationState.activeWorkspaceId
      const surfaceId = resolvedNavigationState.activeSurfaceId

      if (!workspaceId || !surfaceId) {
        return
      }

      const currentLayout = resolveSurfaceLayout(
        navigationSnapshot,
        workspaceId,
        surfaceId,
      )

      if (!currentLayout) {
        return
      }

      const surfaces = resolveWorkspaceSurfaces(navigationSnapshot, workspaceId)
      const nextLayouts = surfaces.reduce<Record<string, SurfaceLayoutRecord>>(
        (acc, surface) => {
          const layout = resolveSurfaceLayout(
            navigationSnapshot,
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
          )
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
        )
      } catch (error) {
        setShellError(getErrorMessage(error))
      }
    },
    [
      navigationSnapshot,
      persistWorkspaceSurfaceStateChange,
      resolvedNavigationState.activeSurfaceId,
      resolvedNavigationState.activeWorkspaceId,
    ],
  )

  const handleCreatePane = useCallback(
    async (templatePaneId: string) => {
      const workspaceId = resolvedNavigationState.activeWorkspaceId

      if (!workspaceId) {
        return
      }

      try {
        const surfaces = resolveWorkspaceSurfaces(
          navigationSnapshot,
          workspaceId,
        )
        const { layout, surface } = createSinglePaneSurface({
          orderIndex: surfaces.length,
          paneId: templatePaneId,
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
            navigationSnapshot,
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
        setIsPaneCreationOpen(false)
      } catch (error) {
        setShellError(getErrorMessage(error))
      }
    },
    [
      navigationSnapshot,
      persistWorkspaceSurfaceStateChange,
      resolvedNavigationState.activeWorkspaceId,
    ],
  )

  const handleSplitPane = useCallback(
    (
      paneId: string,
      splitType: 'split-horizontal' | 'split-vertical',
      targetPaneType?: string,
    ) => {
      void applyWorkspaceLayoutChange((layout) =>
        splitWorkspacePane(layout, paneId, splitType, targetPaneType),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleClosePane = useCallback(
    (paneId: string) => {
      void applyWorkspaceLayoutChange((layout) =>
        closeWorkspacePane(layout, paneId),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleResizePane = useCallback(
    (paneId: string, delta: number) => {
      void applyWorkspaceLayoutChange((layout) =>
        resizeWorkspacePane(layout, paneId, delta),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleAddView = useCallback(
    (paneId: string, templateViewId: string) => {
      void applyWorkspaceLayoutChange((layout) =>
        addPaneView(layout, paneId, templateViewId),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleRemoveView = useCallback(
    (paneId: string, viewIndex: number) => {
      void applyWorkspaceLayoutChange((layout) =>
        removePaneView(layout, paneId, viewIndex),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleSwitchView = useCallback(
    (paneId: string, viewIndex: number) => {
      void applyWorkspaceLayoutChange((layout) =>
        switchPaneView(layout, paneId, viewIndex),
      )
    },
    [applyWorkspaceLayoutChange],
  )

  const handleAppShortcut = useCallback(
    (shortcut: {
      projectIndex?: number
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
        const targetProject =
          typeof shortcut.projectIndex === 'number'
            ? (navigationSnapshot.projects[shortcut.projectIndex] ?? null)
            : null

        if (targetProject) {
          handleProjectSelection(targetProject.id)
        }
      }
    },
    [
      handleProjectSelection,
      handleRelativePaneSelection,
      handleRelativeWorkspaceSelection,
      navigationSnapshot.projects,
    ],
  )

  const dispatchShortcut = useCallback(
    (shortcut: {
      projectIndex?: number
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
      if (event.key === 'Control') {
        setShowProjectHints(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Control') {
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
  }, [])

  useEffect(() => {
    const api = getAideApi()

    if (!api) {
      return
    }

    return api.onWorkspaceActivity((event) => {
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
    })
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

      const shortcutProject = event.ctrlKey
        ? resolveProjectShortcutTarget(navigationSnapshot.projects, event.key)
        : null

      if (shortcutProject) {
        event.preventDefault()
        dispatchShortcut({
          projectIndex: navigationSnapshot.projects.findIndex(
            (project) => project.id === shortcutProject.id,
          ),
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
    isOverviewVisible,
    isWorkspaceSwitcherVisible,
    navigationSnapshot.projects,
  ])

  useEffect(() => {
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
  }, [])

  useEffect(() => {
    if (
      !resolvedNavigationState.activePaneId ||
      resolvePaneType(
        resolvePaneMetadata(resolvedNavigationState.activePaneId).type,
      ) !== 'terminal'
    ) {
      return
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

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur()
      }

      textarea.focus()
    }

    for (const delay of [0, 50, 150, 300, 600]) {
      window.setTimeout(focusTerminal, delay)
    }
  }, [resolvedNavigationState.activePaneId])

  const projects = navigationSnapshot.projects
  const allWorkspaces = navigationSnapshot.workspaces
  const activeProject =
    projects.find((p) => p.id === resolvedNavigationState.activeProjectId) ??
    null
  const activeWorkspace =
    allWorkspaces.find(
      (ws) => ws.id === resolvedNavigationState.activeWorkspaceId,
    ) ?? null
  const activePreviewState = getWorkspacePreviewState(
    workspaceRuntimeState,
    activeWorkspace,
  )
  const activePreviewTarget =
    activePreviewState.targets.find(
      (target) => target.id === activePreviewState.activeTargetId,
    ) ?? null
  const projectWorkspaces = activeProject
    ? allWorkspaces.filter(
        (workspace) => workspace.projectId === activeProject.id,
      )
    : []
  const activeWorkspaceSurfaces = activeWorkspace
    ? resolveWorkspaceSurfaces(navigationSnapshot, activeWorkspace.id)
    : []
  const workspaceSummaries = useMemo(
    () =>
      buildWorkspaceSummaryMap(projects, allWorkspaces, workspaceActivities),
    [allWorkspaces, projects, workspaceActivities],
  )
  const paletteCommands = useMemo(
    () =>
      buildCommandList({
        onCreatePane: createPane,
        onCreateWorkspace: createWorkspace,
        onOpenOverview: () => setIsOverviewVisible(true),
        onOpenProject: openProject,
        onSelectProject: handleProjectSelection,
        onSelectWorkspace: handleWorkspaceSelection,
        projects,
        workspaces: projectWorkspaces,
      }),
    [
      createPane,
      createWorkspace,
      handleProjectSelection,
      handleWorkspaceSelection,
      openProject,
      projects,
      projectWorkspaces,
    ],
  )

  const handleLoadPreviewTarget = useCallback(
    (workspace: WorkspaceRecord, url: string) => {
      setWorkspaceRuntimeState((current) =>
        upsertWorkspacePreviewTarget({
          runtimeState: current,
          url,
          workspace,
        }),
      )
    },
    [],
  )
  const handleSelectPreviewTarget = useCallback(
    (workspace: WorkspaceRecord, targetId: string) => {
      setWorkspaceRuntimeState((current) =>
        selectWorkspacePreviewTarget({
          runtimeState: current,
          targetId,
          workspace,
        }),
      )
    },
    [],
  )

  return (
    <AppShell
      activeSurfaceId={resolvedNavigationState.activeSurfaceId}
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      surfaces={activeWorkspaceSurfaces}
      showProjectHints={showProjectHints}
      onSelectPane={(paneId: string) =>
        setSelection(
          applySurfaceSelection(
            navigationSnapshot,
            resolvedNavigationState,
            paneId,
            getSurfaceIdsForWorkspace,
            getPaneIdsForWorkspace,
          ),
        )
      }
      onCreateProject={openProject}
      onCreatePane={createPane}
      onCreateWorkspace={createWorkspace}
      onSelectProject={handleProjectSelection}
      onSelectWorkspace={handleWorkspaceSelection}
      projects={projects}
      workspaces={allWorkspaces}
      workspaceSummaries={workspaceSummaries}
    >
      <>
        <CommandPalette
          commands={paletteCommands}
          isOpen={isCommandPaletteOpen}
          onClose={() => setIsCommandPaletteOpen(false)}
        />
        <PaneCreationModal
          isOpen={isPaneCreationOpen}
          onCreatePane={(paneId) => void handleCreatePane(paneId)}
          onOpenChange={setIsPaneCreationOpen}
        />
        <WorkspaceCreationModal
          isOpen={isWorkspaceCreationOpen}
          loadProjectRefs={listProjectRefs}
          onOpenChange={setIsWorkspaceCreationOpen}
          onSubmit={submitWorkspaceCreation}
          project={activeProject}
          workspaceCount={projectWorkspaces.length}
        />
        <WorkspaceSwitcherOverlay
          activeWorkspaceId={activeWorkspace?.id ?? null}
          mode="workspace-switcher"
          onRequestClose={() => setIsWorkspaceSwitcherVisible(false)}
          onSelectWorkspace={handleWorkspaceSelection}
          projectName={activeProject?.name ?? null}
          summaries={workspaceSummaries}
          visible={isWorkspaceSwitcherVisible}
          workspaces={allWorkspaces}
        />
        <WorkspaceSwitcherOverlay
          activeWorkspaceId={activeWorkspace?.id ?? null}
          mode="overview"
          onRequestClose={() => setIsOverviewVisible(false)}
          onSelectWorkspace={handleWorkspaceSelection}
          projectName={activeProject?.name ?? null}
          summaries={workspaceSummaries}
          visible={isOverviewVisible}
          workspaces={allWorkspaces}
        />
        <WorkspaceCanvas
          activeProject={activeProject}
          activePreviewTarget={activePreviewTarget}
          activeWorkspace={activeWorkspace}
          actionError={actionError}
          onAddView={handleAddView}
          onCreateProject={openProject}
          onCreateWorkspace={createWorkspace}
          onClosePane={handleClosePane}
          onLoadPreviewTarget={handleLoadPreviewTarget}
          onRemoveView={handleRemoveView}
          onResizePane={handleResizePane}
          onSelectPreviewTarget={handleSelectPreviewTarget}
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
          onSplitPane={handleSplitPane}
          onSwitchView={handleSwitchView}
          previewTargets={activePreviewState.targets}
          projectWorkspaces={projectWorkspaces}
          shellError={shellError}
          activePaneId={resolvedNavigationState.activePaneId}
          activeSurfaceId={resolvedNavigationState.activeSurfaceId}
          surfaceLayouts={navigationSnapshot.surfaceLayouts ?? {}}
          workspaceSurfaces={navigationSnapshot.workspaceSurfaces ?? {}}
          workspaceLayouts={navigationSnapshot.workspaceLayouts}
        />
      </>
    </AppShell>
  )
}
