import { LoaderCircle, Play, X } from 'lucide-react'
import type { ManagedSessionQueuedInput } from '../../../shared/managed-session'

interface ManagedInputQueueProps {
  readonly canSteer: boolean
  readonly isPaused: boolean
  readonly isSubmitting: boolean
  readonly items: readonly ManagedSessionQueuedInput[]
  readonly onCancel: (id: string) => void
  readonly onResume: () => void
  readonly onSendNow: (id: string) => void
}

export default function ManagedInputQueue({
  canSteer,
  isPaused,
  isSubmitting,
  items,
  onCancel,
  onResume,
  onSendNow,
}: ManagedInputQueueProps) {
  if (items.length === 0) return null
  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-surface-secondary p-2"
      data-testid="managed-input-queue"
    >
      <div className="flex items-center justify-between px-1 pb-1.5 text-xs font-semibold text-foreground">
        <span>{items.length} queued</span>
        {isPaused ? (
          <button
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-primary hover:bg-primary/10"
            disabled={isSubmitting}
            onClick={onResume}
            type="button"
          >
            {isSubmitting ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Play className="size-3" />
            )}
            Resume
          </button>
        ) : null}
      </div>
      <ol className="space-y-1">
        {items.map((item, index) => (
          <li
            className="flex items-center gap-2 rounded-md bg-surface px-2 py-1.5 text-xs"
            key={item.id}
          >
            <span className="text-muted-foreground">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate">
              {item.recipients.length > 0
                ? `${item.recipients.map((alias) => `@${alias}`).join(', ')} `
                : ''}
              {item.text}
              {item.attachments.length > 0
                ? ` · ${item.attachments.length} attachment${item.attachments.length === 1 ? '' : 's'}`
                : ''}
            </span>
            {item.lastError ? (
              <span
                className="max-w-48 truncate text-accent-red"
                title={item.lastError}
              >
                {item.lastError}
              </span>
            ) : null}
            <button
              className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
              disabled={!canSteer || item.recipients.length > 0 || isSubmitting}
              onClick={() => onSendNow(item.id)}
              title={
                canSteer
                  ? 'Steer the active Codex turn'
                  : 'Send now requires an active Codex turn'
              }
              type="button"
            >
              Send now
            </button>
            <button
              aria-label="Cancel queued message"
              className="rounded text-muted-foreground hover:text-foreground"
              disabled={isSubmitting}
              onClick={() => onCancel(item.id)}
              type="button"
            >
              <X aria-hidden className="size-3.5" />
            </button>
          </li>
        ))}
      </ol>
    </div>
  )
}
