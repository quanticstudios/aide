import { describe, expect, it } from 'vitest'

import { checkPerfBudget } from './perf-budget.mjs'

describe('perf budget', () => {
  it('passes at the ceiling and fails above it', () => {
    const ceilings = { 'renderer.frameP95Ms': 20, 'ipc.bytesPerSecond': 1000 }

    expect(
      checkPerfBudget(
        { ipc: { bytesPerSecond: 1000 }, renderer: { frameP95Ms: 19.5 } },
        ceilings,
      ),
    ).toEqual([])
    expect(
      checkPerfBudget(
        { ipc: { bytesPerSecond: 1001 }, renderer: { frameP95Ms: 19.5 } },
        ceilings,
      ),
    ).toEqual(['ipc.bytesPerSecond is 1001, over the 1000 ceiling.'])
  })

  it('fails when a metric is missing', () => {
    expect(
      checkPerfBudget({ renderer: {} }, { 'renderer.frameP95Ms': 20 }),
    ).toEqual(['renderer.frameP95Ms is missing from the perf result.'])
  })
})
