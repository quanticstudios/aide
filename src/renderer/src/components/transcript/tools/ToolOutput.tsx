import { useMemo, useState } from 'react'
import { parseAnsi } from './ansi'

const VISIBLE_LINES = 20

/** Tool output with its ANSI colors drawn as spans, cut to 20 lines until expanded. */
export default function ToolOutput({ output }: { readonly output: string }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const lines = output.split('\n')
  const isLong = lines.length > VISIBLE_LINES
  const shown =
    isLong && !isExpanded ? lines.slice(0, VISIBLE_LINES).join('\n') : output
  const segments = useMemo(() => parseAnsi(shown), [shown])

  return (
    <>
      <pre
        className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body"
        data-testid="tool-call-output"
      >
        {segments.map((segment, index) =>
          segment.className ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: segments have no identity beyond their order.
            <span className={segment.className} key={index}>
              {segment.text}
            </span>
          ) : (
            segment.text
          ),
        )}
      </pre>
      {isLong ? (
        <button
          className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setIsExpanded((prev) => !prev)}
          type="button"
        >
          {isExpanded
            ? 'Show less'
            : `Show ${lines.length - VISIBLE_LINES} more lines`}
        </button>
      ) : null}
    </>
  )
}
