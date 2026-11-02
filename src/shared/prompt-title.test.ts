import { describe, expect, it } from 'vitest'
import { chatTitle, plainPromptLine } from './prompt-title'

describe('plainPromptLine', () => {
  it('takes the first line of a multi-line prompt', () => {
    expect(
      plainPromptLine('md check\n\n## Heading two\n\nSome **bold**, *italic*'),
    ).toBe('md check')
  })

  it('drops markdown syntax and keeps the words', () => {
    expect(
      plainPromptLine(
        '## Fix **the** `auth` flow, see [docs](https://x.dev) and *why*',
      ),
    ).toBe('Fix the auth flow, see docs and why')
    expect(plainPromptLine('- [ ] add snake_case_names')).toBe(
      'add snake_case_names',
    )
  })
})

describe('chatTitle', () => {
  it('names a chat after its first prompt, and nothing before one', () => {
    const prompt = {
      id: 'p',
      kind: 'user-prompt' as const,
      provider: null,
      text: 'edit **readme**',
      turnId: 't',
      updatedAt: '',
    }
    expect(chatTitle({ content: [prompt] })).toBe('edit readme')
    expect(chatTitle({ content: [] })).toBeNull()
  })
})
