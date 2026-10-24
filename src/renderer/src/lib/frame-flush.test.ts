import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let frames: FrameRequestCallback[]

// why: the scheduler keeps module state, so each test loads a fresh copy.
async function loadScheduler() {
  vi.resetModules()
  return (await import('./frame-flush')).requestFrameFlush
}

describe('requestFrameFlush', () => {
  beforeEach(() => {
    frames = []
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('runs every flush requested before a frame in that one frame', async () => {
    const requestFrameFlush = await loadScheduler()
    const first = vi.fn()
    const second = vi.fn()
    requestFrameFlush(first)
    requestFrameFlush(second)
    requestFrameFlush(first)
    expect(frames).toHaveLength(1)

    frames[0]?.(0)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    vi.runAllTimers()
    expect(first).toHaveBeenCalledTimes(1)

    requestFrameFlush(first)
    expect(frames).toHaveLength(2)
  })

  it('flushes on the fallback timer when no frame comes', async () => {
    const requestFrameFlush = await loadScheduler()
    const flush = vi.fn()
    requestFrameFlush(flush)

    vi.advanceTimersByTime(99)
    expect(flush).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(flush).toHaveBeenCalledTimes(1)

    requestFrameFlush(flush)
    expect(frames).toHaveLength(2)
  })

  it('skips a cancelled flush', async () => {
    const requestFrameFlush = await loadScheduler()
    const flush = vi.fn()
    requestFrameFlush(flush)()
    expect(frames).toHaveLength(1)

    frames[0]?.(0)
    vi.runAllTimers()
    expect(flush).not.toHaveBeenCalled()
  })
})
