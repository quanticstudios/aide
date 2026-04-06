export type WorkspaceActivityProvider =
  | 'claude'
  | 'codex'
  | 'terminal'
  | 'unknown'

export type WorkspaceActivityState =
  | 'attention'
  | 'awaiting-input'
  | 'error'
  | 'ready'
  | 'working'

export interface WorkspaceActivitySnapshot {
  detail: string | null
  provider: WorkspaceActivityProvider
  state: WorkspaceActivityState
  updatedAt: string
  workspaceId: string
}

export interface WorkspaceActivityEvent {
  activity: WorkspaceActivitySnapshot | null
  workspaceId: string
}

const STATE_PRIORITY: Record<WorkspaceActivityState, number> = {
  attention: 5,
  error: 4,
  working: 3,
  'awaiting-input': 2,
  ready: 1,
}

const PROVIDER_LABELS: Record<WorkspaceActivityProvider, string> = {
  claude: 'Claude',
  codex: 'Codex',
  terminal: 'Terminal',
  unknown: 'Workspace',
}

const STATE_LABELS: Record<WorkspaceActivityState, string> = {
  attention: 'needs attention',
  'awaiting-input': 'awaiting input',
  error: 'errored',
  ready: 'ready',
  working: 'working',
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
  return `${PROVIDER_LABELS[activity.provider]} ${STATE_LABELS[activity.state]}`
}

export function resolveWorkspaceActivityAccentClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
): string {
  if (!activity) {
    return 'text-muted-foreground/70'
  }

  if (activity.state === 'attention') {
    return 'text-amber-400'
  }

  if (activity.state === 'error') {
    return 'text-red-400'
  }

  if (activity.state === 'working') {
    return 'text-sky-400'
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

  if (activity.state === 'attention') {
    return 'bg-amber-400'
  }

  if (activity.state === 'error') {
    return 'bg-red-400'
  }

  if (activity.state === 'working') {
    return 'bg-sky-400'
  }

  if (activity.state === 'awaiting-input') {
    return 'bg-indigo-300'
  }

  return 'bg-emerald-300'
}

export function shouldPulseWorkspaceActivity(
  activity: WorkspaceActivitySnapshot | null | undefined,
): boolean {
  return activity?.state === 'working'
}

export function resolveAggregateWorkspaceActivity(
  activities: readonly WorkspaceActivitySnapshot[],
): WorkspaceActivitySnapshot | null {
  if (activities.length === 0) {
    return null
  }

  return [...activities].sort(compareWorkspaceActivityPriority)[0] ?? null
}
