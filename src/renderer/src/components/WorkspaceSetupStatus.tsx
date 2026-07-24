import { Button } from '@heroui/react'
import { Loader2, Play, RotateCcw, X } from 'lucide-react'

import {
  formatWorkspaceSetupStatus,
  type WorkspaceSetupSnapshot,
} from '../../../shared/workspace-setup'
import { cn } from '../lib/utils'

interface WorkspaceSetupStatusProps {
  readonly onCancel: () => void
  readonly onRun: () => void
  readonly setup: WorkspaceSetupSnapshot | null
}

function setupAccent(state: WorkspaceSetupSnapshot['state']): string {
  if (state === 'failed') return 'border-accent-red/50 bg-accent-red-soft'
  if (state === 'cancelled')
    return 'border-accent-yellow/50 bg-accent-yellow-soft'
  if (state === 'succeeded')
    return 'border-accent-green/40 bg-accent-green-soft'
  return 'border-border bg-surface/95'
}

export default function WorkspaceSetupStatus({
  onCancel,
  onRun,
  setup,
}: WorkspaceSetupStatusProps) {
  if (
    !setup ||
    setup.state === 'succeeded' ||
    (!setup.commandRequired && setup.state === 'not-required')
  ) {
    return null
  }

  const isRunning = setup.state === 'queued' || setup.state === 'running'
  const canRetry = setup.attempt > 0 && !isRunning

  return (
    <aside
      aria-label="Workspace setup"
      className={cn(
        'absolute right-4 top-3 z-20 flex max-w-sm items-center gap-2 rounded-lg border px-3 py-2 shadow-lg backdrop-blur',
        setupAccent(setup.state),
      )}
      data-testid="workspace-setup-status"
    >
      {isRunning ? (
        <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
      ) : null}
      <div className="min-w-0">
        <p aria-live="polite" className="text-xs font-semibold">
          {formatWorkspaceSetupStatus(setup)}
        </p>
        {setup.errorSummary ? (
          <p className="mt-0.5 text-xs text-muted-foreground">
            {setup.errorSummary}
          </p>
        ) : null}
        {setup.outputTail ? (
          <details className="mt-1 text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Setup log</summary>
            <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-background/60 p-2 font-mono text-[10px]">
              {setup.outputTail}
              {setup.outputTruncated ? '\n…output truncated…' : ''}
            </pre>
          </details>
        ) : null}
      </div>
      {isRunning ? (
        <Button
          aria-label="Cancel workspace setup"
          className="shrink-0"
          isIconOnly
          onPress={onCancel}
          size="sm"
          variant="ghost"
        >
          <X aria-hidden className="size-4" />
        </Button>
      ) : (
        <Button className="shrink-0" onPress={onRun} size="sm" variant="ghost">
          {canRetry ? (
            <RotateCcw aria-hidden className="size-3.5" />
          ) : (
            <Play aria-hidden className="size-3.5" />
          )}
          {canRetry ? 'Retry setup' : 'Run setup'}
        </Button>
      )}
    </aside>
  )
}
