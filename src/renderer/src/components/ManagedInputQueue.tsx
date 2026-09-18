import { ChevronRight, LoaderCircle, Play, X } from 'lucide-react'
import type { ManagedSessionQueuedInput } from '../../../shared/managed-session'
import ManagedComposerAttachments from './ManagedComposerAttachments'

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
      className="mx-auto max-h-[40vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-surface-2 p-2"
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
            className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 rounded-md px-2 py-1.5 text-xs"
            key={item.id}
          >
            <details className="group">
              <summary className="flex min-h-8 cursor-pointer list-none items-center gap-2 rounded-sm [&::-webkit-details-marker]:hidden">
                <ChevronRight
                  aria-hidden
                  className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 ease-[var(--ease-out-strong)] group-open:rotate-90"
                />
                <span className="shrink-0 text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {item.recipients.map((alias) => `@${alias} `)}
                  {item.text || 'Attachments'}
                </span>
                {item.attachments.length > 0 ? (
                  <span className="shrink-0 text-muted-foreground">
                    {item.attachments.length} attached
                  </span>
                ) : null}
                <span className="shrink-0 text-muted-foreground">Preview</span>
              </summary>
              <div className="pb-3 pt-2" data-testid="queued-message-preview">
                {item.recipients.length > 0 ? (
                  <p className="mb-2 text-primary">
                    {item.recipients.map((alias) => `@${alias}`).join(', ')}
                  </p>
                ) : null}
                {item.skill ? (
                  <p className="mb-2 text-primary">
                    @{item.skill.provider} · /{item.skill.nativeName}
                  </p>
                ) : null}
                <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {item.text}
                </p>
                <ManagedComposerAttachments attachments={item.attachments} />
              </div>
            </details>
            {item.lastError ? (
              <p
                className="col-span-2 mb-2 break-words text-accent-red"
                role="status"
              >
                {item.lastError}
              </p>
            ) : null}
            <div className="col-start-2 row-start-1 flex min-h-8 items-center justify-end gap-2">
              {canSteer && item.recipients.length === 0 && !item.skill ? (
                <button
                  className="rounded px-1.5 py-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
                  disabled={isSubmitting}
                  onClick={() => onSendNow(item.id)}
                  title="Steer the active Codex turn"
                  type="button"
                >
                  Send now
                </button>
              ) : null}
              <button
                aria-label="Cancel queued message"
                className="flex size-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                disabled={isSubmitting}
                onClick={() => onCancel(item.id)}
                type="button"
              >
                <X aria-hidden className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
