import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AideApi } from '../../shared/ipc'
import type {
  CreateProjectInput,
  PersistenceSnapshot,
  WorkspaceLayoutRecord,
} from '../../shared/persistence'
import AppShell from './components/AppShell'
import ProjectCreationModal from './components/ProjectCreationModal'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import WorkspaceCreationModal from './components/WorkspaceCreationModal'
import WorkspaceSwitcherOverlay from './components/WorkspaceSwitcherOverlay'
import {
  isNavigationPocSnapshot,
  resolveNavigationSnapshot,
} from './lib/navigation-poc'
import { createProjectDraftValues } from './lib/project-draft'
import { resolveProjectShortcutTarget } from './lib/project-shortcuts'
import {
  applyPaneSelection,
  applyProjectSelection,
  applyWorkspaceSelection,
  moveRelativePane,
  moveRelativeWorkspace,
  resolveSpatialNavigationState,
} from './lib/spatial-navigation-state'
import {
  collectWorkspaceLayoutPaneIds,
  resolveWorkspaceLayout,
} from './lib/workspace-layout'
import {
  closeWorkspacePane,
  resizeWorkspacePane,
  splitWorkspacePane,
} from './lib/workspace-layout-mutations'
import { resolveHorizontalPaneNeighbor } from './lib/workspace-layout-navigation'
import { useWorkspaceSelectionStore } from './lib/workspace-selection-store'
import { buildWorkspaceSummaryMap } from './lib/workspace-summary'

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

