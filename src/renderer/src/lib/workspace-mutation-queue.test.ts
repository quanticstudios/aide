import { describe, expect, it, vi } from 'vitest'

import { WorkspaceMutationQueue } from './workspace-mutation-queue'

describe('WorkspaceMutationQueue', () => {
  it('serializes mutations for the same workspace', async () => {
    const queue = new WorkspaceMutationQueue()
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const events: string[] = []

    const firstMutation = queue.enqueue('workspace-1', async () => {
      events.push('first:start')
      await first
      events.push('first:finish')
    })
    const secondMutation = queue.enqueue('workspace-1', async () => {
      events.push('second:start')
      events.push('second:finish')
    })

    await vi.waitFor(() => expect(events).toEqual(['first:start']))
    releaseFirst()
    await Promise.all([firstMutation, secondMutation])

    expect(events).toEqual([
      'first:start',
      'first:finish',
      'second:start',
      'second:finish',
    ])
  })

  it('does not block another workspace', async () => {
    const queue = new WorkspaceMutationQueue()
    let releaseFirst!: () => void
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const events: string[] = []

    const blocked = queue.enqueue('workspace-1', async () => {
      await first
      events.push('workspace-1')
    })
    const unblocked = queue.enqueue('workspace-2', async () => {
      events.push('workspace-2')
    })

    await unblocked
    expect(events).toEqual(['workspace-2'])
    releaseFirst()
    await blocked
  })
})
