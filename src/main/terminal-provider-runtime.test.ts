import { describe, expect, it } from 'vitest'

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
