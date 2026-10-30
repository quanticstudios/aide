import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  formatResetTime,
  nextResumeStep,
  RESUME_CHECK_INTERVAL_MS,
  scheduleResumeAtReset,
} from './resume-at-reset'

const ARMED_AT = Date.parse('2026-10-23T12:00:00.000Z')
const RESETS_AT = Date.parse('2026-10-23T15:00:00.000Z')

describe('nextResumeStep', () => {
  const plan = { armedAt: ARMED_AT, lastTypedAt: null, resetsAt: RESETS_AT }

  it('waits in steps no longer than the check interval', () => {
    expect(nextResumeStep(plan, ARMED_AT)).toEqual({
      delayMs: RESUME_CHECK_INTERVAL_MS,
      kind: 'wait',
    })
    expect(nextResumeStep(plan, RESETS_AT - 5_000)).toEqual({
      delayMs: 5_000,
      kind: 'wait',
    })
  })

  it('sends at or after the reset', () => {
    expect(nextResumeStep(plan, RESETS_AT)).toEqual({ kind: 'send' })
    expect(nextResumeStep(plan, RESETS_AT + 3_600_000)).toEqual({
      kind: 'send',
    })
  })

  it('skips when the user typed after arming, but not before', () => {
    expect(
      nextResumeStep({ ...plan, lastTypedAt: ARMED_AT + 1 }, RESETS_AT),
    ).toEqual({ kind: 'skip' })
    expect(
      nextResumeStep({ ...plan, lastTypedAt: ARMED_AT - 1 }, RESETS_AT),
    ).toEqual({ kind: 'send' })
  })
})

describe('scheduleResumeAtReset', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(ARMED_AT)
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function schedule(getLastTypedAt: () => number | null = () => null) {
    const onSend = vi.fn()
    const onSkip = vi.fn()
    const cancel = scheduleResumeAtReset({
      armedAt: ARMED_AT,
      getLastTypedAt,
      onSend,
      onSkip,
      resetsAt: RESETS_AT,
    })
    return { cancel, onSend, onSkip }
  }

  it('sends once at the reset time', () => {
    const { onSend, onSkip } = schedule()

    vi.advanceTimersByTime(RESETS_AT - ARMED_AT - 1)
    expect(onSend).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onSend).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(RESETS_AT - ARMED_AT)
    expect(onSend).toHaveBeenCalledTimes(1)
    expect(onSkip).not.toHaveBeenCalled()
  })

  it('sends right away when the reset passed while the machine slept', () => {
    const { onSend } = schedule()

    vi.setSystemTime(RESETS_AT + 60_000)
    vi.advanceTimersByTime(RESUME_CHECK_INTERVAL_MS)
    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('skips instead of sending when the user typed since arming', () => {
    let lastTypedAt: number | null = null
    const { onSend, onSkip } = schedule(() => lastTypedAt)

    vi.advanceTimersByTime(30 * 60_000)
    lastTypedAt = Date.now()
    vi.advanceTimersByTime(RESETS_AT - ARMED_AT)
    expect(onSend).not.toHaveBeenCalled()
    expect(onSkip).toHaveBeenCalledTimes(1)
  })

  it('sends nothing after it is cancelled', () => {
    const { cancel, onSend, onSkip } = schedule()

    cancel()
    vi.advanceTimersByTime(RESETS_AT - ARMED_AT)
    expect(onSend).not.toHaveBeenCalled()
    expect(onSkip).not.toHaveBeenCalled()
  })
})

describe('formatResetTime', () => {
  it('adds the weekday only when the reset is not today', () => {
    const today = new Date(RESETS_AT)
    const time = today.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    })
    expect(formatResetTime(new Date(RESETS_AT).toISOString(), today)).toBe(time)
    expect(
      formatResetTime(
        new Date(RESETS_AT).toISOString(),
        new Date(RESETS_AT - 3 * 86_400_000),
      ),
    ).toMatch(new RegExp(`^\\S+ ${time}$`))
  })
})
