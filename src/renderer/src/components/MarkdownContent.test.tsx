import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { highlight, loadLanguage } from '../lib/highlighter'
import MarkdownContent from './MarkdownContent'

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
