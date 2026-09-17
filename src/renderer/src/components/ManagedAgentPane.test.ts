import { describe, expect, it } from 'vitest'

import { groupContentByTurn } from '../lib/managed-session-grouping'

describe('groupContentByTurn', () => {
  it('keeps interleaved child content in its first turn group', () => {
    const groups = groupContentByTurn([
      {
        id: 'one-a',
        kind: 'assistant-text',
        provider: 'claude',
        text: 'first',
        turnId: 'one',
        updatedAt: '2026-09-17T00:00:00.000Z',
      },
      {
        id: 'two-a',
        kind: 'assistant-text',
        provider: 'codex',
        text: 'second',
        turnId: 'two',
        updatedAt: '2026-09-17T00:00:01.000Z',
      },
      {
        id: 'one-b',
        kind: 'assistant-text',
        provider: 'claude',
        text: 'third',
        turnId: 'one',
        updatedAt: '2026-09-17T00:00:02.000Z',
      },
    ])

    expect(groups.map((group) => group.turnId)).toEqual(['one', 'two'])
    expect(groups[0]?.items.map((item) => item.id)).toEqual(['one-a', 'one-b'])
  })
})
