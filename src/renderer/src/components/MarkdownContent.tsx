import type { Paragraph, Root } from 'mdast'
import { type ComponentProps, Fragment, memo, useEffect, useState } from 'react'
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ThemedToken } from 'shiki/core'

import { cachedTokens, highlight, resolveLanguage } from '../lib/highlighter'
import { splitMarkdownBlocks } from '../lib/markdown-blocks'
import { remarkWorkspaceFileLinks } from '../lib/markdown-file-paths'
import MarkdownCodeBlock, { MarkdownSourceContext } from './MarkdownCodeBlock'
import { MarkdownImage, MarkdownLink } from './MarkdownLink'
import MarkdownTable from './MarkdownTable'

interface MarkdownContentProps {
  readonly text: string
  readonly formatSessionLabels?: boolean
}

function remarkFormatSessionLabels() {
  return (tree: Root) => {
    tree.children = tree.children.flatMap((node): Root['children'] => {
      if (node.type !== 'paragraph') return [node]
      const paragraphs: Paragraph[] = []
      let paragraph: Paragraph = { type: 'paragraph', children: [] }
      for (const child of node.children) {
        const previous = paragraph.children.at(-1)
        const isMessageStart =
          !previous ||
          (previous.type === 'text' && /[.!?]\s*$/.test(previous.value))
        if (
          child.type === 'inlineCode' &&
          isMessageStart &&
          /^\[[^\]\n]+ · [^\]\n]+\]$/.test(child.value)
        ) {
          if (paragraph.children.length) paragraphs.push(paragraph)
          paragraphs.push({
            type: 'paragraph',
            data: { hProperties: { className: ['message-session-label'] } },
            children: [child],
          })
          paragraph = { type: 'paragraph', children: [] }
        } else {
          paragraph.children.push(
            child.type === 'text' && !paragraph.children.length
              ? { ...child, value: child.value.trimStart() }
              : child,
          )
        }
      }
      if (paragraph.children.length) paragraphs.push(paragraph)
      return paragraphs
    })
  }
}

// why: a streaming block changes on every chunk; tokenizing waits until its text settles.
const HIGHLIGHT_SETTLE_MS = 50

interface Highlighted {
  readonly code: string
  readonly lang: string
  readonly lines: ThemedToken[][]
}

function HighlightedCode({
  code,
  lang,
}: {
  readonly code: string
  readonly lang: string
}) {
  const [highlighted, setHighlighted] = useState<Highlighted | null>(null)
  const lines =
    highlighted?.code === code && highlighted.lang === lang
      ? highlighted.lines
      : cachedTokens(code, lang)
  useEffect(() => {
    if (cachedTokens(code, lang)) return
    let cancelled = false
    const timer = setTimeout(() => {
      highlight(code, lang).then(
        (result) => {
          if (!cancelled && result)
            setHighlighted({ code, lang, lines: result })
        },
        // why: a failed grammar load keeps the block plain; the next change retries.
        () => undefined,
      )
    }, HIGHLIGHT_SETTLE_MS)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [code, lang])
  return (
    <pre data-language={lang}>
      <code>
        {lines
          ? lines.map((line, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              <Fragment key={index}>
                {index > 0 && '\n'}
                {line.map((token) => (
                  <span key={token.offset} style={{ color: token.color }}>
                    {token.content}
                  </span>
                ))}
              </Fragment>
            ))
          : code}
      </code>
    </pre>
  )
}

function CodeBlock({ children, node }: ComponentProps<'pre'> & ExtraProps) {
  const code = node?.children[0]
  if (code?.type !== 'element' || code.tagName !== 'code') {
    return <pre>{children}</pre>
  }
  const classNames = code.properties.className
  const languageClass = Array.isArray(classNames)
    ? classNames.map(String).find((name) => name.startsWith('language-'))
    : undefined
  const language = languageClass?.slice('language-'.length)
  const lang = resolveLanguage(language)
  const text = code.children
    .map((child) => (child.type === 'text' ? child.value : ''))
    .join('')
  return (
    <MarkdownCodeBlock
      code={text}
      language={language}
      node={node}
      shell={lang === 'shellscript'}
    >
      {lang ? (
        <HighlightedCode code={text} lang={lang} />
      ) : (
        <pre>{children}</pre>
      )}
    </MarkdownCodeBlock>
  )
}

const components: Components = {
  a: MarkdownLink,
  img: MarkdownImage,
  pre: CodeBlock,
  table: MarkdownTable,
}
const remarkPlugins = [remarkGfm, remarkWorkspaceFileLinks]
const remarkPluginsWithLabels = [
  remarkGfm,
  remarkFormatSessionLabels,
  remarkWorkspaceFileLinks,
]

// why: a block's props are its text plus stable plugin and component references, so finished blocks skip re-parsing while the tail streams.
const MemoizedMarkdown = memo(ReactMarkdown)

export default memo(function MarkdownContent({
  text,
  formatSessionLabels = false,
}: MarkdownContentProps) {
  return (
    <div className="prose max-w-none">
      {splitMarkdownBlocks(text).map((block) => (
        <MarkdownSourceContext.Provider key={block.start} value={block.text}>
          <MemoizedMarkdown
            components={components}
            remarkPlugins={
              formatSessionLabels ? remarkPluginsWithLabels : remarkPlugins
            }
          >
            {block.text}
          </MemoizedMarkdown>
        </MarkdownSourceContext.Provider>
      ))}
    </div>
  )
})
