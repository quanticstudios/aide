import { afterEach, describe, expect, it, vi } from 'vitest'

import { ManagedSessionManager } from './managed-session-manager'

const { results } = vi.hoisted(() => ({
  results: [] as Record<string, unknown>[],
}))

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@anthropic-ai/claude-agent-sdk')>()),
  query: vi.fn(({ prompt }: { prompt: AsyncIterable<unknown> }) => ({
    close: vi.fn(),
    interrupt: vi.fn(),
    async *[Symbol.asyncIterator]() {
      yield { type: 'system', subtype: 'init' }
      for await (const _message of prompt) {
        yield results.shift()
      }
    },
  })),
}))

function createResult(id: string, cost: number, subtype = 'success') {
  return {
    type: 'result',
    subtype,
    uuid: id,
    session_id: 'native-query',
    total_cost_usd: cost,
    errors: subtype === 'success' ? [] : ['Synthetic failure'],
    modelUsage: {
      'actual-claude-model': {
        inputTokens: cost * 1000,
        outputTokens: 25,
        cacheReadInputTokens: 10,
        cacheCreationInputTokens: 15,
        contextWindow: 200000,
        costUSD: cost,
      },
    },
  }
}

afterEach(() => {
  results.length = 0
  vi.unstubAllEnvs()
})

describe('managed provider accounting', () => {
  it('records failed Claude results and retains cumulative usage through a provider restart', async () => {
    vi.stubEnv('AIDE_FAKE_MANAGED_PROVIDERS', '')
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => {},
      onUpdate: () => {},
    })
    const config = {
      cwd: process.cwd(),
      sessionId: 'usage-session',
      paneId: 'pane',
      workspaceId: 'workspace',
      mode: 'claude' as const,
    }
    await manager.createSession(config)
    results.push(createResult('first', 0.1))
    await manager.sendInput(config.sessionId, 'first question')
    await vi.waitFor(() =>
      expect(
        manager.getSnapshots()[config.sessionId].usageSummary?.estimatedCostUsd,
      ).toBe(0.1),
    )
    results.push(createResult('failed', 0.3, 'error_during_execution'))
    await manager.sendInput(config.sessionId, 'second question')
    await vi.waitFor(() =>
      expect(
        manager.getSnapshots()[config.sessionId].usageReports,
      ).toHaveLength(2),
    )
    expect(manager.getSnapshots()[config.sessionId].usageSummary).toMatchObject(
      { inputTokens: 300, cacheCreationInputTokens: 15, estimatedCostUsd: 0.3 },
    )
    expect(manager.getSnapshots()[config.sessionId].turns.at(-1)?.state).toBe(
      'failed',
    )

    await manager.switchSessionProvider(config.sessionId, {
      mode: 'claude',
      model: 'another-model',
    })
    expect(
      manager.getSnapshots()[config.sessionId].usageSummary?.estimatedCostUsd,
    ).toBe(0.3)
    results.push(createResult('restarted', 0.2))
    await manager.sendInput(config.sessionId, 'third question')
    await vi.waitFor(() =>
      expect(
        manager.getSnapshots()[config.sessionId].usageSummary?.estimatedCostUsd,
      ).toBe(0.5),
    )
    expect(
      manager.getSnapshots()[config.sessionId].usageSummary?.models[0]?.model,
    ).toBe('actual-claude-model')
    await manager.closeAll()
  })
})
