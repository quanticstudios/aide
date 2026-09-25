import type { Paragraph, Root } from 'mdast'
import { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import 'highlight.js/styles/github-dark.css'

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

const rehypePlugins = [rehypeHighlight]
const remarkPlugins = [remarkGfm]
const remarkPluginsWithLabels = [remarkGfm, remarkFormatSessionLabels]

export default memo(function MarkdownContent({
  text,
  formatSessionLabels = false,
}: MarkdownContentProps) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        rehypePlugins={rehypePlugins}
        remarkPlugins={
          formatSessionLabels ? remarkPluginsWithLabels : remarkPlugins
        }
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
