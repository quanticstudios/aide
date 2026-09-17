import { describe, expect, it } from 'vitest'

import { type ManagedUsageReport, summarizeManagedUsage } from './managed-usage'

function createUsageReport(
  overrides: Partial<ManagedUsageReport> = {},
): ManagedUsageReport {
  return {
    id: 'result-1',
    scopeId: 'query-1',
    provider: 'claude',
    runtimeGeneration: 1,
    turnId: 'turn-1',
    createdAt: '2026-09-17T12:00:00.000Z',
    estimatedCostUsd: 0.1,
    models: [
      {
        model: 'claude-test',
        inputTokens: 100,
        outputTokens: 20,
        cachedInputTokens: 50,
        cacheCreationInputTokens: 25,
        estimatedCostUsd: 0.1,
      },
    ],
    ...overrides,
  }
}

describe('summarizeManagedUsage', () => {
  it('counts running query totals once and retains query resets and provider switches', () => {
    const first = createUsageReport()
    const second = createUsageReport({
      id: 'result-2',
      turnId: 'turn-2',
      estimatedCostUsd: 0.3,
      models: [{ ...first.models[0], inputTokens: 250, estimatedCostUsd: 0.3 }],
    })
    const reset = createUsageReport({ id: 'result-3', scopeId: 'query-2' })
    const switched = createUsageReport({ id: 'result-4', runtimeGeneration: 2 })

    expect(
      summarizeManagedUsage([first, second, reset, switched]),
    ).toMatchObject({
      inputTokens: 450,
      outputTokens: 60,
      cachedInputTokens: 150,
      cacheCreationInputTokens: 75,
      estimatedCostUsd: 0.5,
      isCostComplete: true,
    })
  })

  it('retains observed usage when a process failure reports zeroed counters', () => {
    const first = createUsageReport()
    const failed = createUsageReport({
      id: 'failed',
      models: [],
      estimatedCostUsd: 0,
    })
    expect(summarizeManagedUsage([first, failed, first])).toMatchObject({
      inputTokens: 100,
      estimatedCostUsd: 0.1,
    })
  })

  it('keeps unknown provider cost separate from a zero-dollar estimate', () => {
    const codex = createUsageReport({
      provider: 'codex',
      estimatedCostUsd: null,
      models: [
        {
          ...createUsageReport().models[0],
          model: 'codex-test',
          estimatedCostUsd: null,
        },
      ],
    })
    const summary = summarizeManagedUsage([createUsageReport(), codex])
    expect(summary.estimatedCostUsd).toBe(0.1)
    expect(summary.isCostComplete).toBe(false)
    expect(summary.models.map((entry) => entry.model)).toEqual([
      'claude-test',
      'codex-test',
    ])
  })
})
