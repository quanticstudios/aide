import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestFrameFlush } from './frame-flush'

describe('requestFrameFlush', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('runs every flush requested before a frame in that one frame', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    const first = vi.fn()
    const second = vi.fn()
    requestFrameFlush(first)
    requestFrameFlush(second)
    requestFrameFlush(first)
    expect(frames).toHaveLength(1)

    frames[0]?.(0)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    requestFrameFlush(first)
    expect(frames).toHaveLength(2)
  })

  it('skips a cancelled flush', () => {
    const frames: FrameRequestCallback[] = []
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      frames.push(callback),
    )
    const flush = vi.fn()
    requestFrameFlush(flush)()
    frames[0]?.(0)
    expect(flush).not.toHaveBeenCalled()
  })
})
