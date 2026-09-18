import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../../shared/workspace-activity'
import {
  resolveAggregateWorkspaceActivity,
  resolveWorkspaceActivityList,
} from '../../../shared/workspace-activity'

export interface WorkspaceSummary {
  activity: WorkspaceActivitySnapshot | null
  activities: WorkspaceActivitySnapshot[]
  branchName: string
  projectId: string
  projectName: string
  workspaceId: string
  workspaceName: string
}

export function buildWorkspaceSummaryMap(
  projects: readonly ProjectRecord[],
  workspaces: readonly WorkspaceRecord[],
  activitiesByWorkspace: Record<string, WorkspaceActivitySnapshot[]>,
): Record<string, WorkspaceSummary> {
  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name]),
  )

  return Object.fromEntries(
    workspaces.map((workspace) => {
      const agentActivities = (
        activitiesByWorkspace[workspace.id] ?? []
      ).filter((activity) => activity.provider !== 'terminal')

      return [
        workspace.id,
        {
          activities: resolveWorkspaceActivityList(agentActivities),
          activity: resolveAggregateWorkspaceActivity(agentActivities),
          branchName: workspace.branchName,
          projectId: workspace.projectId,
          projectName:
            projectNameById.get(workspace.projectId) ?? 'Unknown project',
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        },
      ]
    }),
  )
}

export function resolveProjectSummaryActivity(
  summaries: Record<string, WorkspaceSummary>,
  workspaces: readonly WorkspaceRecord[],
  projectId: string,
): WorkspaceActivitySnapshot | null {
  return resolveAggregateWorkspaceActivity(
    workspaces
      .filter((workspace) => workspace.projectId === projectId)
      .map((workspace) => summaries[workspace.id]?.activity ?? null)
      .filter(
        (activity): activity is WorkspaceActivitySnapshot => activity !== null,
      ),
  )
}
