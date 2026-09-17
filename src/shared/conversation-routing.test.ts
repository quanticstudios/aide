import { describe, expect, it } from 'vitest'

import {
  extractExplicitRecipientAliases,
  getNextRecipientSuggestionIndex,
  getRecipientMentionQuery,
  getRecipientSuggestions,
  removeRecipientMention,
} from './conversation-routing'

describe('conversation routing', () => {
  it('offers a prefix alias while the composer contains only that mention', () => {
    expect(getRecipientMentionQuery('@Cod')).toBe('Cod')
    expect(getRecipientMentionQuery('@Codex review this')).toBeNull()
    expect(getRecipientMentionQuery('review @Codex')).toBeNull()
  })

  it('filters configured agents by the alias prefix', () => {
    expect(
      getRecipientSuggestions('co', [
        { alias: 'Claude', selection: { mode: 'claude' } },
        { alias: 'Codex', selection: { mode: 'codex' } },
      ]),
    ).toEqual([{ alias: 'Codex', selection: { mode: 'codex' } }])
  })

  it('wraps recipient keyboard navigation', () => {
    expect(getNextRecipientSuggestionIndex(1, 2, 'ArrowDown')).toBe(0)
    expect(getNextRecipientSuggestionIndex(0, 2, 'ArrowUp')).toBe(1)
    expect(getNextRecipientSuggestionIndex(0, 0, 'ArrowDown')).toBeNull()
  })

  it('removes a selected mention and preserves the remaining draft', () => {
    expect(removeRecipientMention('@Codex review this')).toEqual({
      draft: 'review this',
      query: 'Codex',
    })
  })

  it('extracts known prefix aliases without treating ordinary @ text as a recipient', () => {
    expect(
      extractExplicitRecipientAliases('@Claude @Codex compare these', [
        'claude',
        'codex',
      ]),
    ).toEqual({ aliases: ['claude', 'codex'], text: 'compare these' })
    expect(
      extractExplicitRecipientAliases('ask @Codex about this', ['codex']),
    ).toEqual({ aliases: [], text: 'ask @Codex about this' })
    expect(
      extractExplicitRecipientAliases('@person@example.com', ['person']),
    ).toEqual({ aliases: [], text: '@person@example.com' })
    expect(
      extractExplicitRecipientAliases('```\n@Codex\n```', ['codex']),
    ).toEqual({ aliases: [], text: '```\n@Codex\n```' })
  })

  it('reports an unknown prefix recipient without changing the draft', () => {
    expect(
      extractExplicitRecipientAliases('@Ada review this', ['codex']),
    ).toEqual({
      aliases: [],
      error: 'Unknown agent @Ada.',
      text: '@Ada review this',
    })
  })
})
