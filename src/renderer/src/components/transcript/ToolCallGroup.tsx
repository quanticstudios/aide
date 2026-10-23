import { ChevronRight, LoaderCircle } from 'lucide-react'
import type { ManagedSessionContentItem } from '../../../../shared/managed-session'
import ToolCallBlock from './ToolCallBlock'

export default function ToolCallGroup({
  items,
}: {
  readonly items: readonly ManagedSessionContentItem[]
}) {
  const tools = items.flatMap((item) => (item.tool ? [item.tool] : []))
  const failed = tools.filter((tool) => tool.status === 'failed').length
  const isRunning = tools.some((tool) => tool.status === 'running')

  return (
    <details
      className="group/tools overflow-hidden rounded-lg border border-[var(--border-soft)] bg-surface-1"
      data-testid="managed-tool-call-group"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tools:rotate-90" />
        {tools.length === 1 ? '1 tool call' : `${tools.length} tool calls`}
        <span className="ml-auto text-[11px] font-medium tabular-nums text-muted-foreground">
          {isRunning ? (
            <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
          ) : failed > 0 ? (
            `${failed} failed`
          ) : (
            'done'
          )}
        </span>
      </summary>
      <div className="space-y-2 border-t border-[var(--border-soft)] px-2 py-2">
        {items.map((item) =>
          item.tool ? <ToolCallBlock key={item.id} tool={item.tool} /> : null,
        )}
      </div>
    </details>
  )
}
