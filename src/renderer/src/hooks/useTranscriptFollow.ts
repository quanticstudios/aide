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
 * Keeps a transcript at the bottom while the reader stays near it, even as one item's text grows.
 */
export function useTranscriptFollow({
  contentRef,
  pinSelector,
  scrollRef,
}: {
  readonly contentRef: RefObject<HTMLElement | null>
  readonly pinSelector: string
  readonly scrollRef: RefObject<HTMLElement | null>
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
  const pendingPinRef = useRef<{ readonly previous: Element | null } | null>(
    null,
  )

  const updateJumpButton = useCallback((scroll: HTMLElement) => {
    if (distanceFromBottom(scroll) <= FOLLOW_THRESHOLD_PX) {
      if (jumpTimerRef.current !== null) clearTimeout(jumpTimerRef.current)
      jumpTimerRef.current = null
      setShowScrollToLatest(false)
      return
    }
    if (jumpTimerRef.current !== null) return
    jumpTimerRef.current = setTimeout(() => {
      jumpTimerRef.current = null
      if (distanceFromBottom(scroll) > FOLLOW_THRESHOLD_PX) {
        setShowScrollToLatest(true)
      }
    }, JUMP_BUTTON_DELAY_MS)
  }, [])

  // why: the content element mounts and unmounts with the empty state, so the observer tracks whichever element the ref holds.
  useEffect(() => {
    if (contentRef.current !== observedContent) {
      setObservedContent(contentRef.current)
    }
  })

  useEffect(() => {
    const scroll = scrollRef.current
    if (!scroll) return

    const settle = () => {
      const pending = pendingPinRef.current
      const latest =
        pending && observedContent
          ? lastMatch(observedContent, pinSelector)
          : null
      if (pending && latest && latest !== pending.previous) {
        pendingPinRef.current = null
        scroll.scrollTop =
          latest.getBoundingClientRect().top -
          scroll.getBoundingClientRect().top +
          scroll.scrollTop -
          PIN_OFFSET_PX
        followingRef.current = distanceFromBottom(scroll) <= FOLLOW_THRESHOLD_PX
      } else if (followingRef.current) {
        scroll.scrollTop = scroll.scrollHeight
      }
      updateJumpButton(scroll)
    }

    const unfollow = () => {
      followingRef.current = false
      pendingPinRef.current = null
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
    pendingPinRef.current = {
      previous: content ? lastMatch(content, pinSelector) : null,
    }
  }, [contentRef, pinSelector])

  const scrollToLatest = useCallback(() => {
    const scroll = scrollRef.current
    if (!scroll) return
    followingRef.current = true
    scroll.scrollTop = scroll.scrollHeight
    updateJumpButton(scroll)
  }, [scrollRef, updateJumpButton])

  return { pinNextMessage, scrollToLatest, showScrollToLatest }
}
