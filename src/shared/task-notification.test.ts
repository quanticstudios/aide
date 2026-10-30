import { describe, expect, it } from 'vitest'

import type { ManagedSessionSnapshot } from './managed-session'
import { buildTaskNotification } from './task-notification'

function snapshot(
  overrides: Partial<ManagedSessionSnapshot> = {},
): ManagedSessionSnapshot {
  return {
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
    paneId: 'agent:one',
    provider: 'claude',
    model: null,
    effort: null,
    interactionMode: 'build',
    detail: null,
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    content: [],
    turns: [],
    pendingApprovals: [],
    pendingUserInputs: [],
    permissionMode: 'default',
    planApproval: null,
    revision: 1,
    runtimeGeneration: 1,
    running: false,
    selectionNotice: null,
    serviceTier: null,
    sessionState: 'ready',
    updatedAt: '2026-10-30T10:00:00.000Z',
    ...overrides,
  }
}

const body = (overrides: Partial<ManagedSessionSnapshot>) =>
  buildTaskNotification(snapshot(overrides), 'Fix checkout')?.body

describe('buildTaskNotification', () => {
  it('titles the notification with the thread name and keeps the session', () => {
    expect(
      buildTaskNotification(
        snapshot({ lastCompletedAt: '2026-10-30T10:00:00.000Z' }),
        'Fix checkout',
      ),
    ).toEqual({
      sessionId: 'session-1',
      paneId: 'agent:one',
      kind: 'completed',
      title: 'Fix checkout',
      body: 'Done',
    })
  })

  it('names the tool waiting for approval', () => {
    expect(
      body({
        pendingApprovals: [
          {
            id: 'a',
            detail: 'Run bun test',
            requestType: 'command-execution-approval',
            request: { toolName: 'Bash', command: 'bun test' },
          },
        ],
      }),
    ).toBe('Approval needed: Bash')
    expect(
      body({
        pendingApprovals: [
          { id: 'a', detail: null, requestType: 'file-change-approval' },
        ],
      }),
    ).toBe('Approval needed')
  })

  it('says a plan is ready when only the plan waits for approval', () => {
    const notification = buildTaskNotification(
      snapshot({ planApproval: { id: 'plan', detail: null } }),
      'Fix checkout',
    )
    expect(notification?.kind).toBe('plan')
    expect(notification?.body).toBe('Plan ready')
  })

  it('quotes the question waiting for input', () => {
    expect(
      body({
        pendingUserInputs: [
          {
            id: 'input',
            detail: null,
            questions: [
              { id: 'q', prompt: 'Which database?', options: [] },
              { id: 'q2', prompt: 'Second?', options: [] },
            ],
          },
        ],
      }),
    ).toBe('Input needed: Which database?')
  })

  it('shows only the first line of a failure', () => {
    expect(
      body({
        sessionState: 'error',
        lastError: '  Process exited with code 1\n    at stack frame',
      }),
    ).toBe('Failed: Process exited with code 1')
    expect(body({ sessionState: 'error' })).toBe('Failed')
  })

  it('reads the reset time out of usage limit errors', () => {
    expect(
      body({
        sessionState: 'error',
        lastError: "You've hit your limit · resets 3pm (Europe/Belgrade)",
      }),
    ).toBe('Usage limit: resets 3pm (Europe/Belgrade)')
    expect(
      body({
        sessionState: 'error',
        lastError:
          "You've hit your usage limit. Upgrade to Pro or try again at 3:15 PM.",
      }),
    ).toBe('Usage limit: resets at 3:15 PM')
    const reset = new Date(1_761_850_800_000).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(
      body({
        sessionState: 'error',
        lastError: 'Claude AI usage limit reached|1761850800',
      }),
    ).toBe(`Usage limit: resets at ${reset}`)
    const notification = buildTaskNotification(
      snapshot({ sessionState: 'error', lastError: 'Usage limit hit.' }),
      'Fix checkout',
    )
    expect(notification?.kind).toBe('usage-limit')
    expect(notification?.body).toBe('Usage limit reached')
  })

  it('reports interruptions and stays quiet while running or idle', () => {
    expect(
      body({
        turns: [
          {
            id: 't',
            provider: 'claude',
            state: 'interrupted',
            startedAt: '2026-10-30T10:00:00.000Z',
            completedAt: '2026-10-30T10:01:00.000Z',
          },
        ],
      }),
    ).toBe('Interrupted')
    expect(body({ sessionState: 'running' })).toBeUndefined()
    expect(body({})).toBeUndefined()
  })
})