export default function App() {
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [isProjectCreationOpen, setIsProjectCreationOpen] = useState(false)
  const [projectCreationDefaults, setProjectCreationDefaults] =
    useState<ReturnType<typeof createProjectDraftValues> | null>(null)
  const [isWorkspaceSwitcherVisible, setIsWorkspaceSwitcherVisible] =
    useState(false)
  const [isOverviewVisible, setIsOverviewVisible] = useState(false)
  const [isWorkspaceCreationOpen, setIsWorkspaceCreationOpen] = useState(false)
  const [showProjectHints, setShowProjectHints] = useState(false)
  const lastResolvedNavigationRef = useRef('')
  const activeProjectId = useWorkspaceSelectionStore(
    (state) => state.activeProjectId,
  )
  const activeWorkspaceId = useWorkspaceSelectionStore(
    (state) => state.activeWorkspaceId,
  )
  const activePaneId = useWorkspaceSelectionStore((state) => state.activePaneId)
  const activePaneIdsByWorkspace = useWorkspaceSelectionStore(
    (state) => state.activePaneIdsByWorkspace,
  )
  const rememberedWorkspaceIdsByProject = useWorkspaceSelectionStore(
    (state) => state.rememberedWorkspaceIdsByProject,
  )
  const setSelection = useWorkspaceSelectionStore((state) => state.setSelection)
  const navigationSnapshot = resolveNavigationSnapshot(storageSnapshot)
  const isDemoMode = isNavigationPocSnapshot(navigationSnapshot)
  const getPaneIdsForSnapshot = useCallback(
    (snapshot: PersistenceSnapshot, workspaceId: string | null) => {
      const layout = resolveWorkspaceLayout(snapshot, workspaceId)

      return collectWorkspaceLayoutPaneIds(layout)
    },
    [],
  )
  const getPaneIdsForWorkspace = useCallback(
    (workspaceId: string | null) =>
      getPaneIdsForSnapshot(navigationSnapshot, workspaceId),
    [getPaneIdsForSnapshot, navigationSnapshot],
  )
  const currentNavigationState = useMemo(
    () => ({
      activePaneId,
      activeProjectId,
      activeWorkspaceId,
      rememberedPaneIdsByWorkspace: activePaneIdsByWorkspace,
      rememberedWorkspaceIdsByProject,
    }),
    [
      activePaneId,
      activePaneIdsByWorkspace,
      activeProjectId,
      activeWorkspaceId,
      rememberedWorkspaceIdsByProject,
    ],
  )
  const resolvedNavigationState = useMemo(
    () =>
      resolveSpatialNavigationState(
        navigationSnapshot,
        currentNavigationState,
        getPaneIdsForWorkspace,
      ),
    [currentNavigationState, getPaneIdsForWorkspace, navigationSnapshot],
  )

  const refreshStorage = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const snapshot = await api.getStorageSnapshot()
      setStorageSnapshot(snapshot)
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [])

  const createProject = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const runtimeSnapshot = await api.getRuntimeSnapshot()
      setProjectCreationDefaults(
        createProjectDraftValues(runtimeSnapshot.workingDirectory),
      )
      setIsProjectCreationOpen(true)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [])

  const submitProjectCreation = useCallback(
    async (input: CreateProjectInput) => {
      const api = getAideApi()

      if (!api) {
        return 'Desktop bridge did not load. Reload the app window.'
      }

      try {
        const snapshot = await api.createProject(input)
        const latestProjectId = snapshot.projects.at(-1)?.id ?? null

        if (!latestProjectId) {
          return 'Project was created but no project record was returned.'
        }

        const nextState = applyProjectSelection(
          snapshot,
          resolvedNavigationState,
          latestProjectId,
          getPaneIdsForWorkspace,
        )

        setStorageSnapshot(snapshot)
        setSelection(nextState)
        setShellError(null)
        setIsProjectCreationOpen(false)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [getPaneIdsForWorkspace, resolvedNavigationState, setSelection],
  )

  const createWorkspace = useCallback(() => {
    if (!activeProjectId) {
      return
    }

    setIsWorkspaceCreationOpen(true)
  }, [activeProjectId])

  const submitWorkspaceCreation = useCallback(
    async (input: {
      branchName: string
      name: string
      projectId: string
      worktreePath: string
    }) => {
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
          getPaneIdsForWorkspace,
        )

        setStorageSnapshot(snapshot)
        setSelection(nextState)
        setShellError(null)
        setIsWorkspaceCreationOpen(false)
        return null
      } catch (error) {
        return getErrorMessage(error)
      }
    },
    [getPaneIdsForWorkspace, resolvedNavigationState, setSelection],
  )

  useEffect(() => {
    void refreshStorage()
  }, [refreshStorage])

  useEffect(() => {
    const resolvedSignature = JSON.stringify(resolvedNavigationState)

    if (
      activePaneId === resolvedNavigationState.activePaneId &&
      activeProjectId === resolvedNavigationState.activeProjectId &&
      activeWorkspaceId === resolvedNavigationState.activeWorkspaceId &&
      recordsEqual(
        activePaneIdsByWorkspace,
        resolvedNavigationState.rememberedPaneIdsByWorkspace,
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
    activePaneIdsByWorkspace,
    activeProjectId,
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
        paneIdsByWorkspace:
          resolvedNavigationState.rememberedPaneIdsByWorkspace,
        projectId: resolvedNavigationState.activeProjectId,
        workspaceIdsByProject:
          resolvedNavigationState.rememberedWorkspaceIdsByProject,
        workspaceId: resolvedNavigationState.activeWorkspaceId,
      })
      .catch((error: unknown) => {
        setShellError(getErrorMessage(error))
      })
  }, [
    resolvedNavigationState.rememberedPaneIdsByWorkspace,
    resolvedNavigationState.activeProjectId,
    resolvedNavigationState.activeWorkspaceId,
    resolvedNavigationState.rememberedWorkspaceIdsByProject,
    storageSnapshot,
  ])

  const handleProjectSelection = useCallback(
    (projectId: string) => {
      setSelection(
        applyProjectSelection(
          navigationSnapshot,
          resolvedNavigationState,
          projectId,
          getPaneIdsForWorkspace,
        ),
      )
    },
    [
      getPaneIdsForWorkspace,
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
          getPaneIdsForWorkspace,
        ),
      )
      setIsWorkspaceSwitcherVisible(false)
      setIsOverviewVisible(false)
    },
    [
      getPaneIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const handleRelativeWorkspaceSelection = useCallback(
    (direction: -1 | 1) => {
      setSelection(
        moveRelativeWorkspace(
          navigationSnapshot,
          resolvedNavigationState,
          direction,
          getPaneIdsForWorkspace,
        ),
      )
    },
    [
      getPaneIdsForWorkspace,
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
          getPaneIdsForWorkspace,
          (workspaceId, paneId, paneDirection) => {
            const layout = resolveWorkspaceLayout(
              navigationSnapshot,
              workspaceId,
            )

            return layout
              ? resolveHorizontalPaneNeighbor(layout, paneId, paneDirection)
              : null
          },
        ),
      )
    },
    [
      getPaneIdsForWorkspace,
      navigationSnapshot,
      resolvedNavigationState,
      setSelection,
    ],
  )

  const resolveSelectionForSnapshot = useCallback(
    (
      snapshot: PersistenceSnapshot,
      workspaceId: string,
      nextActivePaneId: string | null,
    ) =>
      resolveSpatialNavigationState(
        snapshot,
        {
          ...resolvedNavigationState,
          activePaneId: nextActivePaneId,
          rememberedPaneIdsByWorkspace: {
            ...resolvedNavigationState.rememberedPaneIdsByWorkspace,
            [workspaceId]: nextActivePaneId,
          },
        },
        (targetWorkspaceId) =>
          getPaneIdsForSnapshot(snapshot, targetWorkspaceId),
      ),
    [getPaneIdsForSnapshot, resolvedNavigationState],
  )

  const applyWorkspaceLayoutChange = useCallback(
    async (
      mutateLayout: (
        layout: WorkspaceLayoutRecord,
      ) => ReturnType<typeof splitWorkspacePane>,
    ) => {
      const workspaceId = resolvedNavigationState.activeWorkspaceId

      if (!workspaceId) {
        return
      }

      const currentLayout = resolveWorkspaceLayout(
        navigationSnapshot,
        workspaceId,
      )

      if (!currentLayout) {
        return
      }

      const result = mutateLayout(currentLayout)

      if (result.blockedReason === 'last-pane') {
        setShellError(
          'Last-pane protection is active. A workspace must keep at least one pane.',
        )
        return
      }

      if (!result.didChange) {
        return
      }

      try {
        if (isDemoMode) {
          const snapshot: PersistenceSnapshot = {
            ...navigationSnapshot,
            workspaceLayouts: {
              ...navigationSnapshot.workspaceLayouts,
              [workspaceId]: result.layout,
            },
          }

          setStorageSnapshot(snapshot)
          setSelection(
            resolveSelectionForSnapshot(
              snapshot,
              workspaceId,
              result.nextActivePaneId,
            ),
          )
          setShellError(null)
          return
        }

        const api = getAideApi()

        if (!api) {
          setShellError('Desktop bridge did not load. Reload the app window.')
          return
        }

        const snapshot = await api.saveWorkspaceLayout(workspaceId, {
          nodes: result.layout.nodes,
          rootNodeId: result.layout.rootNodeId,
        })

        setStorageSnapshot(snapshot)
        setSelection(
          resolveSelectionForSnapshot(
            snapshot,
            workspaceId,
            result.nextActivePaneId,
          ),
        )
        setShellError(null)
      } catch (error) {
        setShellError(getErrorMessage(error))
      }
    },
    [
      isDemoMode,
      navigationSnapshot,
      resolveSelectionForSnapshot,
      resolvedNavigationState.activeWorkspaceId,
      setSelection,
    ],
  )

  const handleSplitPane = useCallback(
    (paneId: string, splitType: 'split-horizontal' | 'split-vertical') => {
      void applyWorkspaceLayoutChange((layout) =>
        splitWorkspacePane(layout, paneId, splitType),
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

  const handleAppShortcut = useCallback(
    (shortcut: {
      projectIndex?: number
      type:
        | 'pane-next'
        | 'pane-previous'
        | 'project-jump'
        | 'workspace-next'
        | 'workspace-previous'
    }) => {
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
        | 'pane-next'
        | 'pane-previous'
        | 'project-jump'
        | 'workspace-next'
        | 'workspace-previous'
    }) => {
      handleAppShortcut(shortcut)
    },
    [handleAppShortcut],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsWorkspaceSwitcherVisible(true)
      }

      if (event.key === 'Control') {
        setShowProjectHints(true)
      }
    }

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsWorkspaceSwitcherVisible(false)
      }

      if (event.key === 'Control') {
        setShowProjectHints(false)
      }
    }

    const handleWindowBlur = () => {
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
        setIsOverviewVisible(true)
      }
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
        setIsOverviewVisible(true)
        return
      }

      if (isOverviewVisible && event.key === 'Escape') {
        event.preventDefault()
        setIsOverviewVisible(false)
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

      if (isAltChord && event.key === 'ArrowUp') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-previous' })
      }

      if (isAltChord && normalizedKey === 'k') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-previous' })
      }

      if (isAltChord && event.key === 'ArrowDown') {
        event.preventDefault()
        dispatchShortcut({ type: 'workspace-next' })
      }

      if (isAltChord && normalizedKey === 'j') {
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
  }, [dispatchShortcut, isOverviewVisible, navigationSnapshot.projects])

  const projects = navigationSnapshot.projects
  const allWorkspaces = navigationSnapshot.workspaces
  const activeProject =
    projects.find((p) => p.id === resolvedNavigationState.activeProjectId) ??
    null
  const activeWorkspace =
    allWorkspaces.find(
      (ws) => ws.id === resolvedNavigationState.activeWorkspaceId,
    ) ?? null
  const projectWorkspaces = activeProject
    ? allWorkspaces.filter(
        (workspace) => workspace.projectId === activeProject.id,
      )
    : []
  const activeWorkspacePaneIds = getPaneIdsForWorkspace(
    resolvedNavigationState.activeWorkspaceId,
  )
  const workspaceSummaries = useMemo(
    () =>
      buildWorkspaceSummaryMap(
        projects,
        allWorkspaces,
        resolvedNavigationState.activeWorkspaceId,
      ),
    [allWorkspaces, projects, resolvedNavigationState.activeWorkspaceId],
  )

  return (
    <AppShell
      activePaneId={activePaneId}
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      isDemoMode={isDemoMode}
      paneIds={activeWorkspacePaneIds}
      showProjectHints={showProjectHints}
      onSelectPane={(paneId: string) =>
        setSelection(
          applyPaneSelection(
            navigationSnapshot,
            resolvedNavigationState,
            paneId,
            getPaneIdsForWorkspace,
          ),
        )
      }
      onCreateProject={createProject}
      onCreateWorkspace={createWorkspace}
      onSelectProject={handleProjectSelection}
      onSelectWorkspace={handleWorkspaceSelection}
      projects={projects}
      workspaces={allWorkspaces}
      workspaceSummaries={workspaceSummaries}
    >
      <>
        <ProjectCreationModal
          defaults={projectCreationDefaults}
          isOpen={isProjectCreationOpen}
          onOpenChange={setIsProjectCreationOpen}
          onSubmit={submitProjectCreation}
        />
        <WorkspaceCreationModal
          isOpen={isWorkspaceCreationOpen}
          onOpenChange={setIsWorkspaceCreationOpen}
          onSubmit={submitWorkspaceCreation}
          project={activeProject}
          workspaceCount={projectWorkspaces.length}
        />
        <WorkspaceSwitcherOverlay
          activeWorkspaceId={activeWorkspace?.id ?? null}
          mode="workspace-switcher"
          onSelectWorkspace={handleWorkspaceSelection}
          projectName={activeProject?.name ?? null}
          summaries={workspaceSummaries}
          visible={isWorkspaceSwitcherVisible}
          workspaces={projectWorkspaces}
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
          activeWorkspace={activeWorkspace}
          onCreateProject={createProject}
          onCreateWorkspace={createWorkspace}
          onClosePane={handleClosePane}
          onResizePane={handleResizePane}
          onSelectPane={(paneId: string) =>
            setSelection(
              applyPaneSelection(
                navigationSnapshot,
                resolvedNavigationState,
                paneId,
                getPaneIdsForWorkspace,
              ),
            )
          }
          onSplitPane={handleSplitPane}
          projectWorkspaces={projectWorkspaces}
          shellError={isDemoMode ? null : shellError}
          activePaneId={activePaneId}
          workspaceLayouts={navigationSnapshot.workspaceLayouts}
        />
      </>
    </AppShell>
  )
}
