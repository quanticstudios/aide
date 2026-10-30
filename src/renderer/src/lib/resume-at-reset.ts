/** The longest single wait, so a laptop that slept past the reset still sends soon after it wakes. */
export const RESUME_CHECK_INTERVAL_MS = 60_000

export type ResumeStep =
  | { kind: 'wait'; delayMs: number }
  | { kind: 'send' }
  | { kind: 'skip' }

/** Decides what an armed "Resume at reset" does at `now`; all times are epoch ms. */
export function nextResumeStep(
  plan: { armedAt: number; resetsAt: number; lastTypedAt: number | null },
  now: number,
): ResumeStep {
  if (plan.lastTypedAt !== null && plan.lastTypedAt >= plan.armedAt) {
    return { kind: 'skip' }
  }
  if (now >= plan.resetsAt) return { kind: 'send' }
  return {
    delayMs: Math.min(plan.resetsAt - now, RESUME_CHECK_INTERVAL_MS),
    kind: 'wait',
  }
}

/**
 * Calls `onSend` once at `resetsAt`, or `onSkip` instead when the user typed after arming.
 * @returns a cancel function that stops both.
 */
export function scheduleResumeAtReset(options: {
  armedAt: number
  resetsAt: number
  getLastTypedAt: () => number | null
  onSend: () => void
  onSkip: () => void
}): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const check = (): void => {
    const step = nextResumeStep(
      {
        armedAt: options.armedAt,
        lastTypedAt: options.getLastTypedAt(),
        resetsAt: options.resetsAt,
      },
      Date.now(),
    )
    if (step.kind === 'wait') timer = setTimeout(check, step.delayMs)
    else if (step.kind === 'send') options.onSend()
    else options.onSkip()
  }
  check()
  return () => clearTimeout(timer)
}

/** Formats a reset time in the viewer's local time, with the weekday when it is not today. */
export function formatResetTime(resetsAt: string, now: Date): string {
  const reset = new Date(resetsAt)
  const time = reset.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
  return reset.toDateString() === now.toDateString()
    ? time
    : `${reset.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
}
