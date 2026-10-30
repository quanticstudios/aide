import { useSyncExternalStore } from 'react'

let wrap = false
let loaded = false
const listeners = new Set<() => void>()

function publish(next: boolean): void {
  wrap = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!loaded) {
    loaded = true
    window.aide?.getCodeWrap().then(publish, () => {
      loaded = false
    })
  }
  return () => listeners.delete(listener)
}

function setCodeWrap(next: boolean): void {
  publish(next)
  // why: a failed save only loses the choice across a relaunch.
  window.aide?.setCodeWrap(next).catch(() => undefined)
}

/** The soft-wrap choice every transcript code block shares; it persists per user. */
export function useCodeWrap(): readonly [boolean, (next: boolean) => void] {
  return [
    useSyncExternalStore(
      subscribe,
      () => wrap,
      () => wrap,
    ),
    setCodeWrap,
  ]
}
