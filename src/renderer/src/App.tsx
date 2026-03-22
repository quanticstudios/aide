import { useCallback, useEffect, useState } from 'react'

import type { AideApi } from '../../shared/ipc'
import type { PersistenceSnapshot } from '../../shared/persistence'
import AppShell from './components/AppShell'
import WorkspaceCanvas from './components/WorkspaceCanvas'
import {
  resolveBootSelection,
  selectLatestProject,
  selectLatestWorkspace,
  selectProject,
} from './lib/shell-selection'

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

export default function App() {
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [shellError, setShellError] = useState<string | null>(null)
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null)
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(
    null,
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
      setActiveProjectId(selection.activeProjectId)
      setActiveWorkspaceId(selection.activeWorkspaceId)
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [activeProjectId, activeWorkspaceId])

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
      setActiveProjectId(selection.activeProjectId)
      setActiveWorkspaceId(selection.activeWorkspaceId)
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [])

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
      setActiveProjectId(selection.activeProjectId)
      setActiveWorkspaceId(selection.activeWorkspaceId)
      setShellError(null)
    } catch (error) {
      setShellError(getErrorMessage(error))
    }
  }, [activeProjectId, storageSnapshot])

  useEffect(() => {
    void refreshStorage()
  }, [refreshStorage])

  useEffect(() => {
    const api = getAideApi()

    if (!api || !storageSnapshot) {
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

  const handleProjectSelection = useCallback(
    (projectId: string) => {
      if (!storageSnapshot) {
        setActiveProjectId(projectId)
        setActiveWorkspaceId(null)
        return
      }

      const selection = selectProject(storageSnapshot, projectId)

      setActiveProjectId(selection.activeProjectId)
      setActiveWorkspaceId(selection.activeWorkspaceId)
    },
    [storageSnapshot],
  )

  const handleWorkspaceSelection = useCallback(
    (workspaceId: string) => {
      const workspace = storageSnapshot?.workspaces.find(
        (candidate) => candidate.id === workspaceId,
      )

      if (!workspace) {
        return
      }

      setActiveProjectId(workspace.projectId)
      setActiveWorkspaceId(workspace.id)
    },
    [storageSnapshot],
  )

  const projects = storageSnapshot?.projects ?? []
  const allWorkspaces = storageSnapshot?.workspaces ?? []
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null
  const activeWorkspace =
    allWorkspaces.find((ws) => ws.id === activeWorkspaceId) ?? null

  return (
    <AppShell
      activeProject={activeProject}
      activeWorkspace={activeWorkspace}
      onCreateProject={createProject}
      onCreateWorkspace={createWorkspace}
      onSelectProject={handleProjectSelection}
      onSelectWorkspace={handleWorkspaceSelection}
      projects={projects}
      workspaces={allWorkspaces}
    >
      <WorkspaceCanvas
        activeProject={activeProject}
        activeWorkspace={activeWorkspace}
        onCreateProject={createProject}
        onCreateWorkspace={createWorkspace}
        shellError={shellError}
      />
    </AppShell>
  )
}
