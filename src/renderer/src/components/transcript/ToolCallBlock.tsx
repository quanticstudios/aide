import {
  ChevronDown,
  FileCode,
  FileText,
  LoaderCircle,
  Terminal,
  Wrench,
} from 'lucide-react'
import { lazy, memo, Suspense, useState } from 'react'
import type { ManagedSessionToolCall } from '../../../../shared/managed-session'

export const LazyGitDiffView = lazy(async () => ({
  default: (await import('../GitDiffView')).GitDiffView,
}))

function toolCallIcon(tool: ManagedSessionToolCall) {
  if (tool.command) {
    return Terminal
  }

  if (tool.diff) {
    return FileCode
  }

  if (tool.files?.some((file) => file.status === 'read')) {
    return FileText
  }

  return Wrench
}

function toolCallSummary(tool: ManagedSessionToolCall): string {
  const input =
    tool.input && typeof tool.input === 'object'
      ? (tool.input as Record<string, unknown>)
      : {}

  return (
    tool.command ??
    (typeof input.description === 'string' ? input.description : undefined) ??
    tool.files?.[0]?.path ??
    JSON.stringify(tool.input ?? {}).slice(0, 80)
  )
}

function toolCallStatusLabel(tool: ManagedSessionToolCall): string {
  if (tool.status === 'failed') {
    return 'failed'
  }

  return tool.exitCode === undefined ? 'done' : `exit ${tool.exitCode}`
}

export default memo(function ToolCallBlock({
  tool,
}: {
  readonly tool: ManagedSessionToolCall
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const Icon = toolCallIcon(tool)
  const output = tool.output ?? ''
  const lines = output.split('\n')
  const isLongOutput = lines.length > 20

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-surface-1"
      data-testid="managed-content-tool-call"
    >
      <button
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
          {toolCallSummary(tool)}
        </span>
        {tool.progress && tool.status === 'running' ? (
          <span
            className="shrink-0 text-[11px] text-muted-foreground"
            data-testid="tool-call-progress"
          >
            {tool.progress}
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {tool.status === 'running' ? (
            <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
          ) : (
            toolCallStatusLabel(tool)
          )}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded ? (
        <div className="space-y-2 border-t border-[var(--border-soft)] px-3 py-2">
          {tool.command ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-foreground">
              {tool.command}
            </pre>
          ) : null}
          {tool.files && tool.files.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-[12px] text-muted-foreground">
              {tool.files.map((file) => (
                <li key={`${file.status}:${file.path}`}>
                  {file.status} {file.path}
                </li>
              ))}
            </ul>
          ) : null}
          {tool.diff ? (
            <div
              className="overflow-auto rounded-md border border-border"
              data-testid="tool-call-diff"
            >
              <Suspense fallback={null}>
                <LazyGitDiffView
                  filePath={tool.files?.[0]?.path ?? 'file'}
                  outputFormat="line-by-line"
                  patch={tool.diff}
                />
              </Suspense>
            </div>
          ) : null}
          {output ? (
            <pre
              className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body"
              data-testid="tool-call-output"
            >
              {isLongOutput && !isOutputExpanded
                ? lines.slice(0, 20).join('\n')
                : output}
            </pre>
          ) : null}
          {isLongOutput ? (
            <button
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setIsOutputExpanded((prev) => !prev)}
              type="button"
            >
              {isOutputExpanded
                ? 'Show less'
                : `Show ${lines.length - 20} more lines`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
})
