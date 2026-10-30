import { Button } from '@heroui/react'
import type { Element } from 'hast'
import { SquareTerminal, WrapText } from 'lucide-react'
import { createContext, type ReactNode, useContext, useState } from 'react'

import { useCodeWrap } from '../lib/code-wrap'
import { RunInTerminalContext, terminalCommand } from '../lib/terminal-input'
import MessageCopyButton from './transcript/MessageCopyButton'
import IconTooltip from './ui/icon-tooltip'

/** The Markdown text a block was parsed from, so a node's position can slice its source. */
export const MarkdownSourceContext = createContext('')

const COLLAPSED_LINES = 30

/** True when a fenced code node's source ends with the fence that closes it, so the block is no longer streaming. */
export function isClosedFence(source: string): boolean {
  const lines = source.split('\n')
  const open = /(`{3,}|~{3,})/.exec(lines[0] ?? '')?.[1]
  // why: lines inside a list item or quote keep their indentation and `>` markers in the source.
  const close =
    lines.length > 1
      ? /^[\s>]*(`{3,}|~{3,})\s*$/.exec(lines.at(-1) ?? '')
      : null
  return Boolean(
    open && close?.[1]?.[0] === open[0] && close[1].length >= open.length,
  )
}

export default function MarkdownCodeBlock({
  children,
  code,
  language,
  node,
  shell,
}: {
  readonly children: ReactNode
  readonly code: string
  readonly language: string | undefined
  readonly node: Element | undefined
  readonly shell: boolean
}) {
  const [wrap, setWrap] = useCodeWrap()
  const [expanded, setExpanded] = useState(false)
  const source = useContext(MarkdownSourceContext)
  const runInTerminal = useContext(RunInTerminalContext)
  // why: the code element ends with the newline before the closing fence, which is not part of the block.
  const text = code.endsWith('\n') ? code.slice(0, -1) : code
  const lineCount = text.split('\n').length
  const collapsed = !expanded && lineCount > COLLAPSED_LINES
  const position = node?.position
  const command =
    runInTerminal &&
    shell &&
    position &&
    isClosedFence(source.slice(position.start.offset, position.end.offset))
      ? terminalCommand(text)
      : null
  const wrapLabel = wrap ? 'Turn off line wrap' : 'Wrap lines'
  return (
    <div
      className="code-block"
      data-collapsed={collapsed || undefined}
      data-testid="markdown-code-block"
      data-wrap={wrap || undefined}
    >
      <div className="code-block-header">
        <span className="font-mono text-[11px] text-muted-foreground">
          {language ?? 'text'}
        </span>
        <div className="flex items-center">
          {command ? (
            <IconTooltip label="Run in terminal">
              <Button
                aria-label="Run in terminal"
                className="size-7 rounded-md text-muted-foreground"
                isIconOnly
                onPress={() => runInTerminal?.(command)}
                size="sm"
                variant="ghost"
              >
                <SquareTerminal className="size-3.5" />
              </Button>
            </IconTooltip>
          ) : null}
          <IconTooltip label={wrapLabel}>
            <Button
              aria-label="Wrap lines"
              aria-pressed={wrap}
              className="size-7 rounded-md text-muted-foreground aria-pressed:text-foreground"
              isIconOnly
              onPress={() => setWrap(!wrap)}
              size="sm"
              variant="ghost"
            >
              <WrapText className="size-3.5" />
            </Button>
          </IconTooltip>
          <MessageCopyButton kind="code" text={text} />
        </div>
      </div>
      {children}
      {collapsed ? (
        <button
          className="code-block-expand"
          onClick={() => setExpanded(true)}
          type="button"
        >
          Show all {lineCount} lines
        </button>
      ) : null}
    </div>
  )
}
