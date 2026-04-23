import { describe, expect, it } from 'vitest'

import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import {
  ManagedTerminalProviderAdapter,
  ManagedTerminalProviderProjector,
} from './terminal-provider-runtime'

describe('ManagedTerminalProviderAdapter', () => {
  it('maps Claude task-picker prompts into canonical user-input events', () => {
    const adapter = new ManagedTerminalProviderAdapter('claude', 'claude')
    const projector = new ManagedTerminalProviderProjector('claude')

    projector.apply(
      adapter.createSessionStartEvents('2026-04-07T10:00:00.000Z'),
    )
    projector.apply(adapter.handleInput('hello\n', '2026-04-07T10:01:00.000Z'))
    projector.apply(
      adapter.handleOutput(
        [
          'Claude Code v2.1.92',
          '',
          '[ Mood ]',
          'How are you doing today?',
          '',
          '1. Great',
          '2. Good',
          '',
          'Enter to select · ↑/↓ to navigate · Esc to cancel',
        ].join('\n'),
        '2026-04-07T10:02:00.000Z',
      ),
    )

    expect(projector.getSnapshot()).toMatchObject({
      detail: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
      hasPendingApproval: false,
      hasPendingUserInput: true,
      sessionState: 'waiting',
    })
  })

  it('keeps approval state open until input resolves it', () => {
    const adapter = new ManagedTerminalProviderAdapter('codex', 'codex')
    const projector = new ManagedTerminalProviderProjector('codex')

    projector.apply(
      adapter.createSessionStartEvents('2026-04-07T10:00:00.000Z'),
    )
    projector.apply(
      adapter.handleOutput(
        'OpenAI Codex\nApproval required to continue\n› ',
        '2026-04-07T10:01:00.000Z',
      ),
    )

    expect(projector.getSnapshot()).toMatchObject({
      detail: 'Approval required to continue',
      hasPendingApproval: true,
      sessionState: 'waiting',
    })

    projector.apply(adapter.handleInput('y\n', '2026-04-07T10:02:00.000Z'))

    expect(projector.getSnapshot()).toMatchObject({
      activeTurnStartedAt: '2026-04-07T10:02:00.000Z',
      hasPendingApproval: false,
      sessionState: 'running',
    })
  })
})

describe('ManagedTerminalProviderProjector turn.completed state transitions', () => {
  const baseEvents: ManagedProviderRuntimeEvent[] = [
    {
      createdAt: '2026-04-23T10:00:00.000Z',
      provider: 'claude',
      type: 'session.started',
    },
    {
      createdAt: '2026-04-23T10:00:00.000Z',
      provider: 'claude',
      state: 'ready',
      type: 'session.state.changed',
    },
  ]

  it('stays in waiting when a failed turn completes while an approval is pending', () => {
    const projector = new ManagedTerminalProviderProjector('claude')
    projector.apply(baseEvents)
    projector.apply([
      {
        createdAt: '2026-04-23T10:01:00.000Z',
        provider: 'claude',
        turnId: 'turn-1',
        type: 'turn.started',
      },
      {
        createdAt: '2026-04-23T10:01:10.000Z',
        detail: 'Command requires approval',
        provider: 'claude',
        requestId: 'req-1',
        requestType: 'command-execution-approval',
        type: 'request.opened',
      },
      {
        createdAt: '2026-04-23T10:01:20.000Z',
        errorMessage: 'Turn failed mid-approval',
        provider: 'claude',
        state: 'failed',
        turnId: 'turn-1',
        type: 'turn.completed',
      },
    ])

    const snapshot = projector.getSnapshot()
    expect(snapshot.sessionState).toBe('waiting')
    expect(snapshot.hasPendingApproval).toBe(true)
    expect(snapshot.lastError).toBe('Turn failed mid-approval')
  })

  it('transitions to error when a failed turn completes with no pending items', () => {
    const projector = new ManagedTerminalProviderProjector('claude')
    projector.apply(baseEvents)
    projector.apply([
      {
        createdAt: '2026-04-23T10:01:00.000Z',
        provider: 'claude',
        turnId: 'turn-1',
        type: 'turn.started',
      },
      {
        createdAt: '2026-04-23T10:01:20.000Z',
        errorMessage: 'Turn crashed',
        provider: 'claude',
        state: 'failed',
        turnId: 'turn-1',
        type: 'turn.completed',
      },
    ])

    const snapshot = projector.getSnapshot()
    expect(snapshot.sessionState).toBe('error')
    expect(snapshot.lastError).toBe('Turn crashed')
  })
})
