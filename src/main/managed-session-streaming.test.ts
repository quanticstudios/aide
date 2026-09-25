import { afterEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({ query }))

import { ManagedSessionManager } from './managed-session-manager'

function createStreamingQuery(prompt: AsyncIterable<unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        model: 'claude-test',
        subtype: 'init',
        type: 'system',
        uuid: 'init-event',
      }
      await prompt[Symbol.asyncIterator]().next()
      yield {
        event: {
          message: { id: 'native-message', model: 'claude-test' },
          type: 'message_start',
        },
        parent_tool_use_id: null,
        session_id: 'session',
        type: 'stream_event',
        uuid: 'stream-start-event',
      }
      yield {
        event: {
          delta: { text: 'OK', type: 'text_delta' },
          type: 'content_block_delta',
        },
        parent_tool_use_id: null,
        session_id: 'session',
        type: 'stream_event',
        uuid: 'stream-delta-event',
      }
      yield {
        message: {
          id: 'native-message',
          content: [{ text: 'OK', type: 'text' }],
          model: 'claude-test',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        parent_tool_use_id: null,
        session_id: 'session',
        type: 'assistant',
        uuid: 'assistant-event',
      }
      yield {
        modelUsage: {
          'claude-test': {
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            contextWindow: 200_000,
            costUSD: 0,
            inputTokens: 1,
            outputTokens: 1,
          },
        },
        session_id: 'session',
        subtype: 'success',
        total_cost_usd: 0,
        type: 'result',
        uuid: 'result-event',
      }
    },
    close: vi.fn(),
    interrupt: vi.fn(),
  }
}

async function waitForCompletedTurn(
  manager: ManagedSessionManager,
  runtimeEvents: Array<{ type: string }>,
) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const snapshot = manager.getSnapshots().session
    if (snapshot?.turns.some((turn) => turn.state === 'completed')) {
      return snapshot
    }
    if (snapshot?.sessionState === 'error') {
      throw new Error(snapshot.lastError ?? 'Claude session failed.')
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error(
    `Claude turn did not complete after ${query.mock.calls.length} query calls: ${runtimeEvents.map((event) => event.type).join(', ')}.`,
  )
}

describe('ManagedSessionManager Claude streaming', () => {
  afterEach(() => {
    query.mockReset()
  })

  it('uses the native assistant message id to merge partial and complete text', async () => {
    query.mockImplementation(({ prompt }) => createStreamingQuery(prompt))
    const runtimeEvents: Array<{ type: string }> = []
    const manager = new ManagedSessionManager({
      onRuntimeEvent: (_meta, event) => runtimeEvents.push(event),
      onUpdate: () => undefined,
    })
    await manager.createSession({
      cwd: '/tmp/workspace',
      mode: 'claude',
      paneId: 'pane',
      readOnly: true,
      sessionId: 'session',
      workspaceId: 'workspace',
    })

    await manager.sendInput('session', 'Reply OK.')
    const snapshot = await waitForCompletedTurn(manager, runtimeEvents)
    const assistantMessages = snapshot.content.filter(
      (item) => item.kind === 'assistant-text',
    )

    expect(assistantMessages).toEqual([
      expect.objectContaining({
        model: 'claude-test',
        provider: 'claude',
        text: 'OK',
      }),
    ])

    await manager.closeAll()
  })

  it('hands a mid-turn message to the CLI and tracks the turn it queues', async () => {
    const prompts: unknown[] = []
    const result = (uuid: string, queuedTurnCount: number) => ({
      modelUsage: {},
      queued_turn_count: queuedTurnCount,
      session_id: 'session',
      subtype: 'success',
      total_cost_usd: 0,
      type: 'result',
      uuid,
    })
    query.mockImplementation(({ prompt }) => ({
      async *[Symbol.asyncIterator]() {
        const incoming = prompt[Symbol.asyncIterator]()
        prompts.push((await incoming.next()).value)
        prompts.push((await incoming.next()).value)
        yield result('first-result', 1)
        yield result('second-result', 0)
      },
      close: vi.fn(),
      interrupt: vi.fn(),
    }))
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    await manager.createSession({
      cwd: '/tmp/workspace',
      mode: 'claude',
      paneId: 'pane',
      readOnly: true,
      sessionId: 'session',
      workspaceId: 'workspace',
    })

    await manager.sendInput('session', 'first')
    await manager.sendInput('session', 'second')
    await vi.waitFor(() =>
      expect(manager.getSnapshots().session?.turns).toEqual([
        expect.objectContaining({ state: 'completed' }),
        expect.objectContaining({ state: 'completed' }),
      ]),
    )
    expect(JSON.stringify(prompts[1])).toContain('second')
    expect(
      manager
        .getSnapshots()
        .session?.content.filter((item) => item.kind === 'user-prompt')
        .map((item) => item.text),
    ).toEqual(['first', 'second'])

    await manager.closeAll()
  })
})
