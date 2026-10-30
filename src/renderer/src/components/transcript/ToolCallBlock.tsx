import { ChevronDown, LoaderCircle } from 'lucide-react'
import { memo, useState } from 'react'
import type { ManagedSessionToolCall } from '../../../../shared/managed-session'
import ElapsedTime from './ElapsedTime'
import { formatThinkingDuration } from './format-thinking-duration'
import { toolRenderer } from './tools'

export { LazyGitDiffView } from './tools/EditTool'

function ToolCallStatus({ tool }: { readonly tool: ManagedSessionToolCall }) {
  if (tool.status === 'running') {
    return (
      <>
        <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
        {tool.startedAt ? (
          <span data-testid="tool-call-elapsed">
            <ElapsedTime since={tool.startedAt} />
          </span>
        ) : null}
      </>
    )
  }

  const failed =
    tool.status === 'failed' ||
    (tool.exitCode !== undefined && tool.exitCode !== 0)
  const duration =
    tool.startedAt && tool.endedAt
      ? formatThinkingDuration(
          Date.parse(tool.endedAt) - Date.parse(tool.startedAt),
        )
      : null

  return (
    <>
      {duration ? (
        <span data-testid="tool-call-duration">{duration}</span>
      ) : null}
      {tool.exitCode !== undefined || failed ? (
        <span
          className={failed ? 'font-semibold text-accent-red' : undefined}
          data-testid="tool-call-exit-code"
        >
          {tool.exitCode === undefined ? 'failed' : `exit ${tool.exitCode}`}
        </span>
      ) : duration ? null : (
        'done'
      )}
    </>
  )
}

export default memo(function ToolCallBlock({
  tool,
}: {
  readonly tool: ManagedSessionToolCall
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const renderer = toolRenderer(tool)
  const Icon = renderer.icon

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-surface-1"
      data-status={tool.status}
      data-testid="managed-content-tool-call"
    >
      <button
        aria-expanded={isExpanded}
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
        data-testid={`tool-call-${tool.toolName}`}
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-accent-blue" />
        <span className="shrink-0 text-xs font-semibold text-foreground">
          {tool.toolName}
        </span>
        <span className="truncate font-mono text-[12px] text-muted-foreground">
          {renderer.summary(tool)}
        </span>
        {tool.progress && tool.status === 'running' ? (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            data-testid="tool-call-progress"
          >
            {tool.progress}
          </span>
        ) : null}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px] tabular-nums text-muted-foreground">
          <ToolCallStatus tool={tool} />
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded ? (
        <div className="space-y-2 border-t border-[var(--border-soft)] px-3 py-2">
          <renderer.Body tool={tool} />
        </div>
      ) : null}
    </div>
  )
})
