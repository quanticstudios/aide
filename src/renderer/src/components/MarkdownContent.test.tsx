import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
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
