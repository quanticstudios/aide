import { describe, expect, it } from 'vitest'

import {
  formatCost,
  formatSpan,
  formatTokens,
  limitTitle,
  resetNote,
  usedNow,
  windowTitle,
} from './plan-usage'

const limit = {
  name: '',
  profile: '',
  profileLabel: '',
  provider: 'claude',
  seen: '2026-10-31T09:00:00Z',
  windows: [],
}

describe('plan usage formatting, as pitwall Settings > Usage', () => {
  it('names limits and windows', () => {
    expect(limitTitle(limit)).toBe('Claude Code')
    expect(limitTitle({ ...limit, profile: 'work' })).toBe('Claude · work')
    expect(
      limitTitle({
        ...limit,
        name: 'GPT-Spark',
        profile: 'work',
        profileLabel: 'Work',
        provider: 'codex',
      }),
    ).toBe('Codex · Work GPT-Spark')
    expect(windowTitle(300)).toBe('5-hour window')
    expect(windowTitle(10_080)).toBe('Weekly window')
    expect(windowTitle(2880)).toBe('2-day window')
    expect(windowTitle(45)).toBe('45-minute window')
  })

  it('counts a window whose reset passed as unused', () => {
    const now = Date.parse('2026-10-31T10:00:00Z')
    const window = { minutes: 300, used: 80, resets: '2026-10-31T09:59:00Z' }
    expect(usedNow(window, now)).toBe(0)
    expect(usedNow({ ...window, resets: '2026-10-31T12:00:00Z' }, now)).toBe(80)
    expect(usedNow({ minutes: 300, used: 12 }, now)).toBe(12)
    expect(resetNote({ minutes: 300, used: 12 }, now)).toBe(
      'Its reset time is unknown.',
    )
    expect(resetNote(window, now)).toMatch(/^Reset at .*; no report since\.$/)
    expect(
      resetNote({ ...window, resets: '2026-10-31T12:14:30Z' }, now),
    ).toMatch(/^Resets in 2h 14m, at /)
  })

  it('formats spans, tokens and dollars', () => {
    expect(formatSpan(30_000)).toBe('<1m')
    expect(formatSpan(42 * 60_000)).toBe('42m')
    expect(formatSpan((3 * 24 * 60 + 4 * 60 + 5) * 60_000)).toBe('3d 4h')
    expect(formatTokens(950)).toBe('950')
    expect(formatTokens(1_650_000)).toBe('1.65M')
    expect(formatTokens(1_000_000)).toBe('1M')
    expect(formatTokens(35_800)).toBe('35.8K')
    expect(formatTokens(450_000)).toBe('450K')
    expect(formatTokens(999_600)).toBe('1M')
    expect(formatCost(1234.5)).toBe('$1,234.50')
    expect(formatCost(0.9)).toBe('$0.90')
  })
})
