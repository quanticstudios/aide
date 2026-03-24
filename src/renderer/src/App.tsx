import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { AideApi } from '../../shared/ipc'
import type {
  CreateProjectInput,
  PersistenceSnapshot,
} from '../../shared/persistence'
import AppShell from './components/AppShell'
import ProjectCreationModal from './components/ProjectCreationModal'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import WorkspaceCreationModal from './components/WorkspaceCreationModal'
import WorkspaceSwitcherOverlay from './components/WorkspaceSwitcherOverlay'
import {
  getWorkspaceScene,
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
import { useWorkspaceSelectionStore } from './lib/workspace-selection-store'

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
  const [isWorkspaceCreationOpen, setIsWorkspaceCreationOpen] = useState(false)
  const [showProjectHints, setShowProjectHints] = useState(false)
  const lastShortcutRef = useRef<{ signature: string; time: number }>({
    signature: '',
    time: 0,
  })
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
  const getPaneIdsForWorkspace = useCallback((workspaceId: string | null) => {
    return getWorkspaceScene(workspaceId).panes.map((pane) => pane.id)
  }, [])
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
      return
    }

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
        projectId: resolvedNavigationState.activeProjectId,
        workspaceId: resolvedNavigationState.activeWorkspaceId,
      })
      .catch((error: unknown) => {
        setShellError(getErrorMessage(error))
      })
  }, [
    resolvedNavigationState.activeProjectId,
    resolvedNavigationState.activeWorkspaceId,
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
      const signature = `${shortcut.type}:${shortcut.projectIndex ?? ''}`
      const now = performance.now()

      if (
        lastShortcutRef.current.signature === signature &&
        now - lastShortcutRef.current.time < 80
      ) {
        return
      }

      lastShortcutRef.current = { signature, time: now }
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
    const aideApi = getAideApi()
    const unsubscribeShortcut = aideApi?.onAppShortcut(dispatchShortcut)

    const handleKeyDown = (event: KeyboardEvent) => {
      const normalizedKey = event.key.toLowerCase()
      const normalizedCode = event.code.toLowerCase()
      const isAltChord = event.altKey && !event.metaKey && !event.ctrlKey
      const isCtrlChord = event.ctrlKey && !event.metaKey && !event.altKey

      if (event.defaultPrevented) {
        return
      }

      if (
        shouldIgnoreGlobalNavigation(event.target) &&
        !isAltChord &&
        !isCtrlChord
      ) {
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
      unsubscribeShortcut?.()
    }
  }, [dispatchShortcut, navigationSnapshot.projects])

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

  return (
    <AppShell
      activePaneId={activePaneId}
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      isDemoMode={isDemoMode}
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
      projects={projects}
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
          onSelectWorkspace={handleWorkspaceSelection}
          projectName={activeProject?.name ?? null}
          visible={isWorkspaceSwitcherVisible}
          workspaces={projectWorkspaces}
        />
        <WorkspaceCanvas
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          onCreateProject={createProject}
          onCreateWorkspace={createWorkspace}
          shellError={isDemoMode ? null : shellError}
          activePaneId={activePaneId}
        />
      </>
    </AppShell>
  )
}
