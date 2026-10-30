import { Archive, X } from 'lucide-react'
import { useRef, useState } from 'react'
import type { StashedDraft } from '../lib/composer-history-storage'
import { formatRelativeTime } from '../lib/relative-time'
import { useClickOutside } from '../lib/use-click-outside'

export default function ComposerStashMenu({
  onOpen,
  onRemove,
  onRestore,
  stashes,
}: {
  readonly onOpen: () => void
  readonly onRemove: (id: string) => void
  readonly onRestore: (id: string) => void
  readonly stashes: readonly StashedDraft[]
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setIsOpen(false), isOpen)
  if (stashes.length === 0) return null

  return (
    <div ref={containerRef} className="relative">
      <button
        aria-expanded={isOpen}
        aria-label={`Stashed drafts (${stashes.length})`}
        className="composer-tool"
        onClick={() => {
          if (!isOpen) onOpen()
          setIsOpen(!isOpen)
        }}
        title="Stashed drafts"
        type="button"
      >
        <Archive aria-hidden className="size-4" />
        {stashes.length}
      </button>
      {isOpen ? (
        <div
          className="absolute bottom-full left-0 z-50 mb-1 w-80 rounded-lg floating-surface py-1.5"
          data-testid="composer-stash-menu"
        >
          {stashes.map((stash) => {
            const label =
              stash.draft.text.split('\n')[0]?.trim() ||
              `${stash.draft.attachments.length} attachment(s)`
            return (
              <div className="flex items-center gap-1 px-2" key={stash.id}>
                <button
                  className="flex min-w-0 flex-1 flex-col rounded-md px-2 py-1.5 text-left hover:bg-secondary/60"
                  onClick={() => {
                    onRestore(stash.id)
                    setIsOpen(false)
                  }}
                  type="button"
                >
                  <span className="truncate text-sm">{label}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatRelativeTime(stash.createdAt)}
                  </span>
                </button>
                <button
                  aria-label={`Delete stashed draft ${label}`}
                  className="flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                  onClick={() => onRemove(stash.id)}
                  type="button"
                >
                  <X aria-hidden className="size-3" />
                </button>
              </div>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
