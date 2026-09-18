import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'

import 'highlight.js/styles/github-dark.css'

interface MarkdownContentProps {
  readonly text: string
}

export default function MarkdownContent({ text }: MarkdownContentProps) {
  return (
    <div className="prose max-w-none">
      <ReactMarkdown
        rehypePlugins={[rehypeHighlight]}
        remarkPlugins={[remarkGfm]}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}
