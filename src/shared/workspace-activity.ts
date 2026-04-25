export type WorkspaceActivityProvider = 'claude' | 'codex' | 'terminal'

export type WorkspaceActivitySource = 'managed' | 'fallback'

export type WorkspaceActivityState =
  | 'pending-approval'
  | 'awaiting-input'
  | 'working'
  | 'connecting'
  | 'completed'
  | 'error'
  | 'terminal-running'

export interface WorkspaceActivitySnapshot {
  detail: string | null
  paneId: string
  provider: WorkspaceActivityProvider
  sessionId: string
  source: WorkspaceActivitySource
  state: WorkspaceActivityState
  updatedAt: string
  workspaceId: string
}

export interface WorkspaceActivityEvent {
  activities: WorkspaceActivitySnapshot[]
  workspaceId: string
}

const STATE_PRIORITY: Record<WorkspaceActivityState, number> = {
  error: 7,
  'pending-approval': 6,
  'awaiting-input': 5,
  working: 4,
  connecting: 3,
  completed: 2,
  'terminal-running': 1,
}

const STATE_LABELS: Record<WorkspaceActivityState, string> = {
  'awaiting-input': 'Awaiting Input',
  completed: 'Completed',
  connecting: 'Connecting',
  error: 'Error',
  'pending-approval': 'Pending Approval',
  'terminal-running': 'Running',
  working: 'Working',
}

export function compareWorkspaceActivityPriority(
  left: WorkspaceActivitySnapshot,
  right: WorkspaceActivitySnapshot,
): number {
  const stateDelta = STATE_PRIORITY[left.state] - STATE_PRIORITY[right.state]

  if (stateDelta !== 0) {
    return stateDelta * -1
  }

  return right.updatedAt.localeCompare(left.updatedAt)
}

export function formatWorkspaceActivityLabel(
  activity: WorkspaceActivitySnapshot,
): string {
  if (activity.provider === 'terminal') {
    return `Terminal ${STATE_LABELS[activity.state]}`
  }

  return `Agent ${STATE_LABELS[activity.state]}`
}

export function resolveWorkspaceActivityAccentClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
): string {
  if (!activity) {
    return 'text-muted-foreground/70'
  }

  if (activity.state === 'pending-approval') {
    return 'text-amber-400'
  }

  if (activity.state === 'error') {
    return 'text-red-400'
  }

  if (activity.state === 'working') {
    return 'text-sky-400'
  }

  if (activity.state === 'connecting') {
    return 'text-sky-300'
  }

  if (activity.state === 'awaiting-input') {
    return 'text-amber-400'
  }

  return 'text-emerald-300'
}

export function resolveWorkspaceActivityDotClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
): string {
  if (!activity) {
    return 'bg-muted-foreground/35'
  }

  if (activity.state === 'pending-approval') {
    return 'bg-amber-400'
  }

  if (activity.state === 'error') {
    return 'bg-red-400'
  }

  if (activity.state === 'working') {
    return 'bg-sky-400'
  }

  if (activity.state === 'connecting') {
    return 'bg-sky-300'
  }

  if (activity.state === 'awaiting-input') {
    return 'bg-amber-400'
  }

  return 'bg-emerald-300'
}

export function shouldPulseWorkspaceActivity(
  activity: WorkspaceActivitySnapshot | null | undefined,
): boolean {
  return activity?.state === 'working' || activity?.state === 'connecting'
}

export function resolveAggregateWorkspaceActivity(
  activities: readonly WorkspaceActivitySnapshot[],
): WorkspaceActivitySnapshot | null {
  if (activities.length === 0) {
    return null
  }

  return [...activities].sort(compareWorkspaceActivityPriority)[0] ?? null
}

export function resolveWorkspaceActivityList(
  activities: readonly WorkspaceActivitySnapshot[],
): WorkspaceActivitySnapshot[] {
  return [...activities].sort(compareWorkspaceActivityPriority)
}

export type WorkspaceAttentionTier = 'attention' | 'active' | 'idle'

const ATTENTION_TIER_SORT_ORDER: Record<WorkspaceAttentionTier, number> = {
  attention: 0,
  active: 1,
  idle: 2,
}

export function compareWorkspacesByAttentionTier(
  aActivity: WorkspaceActivitySnapshot | null | undefined,
  aUpdatedAt: string,
  bActivity: WorkspaceActivitySnapshot | null | undefined,
  bUpdatedAt: string,
): number {
  const tierA =
    ATTENTION_TIER_SORT_ORDER[resolveWorkspaceAttentionTier(aActivity)]
  const tierB =
    ATTENTION_TIER_SORT_ORDER[resolveWorkspaceAttentionTier(bActivity)]

  if (tierA !== tierB) return tierA - tierB

  return new Date(bUpdatedAt).getTime() - new Date(aUpdatedAt).getTime()
}

export function resolveWorkspaceAttentionTier(
  activity: WorkspaceActivitySnapshot | null | undefined,
): WorkspaceAttentionTier {
  if (!activity) {
    return 'idle'
  }

  if (
    activity.state === 'error' ||
    activity.state === 'pending-approval' ||
    activity.state === 'awaiting-input'
  ) {
    return 'attention'
  }

  if (
    activity.state === 'working' ||
    activity.state === 'connecting' ||
    activity.state === 'terminal-running'
  ) {
    return 'active'
  }

  return 'idle'
}

const SHORT_STATE_LABELS: Record<WorkspaceActivityState, string> = {
  'awaiting-input': 'Input',
  completed: 'Done',
  connecting: 'Connecting',
  error: 'Error',
  'pending-approval': 'Approval',
  'terminal-running': 'Running',
  working: 'Working',
}

export function formatWorkspaceActivityPillLabel(
  activity: WorkspaceActivitySnapshot,
): string {
  if (activity.provider === 'terminal') {
    return SHORT_STATE_LABELS[activity.state]
  }

  return `Agent ${SHORT_STATE_LABELS[activity.state]}`
}

export function resolveWorkspaceActivityPillClassName(
  activity: WorkspaceActivitySnapshot,
): string {
  if (activity.state === 'error') {
    return 'border-red-400/30 bg-red-400/[0.12] text-red-400'
  }

  if (activity.state === 'pending-approval') {
    return 'border-amber-400/30 bg-amber-400/[0.12] text-amber-400'
  }

  if (activity.state === 'awaiting-input') {
    return 'border-amber-400/30 bg-amber-400/[0.12] text-amber-400'
  }

  if (activity.state === 'working') {
    return 'border-sky-400/30 bg-sky-400/[0.12] text-sky-400'
  }

  if (activity.state === 'connecting') {
    return 'border-sky-300/30 bg-sky-300/[0.12] text-sky-300'
  }

  return 'border-emerald-300/30 bg-emerald-300/[0.12] text-emerald-300'
}

export function resolveWorkspaceActivityBorderColorClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
): string {
  if (!activity) {
    return 'border-l-transparent'
  }

  if (activity.state === 'error') {
    return 'border-l-red-400'
  }

  if (activity.state === 'pending-approval') {
    return 'border-l-amber-400'
  }

  if (activity.state === 'awaiting-input') {
    return 'border-l-amber-400'
  }

  if (activity.state === 'working') {
    return 'border-l-sky-400'
  }

  if (activity.state === 'connecting') {
    return 'border-l-sky-300'
  }

  return 'border-l-emerald-300'
}
