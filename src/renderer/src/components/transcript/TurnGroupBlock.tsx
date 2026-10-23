import { Button } from '@heroui/react'
import { ChevronRight, GitBranch, LoaderCircle, RefreshCw } from 'lucide-react'
import { Fragment, memo, Suspense, useEffect, useState } from 'react'
import type { TurnCheckpointDiff } from '../../../../shared/checkpoints'
import type { AideApi } from '../../../../shared/ipc'
import type { ManagedSessionContentItem } from '../../../../shared/managed-session'
import type { TurnGroup } from '../../lib/managed-session-grouping'
import { cn } from '../../lib/utils'
import IconTooltip from '../ui/icon-tooltip'
import ContentItemBlock from './ContentItemBlock'
import { formatMessageTime } from './format-message-time'
import MessageCopyButton from './MessageCopyButton'
import TaskListBlock from './TaskListBlock'
import { LazyGitDiffView } from './ToolCallBlock'
import ToolCallGroup from './ToolCallGroup'

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

type TurnGroupBlockProps = Parameters<typeof TurnGroupBlockContent>[0]

// why: groups are rebuilt on every snapshot, so equality compares the shared item objects instead.
function areTurnGroupPropsEqual(
  previous: TurnGroupBlockProps,
  next: TurnGroupBlockProps,
): boolean {
  for (const key of Object.keys(next) as (keyof TurnGroupBlockProps)[]) {
    if (key !== 'group' && previous[key] !== next[key]) return false
  }
  return (
    previous.group.turnId === next.group.turnId &&
    previous.group.items.length === next.group.items.length &&
    previous.group.items.every(
      (item, index) => item === next.group.items[index],
    )
  )
}

const TurnGroupBlock = memo(TurnGroupBlockContent, areTurnGroupPropsEqual)

