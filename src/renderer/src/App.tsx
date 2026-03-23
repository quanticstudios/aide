import { useCallback, useEffect, useState } from 'react'

import type { AideApi } from '../../shared/ipc'
import type { PersistenceSnapshot } from '../../shared/persistence'
import AppShell from './components/AppShell'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import WorkspaceSwitcherOverlay from './components/WorkspaceSwitcherOverlay'
import {
  isNavigationPocSnapshot,
  resolveNavigationSnapshot,
  resolveWorkspacePaneId,
  selectRelativePane,
} from './lib/navigation-poc'
import { resolveProjectShortcutTarget } from './lib/project-shortcuts'
import {
  resolveBootSelection,
  selectLatestProject,
  selectLatestWorkspace,
  selectProject,
  selectRelativeWorkspace,
} from './lib/shell-selection'
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

function getPathLeaf(pathValue: string): string {
  return pathValue.split(/[/\\]/).filter(Boolean).at(-1) ?? 'project'
}

function shouldIgnoreGlobalNavigation(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  return Boolean(
    target.closest('input, textarea, select, [contenteditable="true"]'),
  )
}

export default function App() {
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [isWorkspaceSwitcherVisible, setIsWorkspaceSwitcherVisible] =
    useState(false)
  const [showProjectHints, setShowProjectHints] = useState(false)
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
  const setActivePaneForWorkspace = useWorkspaceSelectionStore(
    (state) => state.setActivePaneForWorkspace,
  )
  const setSelection = useWorkspaceSelectionStore((state) => state.setSelection)
  const navigationSnapshot = resolveNavigationSnapshot(storageSnapshot)
  const navigationSelection = resolveBootSelection(
    navigationSnapshot,
    activeProjectId,
    activeWorkspaceId,
  )
  const isDemoMode = isNavigationPocSnapshot(navigationSnapshot)

  const resolveRememberedPaneId = useCallback(
    (workspaceId: string | null, fallbackPaneId: string | null = null) => {
      const rememberedPaneId = workspaceId
        ? (activePaneIdsByWorkspace[workspaceId] ?? null)
        : null

      return resolveWorkspacePaneId(
        workspaceId,
        fallbackPaneId ?? rememberedPaneId,
      )
    },
    [activePaneIdsByWorkspace],
  )

  const refreshStorage = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const snapshot = await api.getStorageSnapshot()
      const selection = resolveBootSelection(
        snapshot,
        activeProjectId,
        activeWorkspaceId,
      )

      setStorageSnapshot(snapshot)
      setSelection({
        ...selection,
        activePaneId: resolveRememberedPaneId(
          selection.activeWorkspaceId,
          activePaneId,
        ),
      })
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [
    activePaneId,
    activeProjectId,
    activeWorkspaceId,
    resolveRememberedPaneId,
    setSelection,
  ])

  const createProject = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setShellError('Desktop bridge did not load. Reload the app window.')
      return
    }

    try {
      const runtimeSnapshot = await api.getRuntimeSnapshot()
      const snapshot = await api.createProject({
        name: getPathLeaf(runtimeSnapshot.workingDirectory),
        repoRoot: runtimeSnapshot.workingDirectory,
        remoteUrl: null,
        defaultBranch: 'main',
      })
      const selection = selectLatestProject(snapshot)

      setStorageSnapshot(snapshot)
      setSelection({
        ...selection,
        activePaneId: resolveRememberedPaneId(selection.activeWorkspaceId),
      })
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [resolveRememberedPaneId, setSelection])

  const createWorkspace = useCallback(async () => {
    const api = getAideApi()

    if (!api || !activeProjectId) {
      return
    }

    const projectWorkspaces =
      storageSnapshot?.workspaces.filter(
        (ws) => ws.projectId === activeProjectId,
      ) ?? []

    const selectedProject = storageSnapshot?.projects.find(
      (project) => project.id === activeProjectId,
    )

    if (!selectedProject) {
      return
    }

    try {
      const workspaceNumber = projectWorkspaces.length + 1
      const snapshot = await api.createWorkspace({
        projectId: activeProjectId,
        name: `Workspace ${workspaceNumber}`,
        branchName: 'main',
        worktreePath: `${selectedProject.repoRoot}/.worktrees/workspace-${workspaceNumber}`,
        windowId: null,
      })
      const selection = selectLatestWorkspace(snapshot, activeProjectId)

      setStorageSnapshot(snapshot)
      setSelection({
        ...selection,
        activePaneId: resolveRememberedPaneId(selection.activeWorkspaceId),
      })
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [activeProjectId, resolveRememberedPaneId, setSelection, storageSnapshot])

  useEffect(() => {
    void refreshStorage()
  }, [refreshStorage])

  useEffect(() => {
    const api = getAideApi()

    if (!api || !storageSnapshot || storageSnapshot.projects.length === 0) {
      return
    }

    void api
      .setActiveSelection({
        projectId: activeProjectId,
        workspaceId: activeWorkspaceId,
      })
      .catch((error: unknown) => {
        setShellError(getErrorMessage(error))
      })
  }, [activeProjectId, activeWorkspaceId, storageSnapshot])

  useEffect(() => {
    const nextPaneId = resolveRememberedPaneId(activeWorkspaceId, activePaneId)

    if (nextPaneId !== activePaneId) {
      setSelection({ activePaneId: nextPaneId })
    }
  }, [activePaneId, activeWorkspaceId, resolveRememberedPaneId, setSelection])

  const handleProjectSelection = useCallback(
    (projectId: string) => {
      const selection = selectProject(navigationSnapshot, projectId)

      setSelection({
        ...selection,
        activePaneId: resolveRememberedPaneId(selection.activeWorkspaceId),
      })
    },
    [navigationSnapshot, resolveRememberedPaneId, setSelection],
  )

  const handleWorkspaceSelection = useCallback(
    (workspaceId: string) => {
      const workspace = navigationSnapshot.workspaces.find(
        (candidate) => candidate.id === workspaceId,
      )

      if (!workspace) {
        return
      }

      setSelection({
        activePaneId: resolveRememberedPaneId(workspace.id),
        activeProjectId: workspace.projectId,
        activeWorkspaceId: workspace.id,
      })
      setIsWorkspaceSwitcherVisible(false)
    },
    [navigationSnapshot.workspaces, resolveRememberedPaneId, setSelection],
  )

  const handleRelativeWorkspaceSelection = useCallback(
    (direction: -1 | 1) => {
      const selection = selectRelativeWorkspace(
        navigationSnapshot,
        navigationSelection.activeProjectId,
        navigationSelection.activeWorkspaceId,
        direction,
      )

      setSelection({
        ...selection,
        activePaneId: resolveRememberedPaneId(selection.activeWorkspaceId),
      })
    },
    [
      navigationSelection.activeProjectId,
      navigationSelection.activeWorkspaceId,
      navigationSnapshot,
      resolveRememberedPaneId,
      setSelection,
    ],
  )

  const handleRelativePaneSelection = useCallback(
    (direction: -1 | 1) => {
      const nextPaneId = selectRelativePane(
        navigationSelection.activeWorkspaceId,
        activePaneId,
        direction,
      )

      setActivePaneForWorkspace(
        navigationSelection.activeWorkspaceId,
        nextPaneId,
      )
    },
    [
      activePaneId,
      navigationSelection.activeWorkspaceId,
      setActivePaneForWorkspace,
    ],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Alt') {
        setIsWorkspaceSwitcherVisible(true)
      }

      if (event.key === 'Control') {
        setShowProjectHints(true)
      }

      if (
        event.defaultPrevented ||
        shouldIgnoreGlobalNavigation(event.target)
      ) {
        return
      }

      const normalizedKey = event.key.toLowerCase()
      const isAltChord = event.altKey && !event.metaKey && !event.ctrlKey
      const isPaneChord = event.altKey && !event.metaKey && !event.ctrlKey
      const isPlainChord = !event.altKey && !event.metaKey && !event.ctrlKey
      const shortcutProject = event.ctrlKey
        ? resolveProjectShortcutTarget(navigationSnapshot.projects, event.key)
        : null

      if (shortcutProject) {
        event.preventDefault()
        handleProjectSelection(shortcutProject.id)
        return
      }

      if (isAltChord && event.key === 'ArrowUp') {
        event.preventDefault()
        handleRelativeWorkspaceSelection(-1)
      }

      if (isAltChord && normalizedKey === 'k') {
        event.preventDefault()
        handleRelativeWorkspaceSelection(-1)
      }

      if (isAltChord && event.key === 'ArrowDown') {
        event.preventDefault()
        handleRelativeWorkspaceSelection(1)
      }

      if (isAltChord && normalizedKey === 'j') {
        event.preventDefault()
        handleRelativeWorkspaceSelection(1)
      }

      if (
        (isAltChord && event.key === 'ArrowLeft') ||
        (normalizedKey === 'h' && (isPaneChord || isPlainChord))
      ) {
        event.preventDefault()
        handleRelativePaneSelection(-1)
      }

      if (
        (isAltChord && event.key === 'ArrowRight') ||
        (normalizedKey === 'l' && (isPaneChord || isPlainChord))
      ) {
        event.preventDefault()
        handleRelativePaneSelection(1)
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
  }, [
    handleProjectSelection,
    handleRelativePaneSelection,
    handleRelativeWorkspaceSelection,
    navigationSnapshot.projects,
  ])

  const projects = navigationSnapshot.projects
  const allWorkspaces = navigationSnapshot.workspaces
  const activeProject =
    projects.find((p) => p.id === navigationSelection.activeProjectId) ?? null
  const activeWorkspace =
    allWorkspaces.find(
      (ws) => ws.id === navigationSelection.activeWorkspaceId,
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
        setActivePaneForWorkspace(activeWorkspaceId, paneId)
      }
      onCreateProject={createProject}
      onCreateWorkspace={createWorkspace}
      onSelectProject={handleProjectSelection}
      projects={projects}
    >
      <>
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
