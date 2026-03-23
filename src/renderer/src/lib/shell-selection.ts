import type {
  PersistenceSnapshot,
  WorkspaceRecord,
} from '../../../shared/persistence'

export interface ShellSelection {
  activeProjectId: string | null
  activeWorkspaceId: string | null
}

function getWorkspacesForProject(
  snapshot: PersistenceSnapshot,
  projectId: string,
): WorkspaceRecord[] {
  return snapshot.workspaces.filter(
    (workspace) => workspace.projectId === projectId,
  )
}

export function resolveShellSelection(
  snapshot: PersistenceSnapshot,
  activeProjectId: string | null,
  activeWorkspaceId: string | null,
): ShellSelection {
  const firstProject = snapshot.projects[0]

  if (!firstProject) {
    return {
      activeProjectId: null,
      activeWorkspaceId: null,
    }
  }

  const selectedProject =
    snapshot.projects.find((project) => project.id === activeProjectId) ??
    firstProject

  const projectWorkspaces = getWorkspacesForProject(
    snapshot,
    selectedProject.id,
  )
  const selectedWorkspace = projectWorkspaces.find(
    (workspace) => workspace.id === activeWorkspaceId,
  )

  return {
    activeProjectId: selectedProject.id,
    activeWorkspaceId:
      selectedWorkspace?.id ?? projectWorkspaces[0]?.id ?? null,
  }
}

export function resolveBootSelection(
  snapshot: PersistenceSnapshot,
  activeProjectId: string | null,
  activeWorkspaceId: string | null,
): ShellSelection {
  return resolveShellSelection(
    snapshot,
    activeProjectId ?? snapshot.lastActiveProjectId,
    activeWorkspaceId ?? snapshot.lastActiveWorkspaceId,
  )
}

export function selectProject(
  snapshot: PersistenceSnapshot,
  projectId: string,
): ShellSelection {
  return resolveShellSelection(snapshot, projectId, null)
}

export function selectLatestProject(
  snapshot: PersistenceSnapshot,
): ShellSelection {
  const latestProject = snapshot.projects.at(-1)

  if (!latestProject) {
    return {
      activeProjectId: null,
      activeWorkspaceId: null,
    }
  }

  return selectProject(snapshot, latestProject.id)
}

export function selectLatestWorkspace(
  snapshot: PersistenceSnapshot,
  projectId: string,
): ShellSelection {
  const projectWorkspaces = getWorkspacesForProject(snapshot, projectId)
  const latestWorkspace = projectWorkspaces.at(-1)

  return {
    activeProjectId: projectId,
    activeWorkspaceId: latestWorkspace?.id ?? null,
  }
}

export function selectRelativeWorkspace(
  snapshot: PersistenceSnapshot,
  activeProjectId: string | null,
  activeWorkspaceId: string | null,
  direction: -1 | 1,
): ShellSelection {
  const currentSelection = resolveShellSelection(
    snapshot,
    activeProjectId,
    activeWorkspaceId,
  )

  if (
    !currentSelection.activeProjectId ||
    !currentSelection.activeWorkspaceId
  ) {
    return currentSelection
  }

  const projectWorkspaces = getWorkspacesForProject(
    snapshot,
    currentSelection.activeProjectId,
  )

  if (projectWorkspaces.length === 0) {
    return currentSelection
  }

  const currentIndex = projectWorkspaces.findIndex(
    (workspace) => workspace.id === currentSelection.activeWorkspaceId,
  )

  if (currentIndex === -1) {
    return currentSelection
  }

  const nextIndex =
    (currentIndex + direction + projectWorkspaces.length) %
    projectWorkspaces.length

  return {
    activeProjectId: currentSelection.activeProjectId,
    activeWorkspaceId: projectWorkspaces[nextIndex]?.id ?? null,
  }
}
