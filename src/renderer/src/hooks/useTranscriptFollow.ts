import { type RefObject, useCallback, useEffect, useRef, useState } from 'react'

const FOLLOW_THRESHOLD_PX = 40
const JUMP_BUTTON_DELAY_MS = 150
const PIN_OFFSET_PX = 16

function distanceFromBottom(scroll: HTMLElement): number {
  return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
}

function lastMatch(content: HTMLElement, selector: string): Element | null {
  const matches = content.querySelectorAll(selector)
  return matches[matches.length - 1] ?? null
}

/**
 * Trailing space the content needs so `pinTop` can reach the top of the viewport; 0 once the content is tall enough.
 */
export function pinSpacerHeight({
  clientHeight,
  contentEnd,
  pinTop,
}: {
  readonly clientHeight: number
  readonly contentEnd: number
  readonly pinTop: number
}): number {
  return Math.max(0, Math.ceil(pinTop + clientHeight - contentEnd))
}

interface PinState {
  active: boolean
  pending: { readonly previous: Element | null } | null
  spacer: number
}

interface SpacedContent {
  readonly style: { paddingBottom: string }
}

function setTrailingSpace(
  pin: PinState,
  content: SpacedContent,
  height: number,
): void {
  pin.spacer = height
  content.style.paddingBottom = height > 0 ? `${height}px` : ''
}

/**
 * Drops a pending or active pin and removes the trailing space it added.
 */
export function releasePin(pin: PinState, content: SpacedContent | null): void {
  pin.pending = null
  pin.active = false
  if (content) setTrailingSpace(pin, content, 0)
}

/**
 * Scrolls to the real bottom of the transcript, dropping any pin and its trailing space first.
 */
export function jumpToLatest(
  pin: PinState,
  content: SpacedContent | null,
  scroll: { scrollTop: number; readonly scrollHeight: number },
): void {
  releasePin(pin, content)
  scroll.scrollTop = scroll.scrollHeight
}

/**
 * Keeps a transcript at the bottom while the reader stays near it, even as one item's text grows.
 */
