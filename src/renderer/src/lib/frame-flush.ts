const pending = new Set<() => void>()
let isFrameRequested = false

function flushFrame(): void {
  isFrameRequested = false
  const flushes = [...pending]
  pending.clear()
  for (const flush of flushes) flush()
}

/**
 * Runs `flush` on the next animation frame together with every other pending flush, so React commits them as one update.
 * @returns A function that drops `flush` if it has not run yet.
 */
export function requestFrameFlush(flush: () => void): () => void {
  pending.add(flush)
  if (!isFrameRequested) {
    isFrameRequested = true
    requestAnimationFrame(flushFrame)
  }
  return () => {
    pending.delete(flush)
  }
}
