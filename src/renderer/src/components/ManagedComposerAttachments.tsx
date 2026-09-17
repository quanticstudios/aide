import { FileCode, Image, Paperclip, X } from 'lucide-react'
import type { ManagedSessionAttachment } from '../../../shared/managed-session'

interface ManagedComposerAttachmentsProps {
  readonly attachments: readonly ManagedSessionAttachment[]
  readonly onRemove: (id: string) => void
}

export default function ManagedComposerAttachments({
  attachments,
  onRemove,
}: ManagedComposerAttachmentsProps) {
  return attachments.length > 0 ? (
    <div
      className="flex flex-wrap gap-1.5 px-3 pt-3"
      data-testid="composer-attachments"
    >
      {attachments.map((attachment) => {
        const label =
          attachment.kind === 'image' ? attachment.name : attachment.path
        return (
          <span
            className="inline-flex max-w-64 items-center gap-1.5 rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-foreground"
            key={attachment.id}
          >
            {attachment.kind === 'image' ? (
              <Image aria-hidden className="size-3 shrink-0" />
            ) : (
              <FileCode aria-hidden className="size-3 shrink-0" />
            )}
            <span className="truncate">{label}</span>
            <button
              aria-label={`Remove ${label}`}
              className="rounded-sm text-muted-foreground hover:text-foreground"
              onClick={() => onRemove(attachment.id)}
              type="button"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
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
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-secondary hover:text-foreground disabled:opacity-40"
      disabled={isDisabled}
      onClick={onPickFiles}
      title="Attach workspace files"
      type="button"
    >
      <Paperclip aria-hidden className="size-3.5" />
    </button>
  )
}
