import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { type ReactNode, type RefObject, useLayoutEffect } from 'react'
import type { TranscriptRow } from '../../lib/transcript-rows'

export type TranscriptVirtualizer = Virtualizer<HTMLDivElement, Element>

/** Renders only the transcript rows near the viewport of `scrollRef`, measuring each row as it mounts. */
export default function TranscriptList({
  renderRow,
  rows,
  scrollRef,
  virtualizerRef,
}: {
  readonly renderRow: (row: TranscriptRow) => ReactNode
  readonly rows: readonly TranscriptRow[]
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly virtualizerRef: RefObject<TranscriptVirtualizer | null>
}) {
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: (index) => 80 + 40 * (rows[index]?.items.length ?? 0),
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 3,
  })
  const totalSize = virtualizer.getTotalSize()

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer
  }, [virtualizer, virtualizerRef])

  return (
    <div className="relative mx-auto max-w-3xl" style={{ height: totalSize }}>
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const row = rows[virtualRow.index]
        return row ? (
          <div
            className="absolute inset-x-0 top-0 pb-8"
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            {renderRow(row)}
          </div>
        ) : null
      })}
    </div>
  )
}
