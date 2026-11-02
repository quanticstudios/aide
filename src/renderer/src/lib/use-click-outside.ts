import type { RefObject } from 'react'
import { useEffect } from 'react'

/** Calls onClose when a pointer press lands outside the referenced element, or on Escape. */
export function useClickOutside(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      onClose()
    }

    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', handleKey)
    }
  }, [active, onClose, ref])
}
