export type SendWhileRunning = 'queue' | 'steer'

const STORAGE_KEY = 'aide.send-while-running'

/** What Enter does while a turn runs; Mod+Enter does the other. */
export function getSendWhileRunning(): SendWhileRunning {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'queue'
      ? 'queue'
      : 'steer'
  } catch {
    return 'steer'
  }
}

export function setSendWhileRunning(preference: SendWhileRunning): void {
  window.localStorage.setItem(STORAGE_KEY, preference)
}

/** True when this send should wait for the running turn to end instead of steering it. */
export function shouldQueueSend(
  preference: SendWhileRunning,
  isTurnRunning: boolean,
  isModPressed: boolean,
): boolean {
  return isTurnRunning && (preference === 'queue') !== isModPressed
}
