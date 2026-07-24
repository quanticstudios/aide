import { describe, expect, it, vi } from 'vitest'

import { hydrateRevisionedState } from './revisioned-hydration'

interface Snapshot {
  revision: number
}

interface Event {
  revision: number
  snapshot: Snapshot
}

function reconcile(snapshot: Snapshot, events: readonly Event[]): Snapshot {
  return events.reduce(
    (current, event) =>
      event.revision > current.revision &&
      event.snapshot.revision === event.revision
        ? event.snapshot
        : current,
    snapshot,
  )
}

describe('hydrateRevisionedState', () => {
  it('subscribes before fetching and replays only newer buffered events', async () => {
    const calls: string[] = []
    let emit = (_event: Event): void => {
      throw new Error('listener not registered')
    }
    let resolveFetch = (_snapshot: Snapshot): void => {
      throw new Error('fetch not started')
    }
    const snapshots: Snapshot[] = []

    const cleanup = hydrateRevisionedState<Snapshot, Event>({
      fetchSnapshot: () => {
        calls.push('fetch')
        return new Promise((resolve) => {
          resolveFetch = resolve
        })
      },
      onError: vi.fn(),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      reconcile,
      subscribe: (listener) => {
        calls.push('subscribe')
        emit = listener
        return vi.fn()
      },
    })

    expect(calls).toEqual(['subscribe', 'fetch'])
    emit({ revision: 4, snapshot: { revision: 4 } })
    emit({ revision: 2, snapshot: { revision: 2 } })
    resolveFetch({ revision: 3 })
    await Promise.resolve()

    expect(snapshots).toEqual([{ revision: 4 }])
    cleanup()
  })

  it('ignores stale live events and stops delivering after cleanup', async () => {
    let emit = (_event: Event): void => {
      throw new Error('listener not registered')
    }
    const unsubscribe = vi.fn()
    const snapshots: Snapshot[] = []
    const cleanup = hydrateRevisionedState<Snapshot, Event>({
      fetchSnapshot: async () => ({ revision: 5 }),
      onError: vi.fn(),
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      reconcile,
      subscribe: (listener) => {
        emit = listener
        return unsubscribe
      },
    })
    await Promise.resolve()

    emit({ revision: 4, snapshot: { revision: 4 } })
    emit({ revision: 6, snapshot: { revision: 6 } })
    cleanup()
    emit({ revision: 7, snapshot: { revision: 7 } })

    expect(snapshots).toEqual([{ revision: 5 }, { revision: 6 }])
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('reports fetch failures without replaying buffered events', async () => {
    let emit = (_event: Event): void => {
      throw new Error('listener not registered')
    }
    const onError = vi.fn()
    const onSnapshot = vi.fn()
    const cleanup = hydrateRevisionedState<Snapshot, Event>({
      fetchSnapshot: async () => {
        throw new Error('offline')
      },
      onError,
      onSnapshot,
      reconcile,
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })
    emit({ revision: 2, snapshot: { revision: 2 } })
    await Promise.resolve()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'offline',
      }),
    )
    expect(onSnapshot).not.toHaveBeenCalled()
    cleanup()
  })

  it('retries with backoff and preserves buffered events through recovery', async () => {
    let emit = (_event: Event): void => {
      throw new Error('listener not registered')
    }
    const scheduled: Array<() => void> = []
    const onError = vi.fn()
    const snapshots: Snapshot[] = []
    let fetchCount = 0

    const cleanup = hydrateRevisionedState<Snapshot, Event>({
      fetchSnapshot: async () => {
        fetchCount += 1
        if (fetchCount < 3) throw new Error(`offline-${fetchCount}`)
        return { revision: 2 }
      },
      onError,
      onSnapshot: (snapshot) => snapshots.push(snapshot),
      reconcile,
      retryDelayMs: (attempt) => attempt * 100,
      setTimeout: (callback) => {
        scheduled.push(callback)
        return scheduled.length as unknown as ReturnType<typeof setTimeout>
      },
      subscribe: (listener) => {
        emit = listener
        return vi.fn()
      },
    })

    emit({ revision: 4, snapshot: { revision: 4 } })
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()
    await Promise.resolve()
    await Promise.resolve()
    expect(scheduled).toHaveLength(1)
    scheduled.shift()?.()
    await Promise.resolve()
    await Promise.resolve()

    expect(onError).toHaveBeenCalledTimes(2)
    expect(snapshots).toEqual([{ revision: 4 }])
    cleanup()
  })

  it('cancels a scheduled retry on cleanup', async () => {
    const clearTimeout = vi.fn()
    const unsubscribe = vi.fn()
    const cleanup = hydrateRevisionedState<Snapshot, Event>({
      clearTimeout,
      fetchSnapshot: async () => {
        throw new Error('offline')
      },
      onError: vi.fn(),
      onSnapshot: vi.fn(),
      reconcile,
      retryDelayMs: () => 100,
      setTimeout: () => 42 as unknown as ReturnType<typeof setTimeout>,
      subscribe: () => unsubscribe,
    })
    await Promise.resolve()
    await Promise.resolve()

    cleanup()

    expect(clearTimeout).toHaveBeenCalledWith(42)
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})
