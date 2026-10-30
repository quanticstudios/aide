import { describe, expect, it } from 'vitest'

import { mapClaudeRateLimit, mapCodexRateLimits } from './provider-limits'

// 2026-10-23T15:00:00Z and 2026-10-27T09:00:00Z in unix seconds.
const AT_15 = 1_792_767_600
const MONDAY = 1_793_091_600

describe('mapClaudeRateLimit', () => {
  it('maps a rejected rate_limit_event to the limit and its reset', () => {
    expect(
      mapClaudeRateLimit({
        rateLimitType: 'five_hour',
        resetsAt: AT_15,
        status: 'rejected',
      }),
    ).toEqual({
      label: '5-hour limit',
      limitId: 'five_hour',
      provider: 'claude',
      resetsAt: '2026-10-23T15:00:00.000Z',
    })
  })

  it('names weekly and model limits, and keeps an unknown reset as null', () => {
    expect(
      mapClaudeRateLimit({
        rateLimitType: 'seven_day_opus',
        status: 'rejected',
      }),
    ).toMatchObject({ label: 'Weekly Opus limit', resetsAt: null })
    expect(mapClaudeRateLimit({ status: 'rejected' })).toMatchObject({
      label: 'Usage limit',
      limitId: 'usage',
    })
  })

  it('clears the limit once usage is allowed again, warnings included', () => {
    expect(mapClaudeRateLimit({ resetsAt: AT_15, status: 'allowed' })).toBe(
      null,
    )
    expect(
      mapClaudeRateLimit({ resetsAt: AT_15, status: 'allowed_warning' }),
    ).toBe(null)
  })
})

describe('mapCodexRateLimits', () => {
  const primary = { resetsAt: AT_15, usedPercent: 40, windowDurationMins: 300 }
  const secondary = {
    resetsAt: MONDAY,
    usedPercent: 70,
    windowDurationMins: 10_080,
  }

  it('returns null while every window has room', () => {
    expect(mapCodexRateLimits({ limitId: 'codex', primary, secondary })).toBe(
      null,
    )
    expect(mapCodexRateLimits(null)).toBe(null)
  })

  it('maps a full window to its label and reset', () => {
    expect(
      mapCodexRateLimits({
        limitId: 'codex',
        primary: { ...primary, usedPercent: 100 },
        secondary,
      }),
    ).toEqual({
      label: '5-hour limit',
      limitId: 'codex',
      provider: 'codex',
      resetsAt: '2026-10-23T15:00:00.000Z',
    })
  })

  it('waits for the later reset when both windows are full', () => {
    expect(
      mapCodexRateLimits({
        primary: { ...primary, usedPercent: 100 },
        secondary: { ...secondary, usedPercent: 100 },
      }),
    ).toMatchObject({
      label: 'Weekly limit',
      resetsAt: '2026-10-27T09:00:00.000Z',
    })
  })

  it('trusts rateLimitReachedType and a usageLimitExceeded error over the percentages', () => {
    expect(
      mapCodexRateLimits({
        primary,
        rateLimitReachedType: 'rate_limit_reached',
      }),
    ).toMatchObject({
      label: '5-hour limit',
      resetsAt: '2026-10-23T15:00:00.000Z',
    })
    expect(mapCodexRateLimits({ primary }, true)).toMatchObject({
      label: '5-hour limit',
    })
    expect(mapCodexRateLimits(null, true)).toEqual({
      label: 'Usage limit',
      limitId: 'codex',
      provider: 'codex',
      resetsAt: null,
    })
  })
})
