import { describe, expect, it } from 'vitest'

import { shouldQueueSend } from './send-while-running'

describe('shouldQueueSend', () => {
  it('queues on Enter and steers on Mod+Enter when queue is the default', () => {
    expect(shouldQueueSend('queue', true, false)).toBe(true)
    expect(shouldQueueSend('queue', true, true)).toBe(false)
  })

  it('steers on Enter and queues on Mod+Enter when steer is the default', () => {
    expect(shouldQueueSend('steer', true, false)).toBe(false)
    expect(shouldQueueSend('steer', true, true)).toBe(true)
  })

  it('never queues when no turn runs', () => {
    expect(shouldQueueSend('queue', false, false)).toBe(false)
    expect(shouldQueueSend('steer', false, true)).toBe(false)
  })
})
