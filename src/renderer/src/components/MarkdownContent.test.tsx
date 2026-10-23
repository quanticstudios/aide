import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { highlight, loadLanguage } from '../lib/highlighter'
import { splitMarkdownBlocks } from '../lib/markdown-blocks'
import MarkdownContent from './MarkdownContent'

const splitter = vi.hoisted(() => ({ whole: false }))

// why: the reference render must go through the same renderer with splitting turned off.
vi.mock('../lib/markdown-blocks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/markdown-blocks')>()
  return {
    splitMarkdownBlocks: (text: string) =>
      splitter.whole ? [{ start: 0, text }] : actual.splitMarkdownBlocks(text),
  }
})

const reply = [
  '# Plan',
  '',
  'First I read the store. Then **two** things:',
  '',
  '1. Buffer text',
  '',
  '2. Memoize rows',
  '   with a nested line',
  '',
  '- loose item',
  '',
  '  continued item',
  '',
  'Back to prose with `code`.',
  '',
  '```ts',
  'const a = 1',
  '',
  'const b = 2',
  '```',
  '',
  '> quoted',
  '',
  '> still quoted',
  '',
  '| a | b |',
  '| - | - |',
  '| 1 | 2 |',
  '',
  '    indented code',
  '',
  '    more indented code',
  '',
  'Setext title',
  '---',
  '',
  '~~~',
  'tilde fence',
  '',
  '~~~',
  '',
  'Done.',
].join('\n')

// why: newlines between block tags are whitespace text nodes that render nothing.
function withoutBlockGaps(html: string): string {
  return html.replace(/>\n+</g, '><')
}

function renderWhole(text: string): string {
  splitter.whole = true
  try {
    return withoutBlockGaps(
      renderToStaticMarkup(<MarkdownContent text={text} />),
    )
  } finally {
    splitter.whole = false
  }
}

describe('assistant Markdown formatting', () => {
  it('separates legacy joined messages and puts session labels on their own lines', () => {
    const text =
      '`[aide · geography]` Checking.`[aide · geography]` The capital is Tokyo.'
    const html = renderToStaticMarkup(
      <MarkdownContent text={text} formatSessionLabels />,
    )
    expect(html.match(/message-session-label/g)).toHaveLength(2)
    expect(html.match(/aide · geography/g)).toHaveLength(2)
    expect(html).toContain('<p>Checking.</p>')
    expect(html).toContain('<p>The capital is Tokyo.</p>')
  })

  it('preserves labels quoted in prose, code blocks, and ordinary Markdown', () => {
    const text =
      'Example: `[aide · geography]`\n\n```text\n[aide · geography]\n```'
    const html = renderToStaticMarkup(
      <MarkdownContent text={text} formatSessionLabels />,
    )
    expect(html.match(/aide · geography/g)).toHaveLength(2)
    expect(
      renderToStaticMarkup(
        <MarkdownContent text="`[aide · geography]` Answer." />,
      ),
    ).toContain('aide · geography')
  })
})

const code = 'const answer: number = 42\n'

describe('MarkdownContent code blocks', () => {
  it('renders plain text and never tokenizes during render', async () => {
    await loadLanguage('typescript')

    const markup = renderToStaticMarkup(
      <MarkdownContent text={`\`\`\`ts\n${code}\`\`\``} />,
    )

    expect(markup).toContain('<pre data-language="typescript"><code>const')
    expect(markup).not.toContain('--shiki-token')
  })

  it('renders a block highlighted earlier from the cache', async () => {
    await highlight(code, 'typescript')

    const markup = renderToStaticMarkup(
      <MarkdownContent text={`\`\`\`ts\n${code}\`\`\``} />,
    )

    expect(markup).toContain('color:var(--shiki-token-keyword)">const</span>')
  })

  it('leaves languages without a grammar to the default renderer', () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent text={'```brainfuck\n++[>+<-]\n```'} />,
    )

    expect(markup).toContain('<pre><code class="language-brainfuck">')
  })
})

describe('splitMarkdownBlocks', () => {
  it('renders every streamed prefix exactly like one whole parse', () => {
    for (let end = 1; end <= reply.length; end += 3) {
      const text = reply.slice(0, end)
      expect(
        withoutBlockGaps(renderToStaticMarkup(<MarkdownContent text={text} />)),
      ).toBe(renderWhole(text))
    }
    expect(splitMarkdownBlocks(reply).length).toBeGreaterThan(5)
  })

  it('keeps earlier blocks unchanged as text streams in', () => {
    const before = splitMarkdownBlocks(reply.slice(0, 200))
    const after = splitMarkdownBlocks(reply)
    expect(after.slice(0, before.length - 1)).toEqual(before.slice(0, -1))
  })

  it('keeps fenced code with blank lines in one block', () => {
    const blocks = splitMarkdownBlocks('Intro\n\n```\na\n\nb\n```\n\nOutro')
    expect(blocks.map((block) => block.text)).toEqual([
      'Intro\n\n',
      '```\na\n\nb\n```\n\n',
      'Outro',
    ])
  })

  it('renders like one parse once a definition with escaped brackets arrives', () => {
    const text = `${reply}\n\nSee [a\\]b].\n\n[a\\]b]: https://example.dev`
    expect(splitMarkdownBlocks(text)).toHaveLength(1)
    expect(
      withoutBlockGaps(renderToStaticMarkup(<MarkdownContent text={text} />)),
    ).toBe(renderWhole(text))
  })

  it('parses CDATA and processing instructions whole', () => {
    expect(splitMarkdownBlocks('<![CDATA[\n\nText\n]]>\n\nMore')).toHaveLength(
      1,
    )
    expect(splitMarkdownBlocks('<?xml\n\nText\n?>\n\nMore')).toHaveLength(1)
  })

  it('parses documents with link definitions or raw HTML whole', () => {
    expect(splitMarkdownBlocks('See [a].\n\n[a]: https://x.dev')).toHaveLength(
      1,
    )
    expect(splitMarkdownBlocks('<!--\n\nnote\n-->\n\nText')).toHaveLength(1)
  })
})
