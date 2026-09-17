import { describe, expect, it } from 'vitest'
import { parseCodexUsage } from './codex-usage'

describe('parseCodexUsage', () => {
  const counters = {
    inputTokens: 100,
    cachedInputTokens: 40,
    cacheWriteInputTokens: 10,
    outputTokens: 20,
    totalTokens: 120,
    reasoningOutputTokens: 5,
  }
  const notification = {
    threadId: 'native-thread',
    turnId: 'turn-1',
    tokenUsage: {
      total: counters,
      last: { ...counters, totalTokens: 60 },
      modelContextWindow: 200000,
    },
  }

  it('separates total fresh input from cache reads and current context', () => {
    expect(parseCodexUsage(notification, 'actual-model', 'now')).toMatchObject({
      contextTokens: 60,
      maxTokens: 200000,
      report: {
        scopeId: 'native-thread',
        estimatedCostUsd: null,
        models: [
          {
            model: 'actual-model',
            inputTokens: 50,
            cachedInputTokens: 40,
            cacheCreationInputTokens: 10,
            outputTokens: 20,
            estimatedCostUsd: null,
          },
        ],
      },
    })
  })

  it('rejects malformed or impossible provider counters', () => {
    expect(
      parseCodexUsage(
        {
          ...notification,
          tokenUsage: {
            ...notification.tokenUsage,
            total: { ...counters, inputTokens: -1 },
          },
        },
        null,
        'now',
      ),
    ).toBeNull()
    expect(
      parseCodexUsage(
        {
          ...notification,
          tokenUsage: {
            ...notification.tokenUsage,
            total: { ...counters, cachedInputTokens: 101 },
          },
        },
        null,
        'now',
      ),
    ).toBeNull()
    expect(parseCodexUsage({}, null, 'now')).toBeNull()
  })
})
