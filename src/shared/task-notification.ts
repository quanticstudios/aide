import type { ManagedSessionSnapshot } from './managed-session'
import { getTaskActivity } from './task-library'

export type TaskNotificationKind =
  | 'approval'
  | 'input'
  | 'plan'
  | 'failed'
  | 'usage-limit'
  | 'interrupted'
  | 'completed'

export interface TaskNotification {
  sessionId: string
  paneId: string
  kind: TaskNotificationKind
  title: string
  body: string
}

/** Sent to the renderer: `toast` when the window is focused, `sound` when notification sounds are on. */
export interface TaskNotificationEvent extends TaskNotification {
  toast: boolean
  sound: boolean
}

/** What a finished or blocked thread needs from you, named by the thread. */
export function buildTaskNotification(
  snapshot: ManagedSessionSnapshot,
  threadName: string,
): TaskNotification | null {
  const message = (kind: TaskNotificationKind, body: string) => ({
    sessionId: snapshot.sessionId,
    paneId: snapshot.paneId,
    kind,
    title: threadName,
    body,
  })
  switch (getTaskActivity(snapshot).status) {
    case 'approval': {
      const approval = snapshot.pendingApprovals[0]
      if (!approval) return message('plan', 'Plan ready')
      const tool = approval.request?.toolName ?? approval.detail
      return message(
        'approval',
        tool ? `Approval needed: ${tool}` : 'Approval needed',
      )
    }
    case 'input': {
      const request = snapshot.pendingUserInputs[0]
      const question = request?.questions[0]?.prompt ?? request?.detail
      return message(
        'input',
        question ? `Input needed: ${question}` : 'Input needed',
      )
    }
    case 'failed': {
      const error = snapshot.lastError?.trim() ?? ''
      // shortcut: providers report usage limits only as error text, match on it until they send a structured event.
      if (/usage limit|hit your (?:usage )?limit|\d+-hour limit/i.test(error)) {
        const reset = usageLimitReset(error)
        return message(
          'usage-limit',
          reset ? `Usage limit: resets ${reset}` : 'Usage limit reached',
        )
      }
      const firstLine = error.split('\n')[0]?.trim()
      return message('failed', firstLine ? `Failed: ${firstLine}` : 'Failed')
    }
    case 'interrupted':
      return message('interrupted', 'Interrupted')
    case 'completed':
      return message('completed', 'Done')
    default:
      return null
  }
}

function usageLimitReset(error: string): string | null {
  const epoch = /\|(\d{10})\b/.exec(error)?.[1]
  if (epoch)
    return `at ${new Date(Number(epoch) * 1_000).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })}`
  const match =
    /resets? ((?:at |in )?[^.·\n]+)/i.exec(error) ??
    /try again ((?:at|in) [^.\n]+)/i.exec(error)
  return match?.[1]?.trim() ?? null
}
