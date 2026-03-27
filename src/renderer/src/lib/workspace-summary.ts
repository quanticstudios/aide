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

const WORKSPACE_SUMMARY_OVERRIDES: Record<
  string,
  { jobCount: number; status: Exclude<WorkspaceStatus, 'active'> }
> = {
  'demo-workspace-aide-nav': { jobCount: 2, status: 'idle' },
  'demo-workspace-aide-review': { jobCount: 1, status: 'error' },
  'demo-workspace-storefront-checkout': { jobCount: 3, status: 'running' },
  'demo-workspace-storefront-pricing': { jobCount: 1, status: 'idle' },
  'demo-workspace-infra-deploy': { jobCount: 4, status: 'running' },
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
      (() => {
        const override = WORKSPACE_SUMMARY_OVERRIDES[workspace.id]
        const isActive = workspace.id === activeWorkspaceId

        return {
          branchName: workspace.branchName,
          jobCount: override?.jobCount ?? 0,
          projectId: workspace.projectId,
          projectName:
            projectNameById.get(workspace.projectId) ?? 'Unknown project',
          status:
            isActive && (override?.status ?? 'idle') === 'idle'
              ? 'active'
              : (override?.status ?? 'idle'),
          workspaceId: workspace.id,
          workspaceName: workspace.name,
        }
      })(),
    ]),
  )
}
