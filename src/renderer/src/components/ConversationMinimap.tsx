import { type RefObject, useId, useLayoutEffect, useRef, useState } from 'react'

const tickSpacing = 12
const minimapMessageSelector = '[data-minimap-message="Your message"]'

// why: turns skip layout off screen, and reading a rect inside one forces it; the turn box itself stays measurable.
function anchorOf(message: HTMLElement): HTMLElement {
  const turn = message.closest<HTMLElement>('.chat-turn')
  // why: a steered follow-up sits lower in its turn, so only the turn's first prompt can stand in for it.
  return turn?.querySelector(minimapMessageSelector) === message
    ? turn
    : message
}

export function ConversationMinimap({
  scrollRef,
  contentLength,
}: {
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly contentLength: number
}) {
  const previewId = useId()
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const railRef = useRef<HTMLElement>(null)
  const messagesRef = useRef<HTMLElement[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [position, setPosition] = useState({
    active: 0,
    height: 0,
    hasOverflow: false,
  })

  // biome-ignore lint/correctness/useExhaustiveDependencies: new content changes the set of message anchors
  useLayoutEffect(() => {
    const scroll = scrollRef.current
    const rail = railRef.current
    if (!scroll || !rail) return
    const messages = Array.from(
      scroll.querySelectorAll<HTMLElement>(minimapMessageSelector),
    )
    messagesRef.current = messages
    setLabels(
      messages.map(
        (message, index) => `${index + 1}. ${message.dataset.minimapMessage}`,
      ),
    )
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
      if (isAtBottom) active = Math.max(0, messages.length - 1)
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
      const top = scroll.getBoundingClientRect().top
      offsets = messages.map(
        (message) =>
          anchorOf(message).getBoundingClientRect().top -
          top +
          scroll.scrollTop,
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
  }, [scrollRef, contentLength])

  const navigate = (index: number, isKeyboard: boolean) => {
    const scroll = scrollRef.current
    const message = messagesRef.current[index]
    if (!scroll || !message) return
    railRef.current?.setAttribute(
      'data-keyboard-navigation',
      String(isKeyboard),
    )
    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    scroll.scrollTo({
      top:
        anchorOf(message).getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        scroll.scrollTop -
        16,
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
  const readPreview = (message: HTMLElement | undefined) =>
    (
      message?.querySelector<HTMLElement>('pre, .prose')?.innerText ??
      message?.innerText ??
      ''
    ).trim()
  const prompt =
    hoveredIndex === null ? undefined : messagesRef.current[hoveredIndex]
  const previewPrompt = readPreview(prompt)
  const reply = prompt
    ?.closest('.chat-turn')
    ?.querySelectorAll<HTMLElement>('[data-minimap-message="Agent response"]')
  const previewReply = readPreview(reply?.[reply.length - 1])

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
