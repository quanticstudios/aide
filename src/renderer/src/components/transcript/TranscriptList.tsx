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
  // why: a streaming row re-measures and scrolls every frame, so sizes and offsets go to the DOM and only a changed visible range re-renders.
  // see: patches/@tanstack%2Freact-virtual@3.14.20.patch — the patch that stops `isScrolling` flips from re-rendering.
  const virtualizer = useVirtualizer({
    count: rows.length,
    directDomUpdates: true,
    estimateSize: (index) => 80 + 40 * (rows[index]?.items.length ?? 0),
    getItemKey: (index) => rows[index]?.key ?? index,
    getScrollElement: () => scrollRef.current,
    overscan: 3,
  })
  const virtualRows = virtualizer.getVirtualItems()
  const lastMountedIndex = virtualRows.at(-1)?.index
  const isOpenMeasuredRef = useRef(false)

  useLayoutEffect(() => {
    virtualizerRef.current = virtualizer
  }, [virtualizer, virtualizerRef])

  // why: a reader opening a session waits for its newest row, so the open measure ends once the frame that first shows that row has painted.
  useLayoutEffect(() => {
    if (isOpenMeasuredRef.current || lastMountedIndex !== rows.length - 1)
      return
    const start = `transcript-open-start:${sessionId}`
    if (performance.getEntriesByName(start).length === 0) {
      isOpenMeasuredRef.current = true
      return
    }
    let timeout: ReturnType<typeof setTimeout> | undefined
    // why: a frame callback runs before that frame paints, so the timeout it schedules runs after the paint.
    const frame = requestAnimationFrame(() => {
      timeout = setTimeout(() => {
        isOpenMeasuredRef.current = true
        performance.measure(`transcript-open:${sessionId}`, start)
        performance.clearMarks(start)
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(timeout)
    }
  }, [lastMountedIndex, rows.length, sessionId])

  return (
    <div className="relative mx-auto max-w-3xl" ref={virtualizer.containerRef}>
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index]
        return row ? (
          <div
            className="absolute inset-x-0 top-0 pb-8"
            data-index={virtualRow.index}
            key={virtualRow.key}
            ref={virtualizer.measureElement}
          >
            {renderRow(row)}
          </div>
        ) : null
      })}
    </div>
  )
}
