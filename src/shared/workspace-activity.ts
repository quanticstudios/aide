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

const PROVIDER_LABELS: Record<WorkspaceActivityProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  terminal: 'Terminal',
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

  return `${PROVIDER_LABELS[activity.provider]} ${STATE_LABELS[activity.state]}`
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
    return 'text-indigo-300'
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
    return 'bg-indigo-300'
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
