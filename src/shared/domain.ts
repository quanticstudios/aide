import type { ProjectRecord, WorkspaceRecord } from './persistence'

export type PaneType =
  | 'chat'
  | 'terminal'
  | 'git'
  | 'preview'
  | 'editor'
  | 'logs'
  | 'jobs'

export type LayoutNodeType = 'split-horizontal' | 'split-vertical' | 'pane'

export type WorkspaceStatus = 'idle' | 'active' | 'running' | 'error'

export type JobType =
  | 'provider-task'
  | 'command-execution'
  | 'test-run'
  | 'build'
  | 'preview-start'
  | 'git-operation'

export type JobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error'

export interface ProjectSettings {
  preferredProviderId: string | null
}

export interface PreviewTarget {
  id: string
  label: string
  url: string
  isActive: boolean
}

export interface WorkspaceProviderConfig {
  defaultProviderId: string | null
}

export interface Project extends ProjectRecord {
  settings: ProjectSettings
  workspaceIds: string[]
}

export interface Workspace extends WorkspaceRecord {
  activePaneId: string | null
  layoutRootId: string | null
  pinned: boolean
  previewTargets: PreviewTarget[]
  providerConfig: WorkspaceProviderConfig
  status: WorkspaceStatus
}

export interface SplitLayoutNode {
  children: string[]
  id: string
  parentId: string | null
  paneId: null
  sizeWeights: number[]
  type: 'split-horizontal' | 'split-vertical'
  workspaceId: string
}

export interface PaneLayoutNode {
  children: []
  id: string
  parentId: string | null
  paneId: string
  sizeWeights: []
  type: 'pane'
  workspaceId: string
}

export type LayoutNode = SplitLayoutNode | PaneLayoutNode

export interface Pane<TState = unknown> {
  createdAt: string
  id: string
  state: TState
  title: string
  type: PaneType
  updatedAt: string
  workspaceId: string
}

export interface Job {
  detailsRef: string | null
  endedAt: string | null
  id: string
  result: string | null
  source: string
  startedAt: string
  status: JobStatus
  summary: string
  type: JobType
  workspaceId: string
}

export interface NotificationActionTarget {
  jobId: string | null
  paneId: string | null
  workspaceId: string
}

export interface Notification {
  actionTarget: NotificationActionTarget | null
  body: string
  createdAt: string
  id: string
  jobId: string | null
  projectId: string
  read: boolean
  severity: NotificationSeverity
  title: string
  workspaceId: string
}

export const DOMAIN_MODEL_GAPS = [
  'Pane state is intentionally typed as unknown until each pane surface has a stable persisted contract.',
  'Workspace provider configuration still needs a normalized capabilities model and approval-state schema.',
  'Layout node mutation helpers and repair rules are not defined yet; Phase 2 owns that behavior.',
  'Notification action targets are intentionally narrow and need expansion once jobs, panes, and overview routing are real.',
] as const

export function createProjectDraft(project: ProjectRecord): Project {
  return {
    ...project,
    settings: {
      preferredProviderId: null,
    },
    workspaceIds: [],
  }
}

export function createWorkspaceDraft(workspace: WorkspaceRecord): Workspace {
  return {
    ...workspace,
    activePaneId: null,
    layoutRootId: null,
    pinned: false,
    previewTargets: [],
    providerConfig: {
      defaultProviderId: null,
    },
    status: 'idle',
  }
}

export function createDefaultLayoutRoot(
  workspaceId: string,
  paneId: string,
): PaneLayoutNode {
  return {
    children: [],
    id: `${workspaceId}:layout-root`,
    parentId: null,
    paneId,
    sizeWeights: [],
    type: 'pane',
    workspaceId,
  }
}
