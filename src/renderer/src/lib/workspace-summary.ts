import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../../shared/workspace-activity'
import { resolveAggregateWorkspaceActivity } from '../../../shared/workspace-activity'

export interface WorkspaceSummary {
  activity: WorkspaceActivitySnapshot | null
  branchName: string
  projectId: string
  projectName: string
  workspaceId: string
  workspaceName: string
}

const DEMO_ACTIVITY_OVERRIDES: Record<string, WorkspaceActivitySnapshot> = {
  'demo-workspace-aide-nav': {
    detail: null,
    provider: 'claude',
    source: 'managed',
    state: 'completed',
    updatedAt: '2026-03-24T00:00:00Z',
    workspaceId: 'demo-workspace-aide-nav',
  },
  'demo-workspace-aide-review': {
    detail: '1 MCP server failed',
    provider: 'claude',
    source: 'managed',
    state: 'pending-approval',
    updatedAt: '2026-03-24T00:00:00Z',
    workspaceId: 'demo-workspace-aide-review',
  },
  'demo-workspace-storefront-checkout': {
    detail: null,
    provider: 'codex',
    source: 'managed',
    state: 'working',
    updatedAt: '2026-03-24T00:00:00Z',
    workspaceId: 'demo-workspace-storefront-checkout',
  },
  'demo-workspace-storefront-pricing': {
    detail: null,
    provider: 'claude',
    source: 'managed',
    state: 'completed',
    updatedAt: '2026-03-24T00:00:00Z',
    workspaceId: 'demo-workspace-storefront-pricing',
  },
  'demo-workspace-infra-deploy': {
    detail: null,
    provider: 'terminal',
    source: 'fallback',
    state: 'terminal-running',
    updatedAt: '2026-03-24T00:00:00Z',
    workspaceId: 'demo-workspace-infra-deploy',
  },
}

export function buildWorkspaceSummaryMap(
  projects: readonly ProjectRecord[],
  workspaces: readonly WorkspaceRecord[],
  activitiesByWorkspace: Record<string, WorkspaceActivitySnapshot>,
  options?: {
    useDemoMode?: boolean
  },
): Record<string, WorkspaceSummary> {
  const projectNameById = new Map(
    projects.map((project) => [project.id, project.name]),
  )
  const useDemoMode = options?.useDemoMode ?? false

  return Object.fromEntries(
    workspaces.map((workspace) => [
      workspace.id,
      {
        activity:
          activitiesByWorkspace[workspace.id] ??
          (useDemoMode
            ? (DEMO_ACTIVITY_OVERRIDES[workspace.id] ?? null)
            : null),
        branchName: workspace.branchName,
        projectId: workspace.projectId,
        projectName:
          projectNameById.get(workspace.projectId) ?? 'Unknown project',
        workspaceId: workspace.id,
        workspaceName: workspace.name,
      },
    ]),
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
