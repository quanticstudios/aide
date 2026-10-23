// why: hidden or throttled windows pause animation frames, so a timer still lands updates such as a finished turn.
const FALLBACK_FLUSH_MS = 100

const pending = new Set<() => void>()
let frame: number | null = null
let fallback: ReturnType<typeof setTimeout> | null = null

function flushPending(): void {
  if (frame !== null) cancelAnimationFrame(frame)
  if (fallback !== null) clearTimeout(fallback)
  frame = null
  fallback = null
  const flushes = [...pending]
  pending.clear()
  for (const flush of flushes) flush()
}

/**
 * Runs `flush` on the next animation frame together with every other pending flush, so React commits them as one update.
 * @remarks Runs after `FALLBACK_FLUSH_MS` instead when no frame comes first.
 * @returns A function that drops `flush` if it has not run yet.
 */
export function requestFrameFlush(flush: () => void): () => void {
  pending.add(flush)
  if (frame === null) {
    frame = requestAnimationFrame(flushPending)
    fallback = setTimeout(flushPending, FALLBACK_FLUSH_MS)
  }
  return () => {
    pending.delete(flush)
  }
}
