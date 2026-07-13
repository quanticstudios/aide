import { describe, expect, it } from 'vitest'

import { formatRelativeTime } from './relative-time'

describe('formatRelativeTime', () => {
  it('returns "just now" for timestamps less than 5 seconds ago', () => {
    const now = new Date().toISOString()

    expect(formatRelativeTime(now)).toBe('just now')
  })

  it('returns "just now" for future timestamps', () => {
    const future = new Date(Date.now() + 60_000).toISOString()

    expect(formatRelativeTime(future)).toBe('just now')
  })

  it('returns seconds for timestamps under 60 seconds ago', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-03T12:00:30Z').getTime(),
      ),
    ).toBe('30s ago')
  })

  it('returns minutes for timestamps under 60 minutes ago', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-03T12:05:00Z').getTime(),
      ),
    ).toBe('5m ago')
  })

  it('returns hours for timestamps under 24 hours ago', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-03T15:00:00Z').getTime(),
      ),
    ).toBe('3h ago')
  })

  it('returns days for timestamps 24+ hours ago', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-06T12:00:00Z').getTime(),
      ),
    ).toBe('3d ago')
  })

  it('handles boundary at exactly 60 seconds', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-03T12:01:00Z').getTime(),
      ),
    ).toBe('1m ago')
  })

  it('handles boundary at exactly 60 minutes', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-03T13:00:00Z').getTime(),
      ),
    ).toBe('1h ago')
  })

  it('handles boundary at exactly 24 hours', () => {
    expect(
      formatRelativeTime(
        '2026-04-03T12:00:00Z',
        new Date('2026-04-04T12:00:00Z').getTime(),
      ),
    ).toBe('1d ago')
  })
})
