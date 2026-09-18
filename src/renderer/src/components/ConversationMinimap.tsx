import { type RefObject, useLayoutEffect, useRef, useState } from 'react'

const tickSpacing = 12

export function ConversationMinimap({
  scrollRef,
  contentLength,
}: {
  readonly scrollRef: RefObject<HTMLDivElement | null>
  readonly contentLength: number
}) {
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
      scroll.querySelectorAll<HTMLElement>('[data-minimap-message]'),
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
          message.getBoundingClientRect().top - top + scroll.scrollTop,
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
        message.getBoundingClientRect().top -
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
  const isVisible = position.hasOverflow && labels.length > 1

  return (
    <nav
      aria-label="Conversation minimap"
      aria-hidden={!isVisible}
      className="conversation-minimap"
      style={{ visibility: isVisible ? 'visible' : 'hidden' }}
      ref={railRef}
    >
      <div
        className="conversation-minimap-track"
        style={{ transform: `translateY(${12 - shift}px)` }}
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
            title={label}
            type="button"
          >
            <span />
          </button>
        ))}
      </div>
      <span
        aria-hidden="true"
        className="conversation-minimap-position"
        style={{
          transform: `translateY(${position.active * tickSpacing + 17 - shift}px)`,
        }}
      />
    </nav>
  )
}
