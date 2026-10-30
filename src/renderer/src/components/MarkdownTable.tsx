import { type ComponentProps, useContext } from 'react'
import type { ExtraProps } from 'react-markdown'

import { tableRows, toCsv } from '../lib/csv'
import { MarkdownSourceContext } from './MarkdownCodeBlock'
import { useCopyText } from './transcript/MessageCopyButton'

function CopyTableButton({
  label,
  read,
}: {
  readonly label: string
  readonly read: () => string
}) {
  const [copied, copy] = useCopyText()
  return (
    <button
      className="table-block-action"
      onClick={() => void copy(read())}
      type="button"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}

export default function MarkdownTable({
  children,
  node,
}: ComponentProps<'table'> & ExtraProps) {
  const source = useContext(MarkdownSourceContext)
  const position = node?.position
  return (
    <div className="table-block" data-testid="markdown-table">
      <div className="table-block-header">
        {position ? (
          <CopyTableButton
            label="Copy as Markdown"
            read={() =>
              source.slice(position.start.offset, position.end.offset)
            }
          />
        ) : null}
        {node ? (
          <CopyTableButton
            label="Copy as CSV"
            read={() => toCsv(tableRows(node))}
          />
        ) : null}
      </div>
      {/* why: a wide table scrolls here instead of widening the transcript. */}
      <div className="table-block-scroll">
        <table>{children}</table>
      </div>
    </div>
  )
}
