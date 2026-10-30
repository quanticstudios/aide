import { describe, expect, it } from 'vitest'
import { formatThinkingDuration } from './format-thinking-duration'

describe('formatThinkingDuration', () => {
  it.each([
    [0, '<1s'],
    [499, '<1s'],
    [NaN, '<1s'],
    [2_900, '3s'],
    [59_400, '59s'],
    [65_000, '1m 5s'],
    [3_600_000, '60m 0s'],
  ])('formats %d ms as %s', (milliseconds, expected) => {
    expect(formatThinkingDuration(milliseconds)).toBe(expected)
  })
})