function TurnGroupBlockContent({
  group,
  canBranch,
  checkpointId,
  isFailed,
  isRunning,
  onBranch,
  onEditFromHere,
  onInterrupt,
  onRetry,
  providerLabel,
  recipientAlias,
  requestText,
  rewindDisabledReason,
  sessionId,
}: {
  readonly group: TurnGroup
  readonly canBranch: boolean
  readonly checkpointId: string | null
  readonly isFailed: boolean
  readonly isRunning: boolean
  readonly onBranch: (responseContentItemId: string) => void
  readonly onEditFromHere: (
    checkpointId: string,
    item: ManagedSessionContentItem,
  ) => void
  readonly onInterrupt: (recipientAlias: string) => void
  readonly onRetry: (text: string, recipientAlias: string) => void
  readonly providerLabel: string
  readonly recipientAlias: string | null
  readonly requestText: string | null
  readonly rewindDisabledReason: string | null
  readonly sessionId: string
}) {
  const [turnDiff, setTurnDiff] = useState<TurnCheckpointDiff | null>(null)
  const [isTurnDiffOpen, setIsTurnDiffOpen] = useState(false)
  const canRetry = isFailed && Boolean(requestText) && Boolean(recipientAlias)
  // why: the checklist renders once per turn, so its tool row drops out of the timeline.
  const tasks = group.items.filter((item) => item.tool?.tasks).at(-1)
    ?.tool?.tasks
  const items = group.items.filter((item) => !item.tool?.tasks)
  // why: the checklist describes the reply, so it sits after the prompt bubble.
  const taskListIndex = items.findIndex((item) => item.kind !== 'user-prompt')
  const responseItem = group.items
    .filter(
      (item) => item.kind === 'assistant-text' && item.phase !== 'commentary',
    )
    .at(-1)
  const responseContentItemId = responseItem?.id

  useEffect(() => {
    if (!checkpointId || isRunning) return
    let cancelled = false
    void getAideApi()
      ?.getTurnCheckpointDiff(sessionId, checkpointId)
      .then(
        (diff) => {
          if (!cancelled) setTurnDiff(diff)
        },
        () => undefined,
      )
    return () => {
      cancelled = true
    }
  }, [checkpointId, isRunning, sessionId])

  return (
    <div className={cn('chat-turn relative space-y-3', isRunning && 'turn')}>
      {items.map((item, index) => {
        const previous = items[index - 1]
        const taskList =
          tasks && index === taskListIndex ? (
            <TaskListBlock isRunning={isRunning} tasks={tasks} />
          ) : null

        if (item.kind === 'tool-call') {
          if (previous?.kind === 'tool-call') {
            return (
              <Fragment key={`${item.kind}:${item.id}`}>{taskList}</Fragment>
            )
          }

          let end = index + 1
          while (items[end]?.kind === 'tool-call') {
            end += 1
          }

          return (
            <Fragment key={`${item.kind}:${item.id}`}>
              {taskList}
              <ToolCallGroup items={items.slice(index, end)} />
            </Fragment>
          )
        }

        return (
          <Fragment key={`${item.kind}:${item.id}`}>
            {taskList}
            <ContentItemBlock
              editFromHereDisabledReason={rewindDisabledReason}
              item={item}
              onEditFromHere={
                checkpointId && item.kind === 'user-prompt'
                  ? () => onEditFromHere(checkpointId, item)
                  : undefined
              }
              showProvider={
                previous?.kind !== 'assistant-text' ||
                previous.provider !== item.provider ||
                previous.model !== item.model
              }
            />
          </Fragment>
        )
      })}
      {tasks && taskListIndex === -1 ? (
        <TaskListBlock isRunning={isRunning} tasks={tasks} />
      ) : null}
      {isRunning ? (
        <div className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
          {providerLabel} is working...
          {recipientAlias ? (
            <button
              className="ml-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onInterrupt(recipientAlias)}
              type="button"
            >
              Interrupt @{recipientAlias}
            </button>
          ) : null}
        </div>
      ) : null}
      {!isRunning && (canRetry || responseItem) ? (
        <div
          className="response-actions flex items-center gap-1 px-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100"
          data-testid="response-actions"
        >
          <MessageCopyButton
            kind="response"
            text={group.items
              .filter(
                (item) =>
                  item.kind === 'assistant-text' && item.phase !== 'commentary',
              )
              .map((item) => item.text)
              .join('\n\n')}
          />
          {turnDiff && turnDiff.files.length > 0 ? (
            <button
              aria-expanded={isTurnDiffOpen}
              className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-surface-2 px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              data-testid="turn-diff-chip"
              onClick={() => setIsTurnDiffOpen((open) => !open)}
              type="button"
            >
              <span className="text-accent-green">+{turnDiff.additions}</span>{' '}
              <span className="text-accent-red">-{turnDiff.deletions}</span>{' '}
              <span>
                · {turnDiff.files.length}{' '}
                {turnDiff.files.length === 1 ? 'file' : 'files'}
              </span>
            </button>
          ) : null}
          {canRetry && requestText && recipientAlias ? (
            <button
              aria-label="Retry turn"
              className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              onClick={() => onRetry(requestText, recipientAlias)}
              type="button"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          ) : null}
          {canBranch && responseContentItemId ? (
            <IconTooltip label="Branch conversation">
              <Button
                aria-label="Branch conversation"
                className="size-7 rounded-md text-muted-foreground"
                isIconOnly
                onPress={() => onBranch(responseContentItemId)}
                size="sm"
                variant="ghost"
              >
                <GitBranch className="size-3.5" />
              </Button>
            </IconTooltip>
          ) : null}
          {responseItem ? (
            <time
              dateTime={responseItem.updatedAt}
              className="ml-1 text-[11px] tabular-nums text-muted-foreground/70"
            >
              {formatMessageTime(responseItem.updatedAt)}
            </time>
          ) : null}
        </div>
      ) : null}
      {isTurnDiffOpen && turnDiff ? (
        <div className="space-y-2" data-testid="turn-diff-files">
          {turnDiff.files.map((file) => (
            <details
              className="group/turn-diff rounded-md border border-border bg-surface"
              key={file.path}
              open
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <ChevronRight className="size-3 transition-transform group-open/turn-diff:rotate-90" />
                {file.path}
                <span className="ml-auto tabular-nums text-accent-green">
                  +{file.additions}
                </span>
                <span className="tabular-nums text-accent-red">
                  -{file.deletions}
                </span>
              </summary>
              <div className="max-h-96 overflow-auto border-t border-border">
                <Suspense fallback={null}>
                  <LazyGitDiffView
                    filePath={file.path}
                    outputFormat="line-by-line"
                    patch={file.patch}
                  />
                </Suspense>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default TurnGroupBlock
