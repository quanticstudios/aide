import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react'
import type { TranscriptRow } from '../../lib/transcript-rows'

export type TranscriptVirtualizer = Virtualizer<HTMLDivElement, Element>

/** Renders only the transcript rows near the viewport of `scrollRef`, measuring each row as it mounts. */
export default function TranscriptList({
  renderRow,
  rows,
  scrollRef,
  sessionId,
  virtualizerRef,
}: {
  readonly renderRow: (row: TranscriptRow) => ReactNode
  readonly rows: readonly TranscriptRow[]
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly sessionId: string
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
  const virtualRows = virtualizer.getVirtualItems()
  const lastMountedIndex = virtualRows.at(-1)?.index
  const isOpenMeasuredRef = useRef(false)

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer
  }, [virtualizer, virtualizerRef])

  // why: a reader opening a session waits for its newest row, so the open measure ends on the frame that row first paints.
  useLayoutEffect(() => {
    if (isOpenMeasuredRef.current || lastMountedIndex !== rows.length - 1)
      return
    isOpenMeasuredRef.current = true
    const start = `transcript-open-start:${sessionId}`
    if (performance.getEntriesByName(start).length === 0) return
    requestAnimationFrame(() => {
      performance.measure(`transcript-open:${sessionId}`, start)
      performance.clearMarks(start)
    })
  }, [lastMountedIndex, rows.length, sessionId])

  return (
    <div className="relative mx-auto max-w-3xl" style={{ height: totalSize }}>
      {virtualRows.map((virtualRow) => {
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
