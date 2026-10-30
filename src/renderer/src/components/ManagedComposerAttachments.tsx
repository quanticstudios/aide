import { FileCode, FileText, Paperclip, X } from 'lucide-react'
import type { ManagedSessionAttachment } from '../../../shared/managed-session'

interface ManagedComposerAttachmentsProps {
  readonly attachments: readonly ManagedSessionAttachment[]
  readonly onPasteInline?: (id: string) => void
  readonly onRemove?: (id: string) => void
}

export default function ManagedComposerAttachments({
  attachments,
  onPasteInline,
  onRemove,
}: ManagedComposerAttachmentsProps) {
  return attachments.length > 0 ? (
    <div
      className="flex flex-wrap gap-1.5 px-3 pt-3"
      data-testid={onRemove ? 'composer-attachments' : 'message-attachments'}
    >
      {attachments.map((attachment) => {
        const label =
          attachment.kind === 'workspace-file'
            ? attachment.path
            : attachment.name
        if (attachment.kind === 'image') {
          return (
            <div
              className="relative size-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-secondary"
              key={attachment.id}
              title={label}
            >
              <img
                alt={label}
                className="size-full object-cover"
                src={`data:${attachment.mimeType};base64,${attachment.data}`}
              />
              <span className="sr-only">{label}</span>
              {onRemove ? (
                <button
                  aria-label={`Remove ${label}`}
                  className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-foreground text-surface shadow-sm hover:opacity-80"
                  onClick={() => onRemove(attachment.id)}
                  type="button"
                >
                  <X aria-hidden className="size-3" />
                </button>
              ) : null}
            </div>
          )
        }
        if (attachment.kind === 'pasted-text') {
          return (
            <div
              className="flex max-w-64 items-center gap-2 rounded-md bg-surface-secondary p-2 text-xs text-foreground"
              data-testid="pasted-text-attachment"
              key={attachment.id}
              title={attachment.text.slice(0, 500)}
            >
              <FileText aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                {label} · {(attachment.text.length / 1000).toFixed(1)}k chars
              </span>
              {onPasteInline ? (
                <button
                  className="shrink-0 rounded-sm px-1 text-muted-foreground hover:text-foreground"
                  onClick={() => onPasteInline(attachment.id)}
                  type="button"
                >
                  Paste inline
                </button>
              ) : null}
              {onRemove ? (
                <button
                  aria-label={`Remove ${label}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={() => onRemove(attachment.id)}
                  type="button"
                >
                  <X aria-hidden className="size-3" />
                </button>
              ) : null}
            </div>
          )
        }
        return (
          <div
            className="flex max-w-64 flex-col gap-2 rounded-md bg-surface-secondary p-2 text-xs text-foreground"
            key={attachment.id}
          >
            <div className="flex min-w-0 items-center gap-2">
              <FileCode aria-hidden className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 break-all">{label}</span>
              {onRemove ? (
                <button
                  aria-label={`Remove ${label}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={() => onRemove(attachment.id)}
                  type="button"
                >
                  <X aria-hidden className="size-3" />
                </button>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  ) : null
}

export function ManagedComposerAttachmentButton({
  isDisabled,
  onPickFiles,
}: {
  readonly isDisabled: boolean
  readonly onPickFiles: () => void
}) {
  return (
    <button
      aria-label="Attach workspace files"
      className="composer-tool"
      disabled={isDisabled}
      onClick={onPickFiles}
      title="Attach workspace files"
      type="button"
    >
      <Paperclip aria-hidden className="size-4" />
    </button>
  )
}
