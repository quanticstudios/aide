import type { WorkspaceStatus } from '../../../shared/domain'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

export interface WorkspaceSummary {
  branchName: string
  jobCount: number
  projectId: string
  projectName: string
  status: WorkspaceStatus
  workspaceId: string
  workspaceName: string
}

export function buildWorkspaceSummaryMap(
  projects: readonly ProjectRecord[],
  workspaces: readonly WorkspaceRecord[],
  activeWorkspaceId: string | null,
): Record<string, WorkspaceSummary> {
  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name]),
  )

  return Object.fromEntries(
    workspaces.map((workspace) => [
      workspace.id,
      {
        branchName: workspace.branchName,
        jobCount: 0,
        projectId: workspace.projectId,
        projectName:
          projectNameById.get(workspace.projectId) ?? 'Unknown project',
        status: workspace.id === activeWorkspaceId ? 'active' : 'idle',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
    ]),
  )
}
