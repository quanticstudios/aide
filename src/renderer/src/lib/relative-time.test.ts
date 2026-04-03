import { describe, expect, it, vi } from 'vitest'

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
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:00:30Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('30s ago')

    vi.useRealTimers()
  })

  it('returns minutes for timestamps under 60 minutes ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:05:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('5m ago')

    vi.useRealTimers()
  })

  it('returns hours for timestamps under 24 hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T15:00:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('3h ago')

    vi.useRealTimers()
  })

  it('returns days for timestamps 24+ hours ago', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-06T12:00:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('3d ago')

    vi.useRealTimers()
  })

  it('handles boundary at exactly 60 seconds', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T12:01:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('1m ago')

    vi.useRealTimers()
  })

  it('handles boundary at exactly 60 minutes', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-03T13:00:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('1h ago')

    vi.useRealTimers()
  })

  it('handles boundary at exactly 24 hours', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-04-04T12:00:00Z'))

    expect(formatRelativeTime('2026-04-03T12:00:00Z')).toBe('1d ago')

    vi.useRealTimers()
  })
})
