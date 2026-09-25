import type { ManagedSessionSnapshot } from './managed-session'

export interface TaskMetadata {
  title: string | null
  pinned: boolean
  archived: boolean
  readActivityKey: string | null
}

export interface TaskMetadataUpdate {
  title?: string
  pinned?: boolean
  archived?: boolean
  readActivityKey?: string | null
}

export interface SavedTask extends TaskMetadata {
  sessionId: string
  paneId: string
  workspaceId: string
  projectName: string
  workspaceName: string
  branchName: string
  title: string
  updatedAt: string
  provider: string
  status:
    | 'approval'
    | 'input'
    | 'failed'
    | 'interrupted'
    | 'running'
    | 'completed'
    | 'idle'
  activityKey: string | null
  unread: boolean
  excerpt: string
}

export interface TaskLibrarySnapshot {
  tasks: SavedTask[]
  notificationsEnabled: boolean
}

export function getTaskActivity(snapshot: ManagedSessionSnapshot): {
  status: SavedTask['status']
  activityKey: string | null
} {
  const generation = snapshot.runtimeGeneration
  if (snapshot.pendingApprovals.length || snapshot.planApproval) {
    const ids = [
      ...snapshot.pendingApprovals.map((request) => request.id),
      snapshot.planApproval?.id,
    ]
      .filter(Boolean)
      .sort()
    return {
      status: 'approval',
      activityKey: `approval:${generation}:${ids.join(',')}`,
    }
  }
  if (snapshot.pendingUserInputs.length) {
    return {
      status: 'input',
      activityKey: `input:${generation}:${snapshot.pendingUserInputs
        .map((request) => request.id)
        .sort()
        .join(',')}`,
    }
  }
  if (
    snapshot.sessionState === 'connecting' ||
    snapshot.sessionState === 'running' ||
    snapshot.turns.some((turn) => turn.state === 'running')
  ) {
    return { status: 'running', activityKey: null }
  }
  const lastTurn = snapshot.turns.at(-1)
  if (snapshot.sessionState === 'error' || lastTurn?.state === 'failed') {
    return {
      status: 'failed',
      activityKey: `failed:${snapshot.lastErrorAt ?? lastTurn?.id ?? snapshot.updatedAt}`,
    }
  }
  if (lastTurn?.state === 'interrupted') {
    return {
      status: 'interrupted',
      activityKey: `interrupted:${lastTurn.id}`,
    }
  }
  if (snapshot.lastCompletedAt) {
    return {
      status: 'completed',
      activityKey: `completed:${snapshot.lastCompletedAt}`,
    }
  }
  return { status: 'idle', activityKey: null }
}

export function taskSearchText(snapshot: ManagedSessionSnapshot): string {
  return snapshot.content
    .filter(
      (item) => item.kind === 'user-prompt' || item.kind === 'assistant-text',
    )
    .map((item) => item.text)
    .join('\n')
}