export function useTranscriptFollow({
  contentRef,
  pinSelector,
  scrollRef,
  sessionId,
}: {
  readonly contentRef: RefObject<HTMLElement | null>
  readonly pinSelector: string
  readonly scrollRef: RefObject<HTMLElement | null>
  readonly sessionId: string
}): {
  readonly pinNextMessage: () => void
  readonly scrollToLatest: () => void
  readonly showScrollToLatest: boolean
} {
  const [showScrollToLatest, setShowScrollToLatest] = useState(false)
  const [observedContent, setObservedContent] = useState<HTMLElement | null>(
    null,
  )
  const followingRef = useRef(true)
  const lastScrollTopRef = useRef(0)
  const jumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinRef = useRef<PinState>({ active: false, pending: null, spacer: 0 })
  const sessionIdRef = useRef(sessionId)
  const showScrollToLatestRef = useRef(false)

  // why: React renders the pane once to bail out of a same-value update right after a commit, and this runs on every scroll and resize.
  const setJumpButton = useCallback((show: boolean) => {
    if (showScrollToLatestRef.current === show) return
    showScrollToLatestRef.current = show
    setShowScrollToLatest(show)
  }, [])

  const updateJumpButton = useCallback(
    (scroll: HTMLElement) => {
      if (distanceFromBottom(scroll) <= FOLLOW_THRESHOLD_PX) {
        if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current)
        jumpTimerRef.current = null
        setJumpButton(false)
        return
      }
      if (jumpTimerRef.current !== null) return
      jumpTimerRef.current = setTimeout(() => {
        jumpTimerRef.current = null
        if (distanceFromBottom(scroll) > FOLLOW_THRESHOLD_PX) {
          setJumpButton(true)
        }
      }, JUMP_BUTTON_DELAY_MS)
    },
    [setJumpButton],
  )

  // why: the content element mounts and unmounts with the empty state, so the observer tracks whichever element the ref holds.
  useEffect(() => {
    if (contentRef.current !== observedContent) {
      setObservedContent(contentRef.current)
    }
  })

  useEffect(() => {
    if (sessionIdRef.current === sessionId) return
    sessionIdRef.current = sessionId
    followingRef.current = true
    releasePin(pinRef.current, contentRef.current)
    const scroll = scrollRef.current
    if (scroll) {
      scroll.scrollTop = scroll.scrollHeight
      updateJumpButton(scroll)
    }
  }, [contentRef, scrollRef, sessionId, updateJumpButton])

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return

    const pin = pinRef.current
    const settle = () => {
      const pending = pin.pending
      // why: a turn's group remounts when it gets its turn id, so the pinned message is looked up again on every pass.
      const latest =
        (pending || pin.active) && observedContent
          ? lastMatch(observedContent, pinSelector)
          : null
      if (pending && latest && latest !== pending.previous) {
        pin.pending = null
        pin.active = true
        followingRef.current = true
      }

      if (pin.active && observedContent) {
        let spacer = 0
        if (latest) {
          const scrollTop = scroll.scrollTop
          const scrollRect = scroll.getBoundingClientRect()
          const pinTop =
            latest.getBoundingClientRect().top -
            scrollRect.top +
            scrollTop -
            PIN_OFFSET_PX
          const contentEnd =
            observedContent.getBoundingClientRect().bottom -
            scrollRect.top +
            scrollTop -
            pin.spacer +
            Number.parseFloat(getComputedStyle(scroll).paddingBottom)
          spacer = pinSpacerHeight({
            clientHeight: scroll.clientHeight,
            contentEnd,
            pinTop,
          })
          setTrailingSpace(pin, observedContent, spacer)
          if (spacer > 0 && followingRef.current) scroll.scrollTop = pinTop
        }
        if (spacer === 0) releasePin(pin, observedContent)
      }

      if (!pin.active && followingRef.current) {
        scroll.scrollTop = scroll.scrollHeight
      }
      updateJumpButton(scroll)
    }

    const unfollow = () => {
      followingRef.current = false
      releasePin(pin, observedContent)
    }
    const handleScroll = () => {
      const movedUp = scroll.scrollTop < lastScrollTopRef.current
      const distance = distanceFromBottom(scroll)
      lastScrollTopRef.current = scroll.scrollTop
      // why: content growth never moves scrollTop, so only a real upward scroll (minimap, arrow keys) unfollows here.
      if (movedUp && distance > FOLLOW_THRESHOLD_PX) unfollow()
      else if (!movedUp && distance <= FOLLOW_THRESHOLD_PX) {
        followingRef.current = true
      }
      updateJumpButton(scroll)
    }
    const handleWheel = (event: WheelEvent) => {
      if (event.deltaY < 0) unfollow()
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'PageUp' || event.key === 'Home') unfollow()
    }
    const handlePointerDown = (event: PointerEvent) => {
      // why: clientWidth excludes the scrollbar, so a press past it grabs the scrollbar.
      if (event.target === scroll && event.offsetX >= scroll.clientWidth) {
        unfollow()
      }
    }

    const observer = new ResizeObserver(settle)
    observer.observe(scroll)
    if (observedContent) observer.observe(observedContent)
    scroll.addEventListener('scroll', handleScroll, { passive: true })
    scroll.addEventListener('wheel', handleWheel, { passive: true })
    scroll.addEventListener('keydown', handleKeyDown)
    scroll.addEventListener('pointerdown', handlePointerDown)
    return () => {
      observer.disconnect()
      scroll.removeEventListener('scroll', handleScroll)
      scroll.removeEventListener('wheel', handleWheel)
      scroll.removeEventListener('keydown', handleKeyDown)
      scroll.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [observedContent, pinSelector, scrollRef, updateJumpButton])

  useEffect(
    () => () => {
      if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current)
    },
    [],
  )

  const pinNextMessage = useCallback(() => {
    const content = contentRef.current
    pinRef.current.pending = {
      previous: content ? lastMatch(content, pinSelector) : null,
    }
  }, [contentRef, pinSelector])

  const scrollToLatest = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    followingRef.current = true
    jumpToLatest(pinRef.current, contentRef.current, scroll)
    updateJumpButton(scroll)
  }, [contentRef, scrollRef, updateJumpButton])

  return { pinNextMessage, scrollToLatest, showScrollToLatest }
}
