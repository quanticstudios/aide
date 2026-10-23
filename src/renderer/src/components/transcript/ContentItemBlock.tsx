import { Button } from '@heroui/react'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  FileCode,
  History,
  Terminal,
} from 'lucide-react'
import { memo, useState } from 'react'
import type { ManagedSessionContentItem } from '../../../../shared/managed-session'
import { cn } from '../../lib/utils'
import ManagedComposerAttachments from '../ManagedComposerAttachments'
import MarkdownContent from '../MarkdownContent'
import IconTooltip from '../ui/icon-tooltip'
import { AnthropicIcon, OpenAIIcon } from '../ui/provider-icons'
import { formatMessageTime } from './format-message-time'
import MessageCopyButton from './MessageCopyButton'
import ToolCallBlock from './ToolCallBlock'

export default memo(function ContentItemBlock({
  checkpointId = null,
  editFromHereDisabledReason = null,
  item,
  onEditFromHere,
  showProvider = true,
}: {
  readonly checkpointId?: string | null
  readonly editFromHereDisabledReason?: string | null
  readonly item: ManagedSessionContentItem
  readonly onEditFromHere?:
    | ((checkpointId: string, item: ManagedSessionContentItem) => void)
    | undefined
  readonly showProvider?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (item.kind === 'user-prompt') {
    return (
      <div className="flex justify-end">
        <div
          className="group/user-message flex max-w-[85%] flex-col items-end"
          data-minimap-message="Your message"
          data-testid={`managed-content-${item.kind}`}
        >
          <div
            className="rounded-2xl rounded-br-md bg-surface-2 px-4 py-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.5),0_0_0_1px_var(--border)]"
            data-testid="user-message-bubble"
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.55] text-foreground">
              {item.text}
            </pre>
            <ManagedComposerAttachments attachments={item.attachments ?? []} />
          </div>
          <div
            className="mt-1 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100"
            data-testid="user-message-actions"
          >
            <time
              dateTime={item.updatedAt}
              className="text-[11px] tabular-nums text-muted-foreground/70"
            >
              {formatMessageTime(item.updatedAt)}
            </time>
            <MessageCopyButton text={item.text} kind="message" />
            {checkpointId && onEditFromHere ? (
              <IconTooltip
                label={editFromHereDisabledReason ?? 'Rewind to this message'}
              >
                <Button
                  aria-label="Edit from here"
                  className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground"
                  isDisabled={Boolean(editFromHereDisabledReason)}
                  onPress={() => onEditFromHere(checkpointId, item)}
                  size="sm"
                  variant="ghost"
                >
                  <History className="size-3.5" />
                  Edit from here
                </Button>
              </IconTooltip>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (item.kind === 'tool-call' && item.tool) {
    return <ToolCallBlock tool={item.tool} />
  }

  if (item.kind === 'command-output') {
    const lines = item.text.split('\n')
    const isLong = lines.length > 20
    const displayText =
      isLong && !isExpanded ? lines.slice(0, 5).join('\n') : item.text

    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] bg-surface-1 px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-foreground">
          <Terminal className="size-3.5 text-accent-green" />
          Command output
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body">
          {displayText}
        </pre>
        {isLong ? (
          <button
            className="mt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setIsExpanded((prev) => !prev)}
            type="button"
          >
            {isExpanded ? 'Show less' : `Show ${lines.length - 5} more lines`}
          </button>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'file-change-output') {
    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] bg-surface-1 px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-foreground">
          <FileCode className="size-3.5 text-accent-yellow" />
          File changes
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body">
          {item.text}
        </pre>
      </div>
    )
  }

  if (
    item.kind === 'reasoning-text' ||
    item.kind === 'reasoning-summary-text'
  ) {
    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] px-3 py-2"
        data-testid={`managed-content-${item.kind}`}
      >
        <button
          className="flex w-full items-center gap-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setIsExpanded((prev) => !prev)}
          type="button"
        >
          <Brain className="size-3.5 text-accent-blue" />
          {item.kind === 'reasoning-text' ? 'Reasoning' : 'Reasoning summary'}
          <ChevronDown
            className={`ml-auto size-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {isExpanded ? (
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.6] text-muted-foreground">
            {item.text}
          </pre>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'system') {
    return (
      <p className="system-notice" data-testid={`managed-content-${item.kind}`}>
        {item.text}
      </p>
    )
  }

  return (
    <div
      className={cn(
        'px-1',
        item.kind === 'assistant-text' && 'assistant-message',
      )}
      data-minimap-message={
        item.kind === 'assistant-text' ? 'Agent response' : undefined
      }
      data-testid={`managed-content-${item.kind}`}
    >
      {item.kind === 'assistant-text' && item.provider && showProvider ? (
        <p className="mb-2 flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 ring-1 ring-[var(--border-soft)]">
            {item.provider === 'claude' ? (
              <AnthropicIcon className="size-3.5" />
            ) : (
              <OpenAIIcon className="size-3.5" />
            )}
          </span>
          <span className="text-[13px] font-semibold text-foreground">
            {item.provider === 'claude' ? 'Claude' : 'Codex'}
          </span>
          {item.model ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {` · ${item.model}`}
            </span>
          ) : null}
        </p>
      ) : null}
      {item.phase === 'commentary' ? (
        <details
          className="group/activity text-muted-foreground"
          data-testid="assistant-activity"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium">
            <ChevronRight className="size-3.5 transition-transform group-open/activity:rotate-90" />
            Activity
          </summary>
          <div className="mt-2 border-l border-border pl-4 text-[13px]">
            <MarkdownContent text={item.text} formatSessionLabels />
          </div>
        </details>
      ) : (
        <MarkdownContent
          text={item.text}
          formatSessionLabels={item.kind === 'assistant-text'}
        />
      )}
    </div>
  )
})
