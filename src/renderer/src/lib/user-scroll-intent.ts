const scrollKeys = new Set([
  ' ',
  'ArrowDown',
  'ArrowUp',
  'End',
  'Home',
  'PageDown',
  'PageUp',
])

/** Calls `onIntent` once when the reader scrolls `scroll` by wheel, scroll key or pointer; returns a function that stops listening. */
export function onUserScrollIntent(
  scroll: HTMLElement,
  onIntent: () => void,
): () => void {
  const controller = new AbortController()
  const options = { passive: true, signal: controller.signal }
  const fire = () => {
    controller.abort()
    onIntent()
  }
  scroll.addEventListener('wheel', fire, options)
  scroll.addEventListener('pointerdown', fire, options)
  scroll.addEventListener(
    'keydown',
    (event) => {
      if (scrollKeys.has(event.key)) fire()
    },
    options,
  )
  return () => controller.abort()
}
