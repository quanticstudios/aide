import { describe, expect, it } from 'vitest'
import {
  addStashedDraft,
  appendPrompt,
  stepPromptHistory,
} from './composer-history-storage'

describe('appendPrompt', () => {
  it('skips blanks and immediate repeats and keeps the last 100', () => {
    expect(appendPrompt(['a'], ' ')).toEqual(['a'])
    expect(appendPrompt(['a'], 'a')).toEqual(['a'])
    expect(appendPrompt(['a'], 'b')).toEqual(['a', 'b'])
    const full = Array.from({ length: 100 }, (_, index) => `p${index}`)
    expect(appendPrompt(full, 'new')).toEqual([...full.slice(1), 'new'])
  })
})

describe('addStashedDraft', () => {
  it('puts the newest stash first and keeps 20', () => {
    const stash = (id: string) => ({
      createdAt: '2026-10-30T00:00:00Z',
      draft: { attachments: [], text: id },
      id,
    })
    const full = Array.from({ length: 20 }, (_, index) => stash(`s${index}`))
    const next = addStashedDraft(full, stash('new'))
    expect(next).toHaveLength(20)
    expect(next[0]?.id).toBe('new')
    expect(next.at(-1)?.id).toBe('s18')
  })
})

describe('stepPromptHistory', () => {
  const prompts = ['first', 'second']

  it('walks older from the live draft and stops at the oldest', () => {
    expect(stepPromptHistory(prompts, null, 'older')).toEqual({
      index: 1,
      text: 'second',
    })
    expect(stepPromptHistory(prompts, 1, 'older')).toEqual({
      index: 0,
      text: 'first',
    })
    expect(stepPromptHistory(prompts, 0, 'older')).toBeNull()
    expect(stepPromptHistory([], null, 'older')).toBeNull()
  })

  it('walks newer back to an empty live draft', () => {
    expect(stepPromptHistory(prompts, 0, 'newer')).toEqual({
      index: 1,
      text: 'second',
    })
    expect(stepPromptHistory(prompts, 1, 'newer')).toEqual({
      index: null,
      text: '',
    })
    expect(stepPromptHistory(prompts, null, 'newer')).toBeNull()
  })
})
