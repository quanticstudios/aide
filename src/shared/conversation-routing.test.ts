import { describe, expect, it } from 'vitest'

import { getNextRecipientSuggestionIndex } from './conversation-routing'

describe('mention menu navigation', () => {
  it('wraps recipient keyboard navigation', () => {
    expect(getNextRecipientSuggestionIndex(1, 2, 'ArrowDown')).toBe(0)
    expect(getNextRecipientSuggestionIndex(0, 2, 'ArrowUp')).toBe(1)
    expect(getNextRecipientSuggestionIndex(0, 0, 'ArrowDown')).toBeNull()
  })
})
