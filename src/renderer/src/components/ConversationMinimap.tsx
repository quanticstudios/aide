import { type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'
import type { TranscriptVirtualizer } from './transcript/TranscriptList'

const tickSpacing = 12

/** A user prompt the minimap can jump to, located by its transcript row. */
export interface MinimapAnchor {
  readonly prompt: string
  readonly reply: string
  readonly row: number
}

// why: off-screen rows are not mounted, so offsets come from the virtualizer's measured or estimated row starts.
function offsetOf(
  scroll: HTMLElement,
  virtualizer: TranscriptVirtualizer | null,
  anchor: MinimapAnchor | undefined,
): number {
  const list = scroll.firstElementChild
  const start = anchor && virtualizer?.measurementsCache[anchor.row]?.start
  return list instanceof HTMLElement && start !== undefined
    ? list.offsetTop + start
    : 0
}

export function ConversationMinimap({
  anchors,
  scrollRef,
  virtualizerRef,
}: {
  readonly anchors: readonly MinimapAnchor[]
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly virtualizerRef: RefObject<TranscriptVirtualizer | null>
}) {
  const previewId = useId()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const anchorsRef = useRef(anchors)
  const labels = anchors.map((_, index) => `${index + 1}. Your message`)
  const [position, setPosition] = useState({
    active: 0,
    height: 0,
    hasOverflow: false,
  })

  useLayoutEffect(() => {
    anchorsRef.current = anchors
  }, [anchors])

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new anchor changes the set of offsets to measure
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const rail = railRef.current
    if (!scroll || !rail) return
    let offsets: number[] = []
    let frame = 0
    const update = () => {
      const isAtBottom =
        scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop < 2
      let active = 0
      for (let index = 0; index < offsets.length; index++) {
        if (offsets[index] <= scroll.scrollTop + 80) active = index
        else break
      }
      if (isAtBottom) active = Math.max(0, anchorsRef.current.length - 1)
      const height = rail.clientHeight
      const hasOverflow = scroll.scrollHeight > scroll.clientHeight + 1
      setPosition((current) =>
        current.active === active &&
        current.height === height &&
        current.hasOverflow === hasOverflow
          ? current
          : { active, height, hasOverflow },
      )
    }
    const measure = () => {
      offsets = anchorsRef.current.map((anchor) =>
        offsetOf(scroll, virtualizerRef.current, anchor),
      )
      update()
    }
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const observer = new ResizeObserver(measure)
    const enableMotion = () => rail.removeAttribute('data-keyboard-navigation')
    observer.observe(scroll)
    observer.observe(rail)
    if (scroll.firstElementChild) observer.observe(scroll.firstElementChild)
    scroll.addEventListener('scroll', onScroll, { passive: true })
    scroll.addEventListener('wheel', enableMotion, { passive: true })
    scroll.addEventListener('pointerdown', enableMotion)
    measure()
    return () => {
      observer.disconnect()
      scroll.removeEventListener('scroll', onScroll)
      scroll.removeEventListener('wheel', enableMotion)
      scroll.removeEventListener('pointerdown', enableMotion)
      cancelAnimationFrame(frame)
    }
  }, [scrollRef, virtualizerRef, anchors.length])

  const navigate = (index: number, isKeyboard: boolean) => {
    const scroll = scrollRef.current
    const anchor = anchors[index]
    if (!scroll || !anchor) return
    railRef.current?.setAttribute(
      'data-keyboard-navigation',
      String(isKeyboard),
    )
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    scroll.scrollTo({
      top: offsetOf(scroll, virtualizerRef.current, anchor) - 16,
      behavior: isKeyboard || prefersReducedMotion ? 'instant' : 'smooth',
    })
    if (isKeyboard)
      railRef.current
        ?.querySelectorAll('button')
        [index]?.focus({ preventScroll: true })
  }
  const shift = Math.min(
    Math.max(
      0,
      position.active * tickSpacing - position.height / 2 + tickSpacing / 2,
    ),
    Math.max(0, labels.length * tickSpacing - position.height + 24),
  )
  const trackOffset = Math.round(
    Math.max(12, (position.height - labels.length * tickSpacing) / 2) - shift,
  )
  const highlightedIndex = hoveredIndex ?? position.active
  const isVisible = position.hasOverflow && labels.length > 1
  const hoveredAnchor =
    hoveredIndex === null ? undefined : anchors[hoveredIndex]
  const previewPrompt = hoveredAnchor?.prompt.trim() ?? ''
  const previewReply = hoveredAnchor?.reply.trim() ?? ''

  return (
    <nav
      aria-label="Conversation minimap"
      aria-hidden={!isVisible}
      className="conversation-minimap"
      style={{ visibility: isVisible ? 'visible' : 'hidden' }}
      ref={railRef}
      onPointerLeave={() => setHoveredIndex(null)}
    >
      <div className="conversation-minimap-viewport">
        <div
          className="conversation-minimap-track"
          style={{ transform: `translateY(${trackOffset}px)` }}
        >
          {labels.map((label, index) => (
            <button
              aria-label={`Go to message ${label}`}
              aria-current={index === position.active ? 'location' : undefined}
              className="conversation-minimap-tick"
              key={label}
              onClick={(event) => navigate(index, event.detail === 0)}
              onKeyDown={(event) => {
                const target =
                  event.key === 'ArrowDown'
                    ? Math.min(labels.length - 1, index + 1)
                    : event.key === 'ArrowUp'
                      ? Math.max(0, index - 1)
                      : event.key === 'Home'
                        ? 0
                        : event.key === 'End'
                          ? labels.length - 1
                          : null
                if (target === null) return
                event.preventDefault()
                navigate(target, true)
              }}
              tabIndex={isVisible && index === position.active ? 0 : -1}
              aria-describedby={hoveredIndex === index ? previewId : undefined}
              onPointerEnter={(event) => {
                if (event.pointerType === 'mouse') setHoveredIndex(index)
              }}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              type="button"
            >
              <span
                style={{
                  transform: `scaleX(${hoveredIndex === null ? 1 : ([4.3, 3.3, 2.3, 1.5, 1.1][Math.abs(index - highlightedIndex)] ?? 1)})`,
                  opacity:
                    index === highlightedIndex
                      ? 1
                      : Math.abs(index - highlightedIndex) < 3
                        ? 0.55
                        : 0.3,
                  background:
                    index === highlightedIndex
                      ? 'var(--foreground)'
                      : 'var(--muted-foreground)',
                }}
              />
            </button>
          ))}
        </div>
      </div>
      {hoveredIndex !== null && labels[hoveredIndex] ? (
        <div
          className="conversation-minimap-preview"
          id={previewId}
          role="tooltip"
          style={{
            transform: `translateY(${Math.max(56, Math.min(position.height - 56, hoveredIndex * tickSpacing + trackOffset + tickSpacing / 2))}px) translateY(-50%)`,
          }}
        >
          <div className="conversation-minimap-preview-label">
            {previewPrompt || labels[hoveredIndex]}
          </div>
          <div className="conversation-minimap-preview-text">
            {previewReply.slice(0, 400) || 'No reply yet'}
          </div>
        </div>
      ) : null}
    </nav>
  )
}
