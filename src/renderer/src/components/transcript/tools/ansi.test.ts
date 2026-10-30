import { describe, expect, it } from 'vitest'
import { parseAnsi } from './ansi'

describe('parseAnsi', () => {
  it('returns plain text as one uncolored run', () => {
    expect(parseAnsi('hello\nworld')).toEqual([
      { className: '', text: 'hello\nworld' },
    ])
  })

  it('colors runs and resets them', () => {
    expect(
      parseAnsi('\u001b[31merror\u001b[0m ok \u001b[1;92mpass\u001b[m'),
    ).toEqual([
      { className: 'text-accent-red', text: 'error' },
      { className: '', text: ' ok ' },
      { className: 'text-accent-green font-bold', text: 'pass' },
    ])
  })

  it('drops cursor moves, OSC links and extended colors without leaking codes', () => {
    expect(
      parseAnsi(
        '\u001b[2K\u001b]8;;https://x.dev\u0007link\u001b]8;;\u0007 \u001b[38;5;196mred\u001b[38;2;1;2;3m!',
      ),
    ).toEqual([{ className: '', text: 'link red!' }])
  })
})
