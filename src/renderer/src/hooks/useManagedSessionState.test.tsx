// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'
import type { ManagedSessionUpdate } from '../lib/managed-session-events'
import {
  type SessionTransport,
  setSessionTransport,
} from '../lib/session-transport'
import {
  useManagedSessionState,
  useManagedSessionTitle,
} from './useManagedSessionState'

function snapshot(
  revision: number,
  sessionState: ManagedProviderRuntimeSessionState,
): ManagedSessionSnapshot {
  return {
    revision,
    runtimeGeneration: 1,
    sessionId: 'session-1',
    sessionState,
  } as ManagedSessionSnapshot
}

/** A transport that serves one stored snapshot and lets the test push updates. */
function createFakeTransport(stored: ManagedSessionSnapshot) {
  let push: (update: ManagedSessionUpdate) => void = () => {}
  const unsubscribe = vi.fn()
  const transport = {
    getSessions: async () => ({ [stored.sessionId]: stored }),
    subscribeSession: (
      _sessionId: string,
      listener: (update: ManagedSessionUpdate) => void,
    ) => {
      push = listener
      return unsubscribe
    },
  } as unknown as SessionTransport
  return {
    push: (update: ManagedSessionUpdate) => push(update),
    transport,
    unsubscribe,
  }
}

afterEach(() => setSessionTransport(null))

describe('useManagedSessionState', () => {
  it('follows the snapshots its transport delivers', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const fake = createFakeTransport(snapshot(1, 'ready'))
    setSessionTransport(fake.transport)
    const seen: (ManagedProviderRuntimeSessionState | null)[] = []
    function Probe() {
      seen.push(useManagedSessionState('session-1'))
      return null
    }
    const root = createRoot(document.createElement('div'))

    await act(async () => root.render(<Probe />))
    expect(seen.at(-1)).toBe('ready')

    act(() => fake.push({ snapshot: snapshot(2, 'running'), type: 'snapshot' }))
    expect(seen.at(-1)).toBe('running')

    // A stale revision must not roll the state back.
    act(() => fake.push({ snapshot: snapshot(1, 'ready'), type: 'snapshot' }))
    expect(seen.at(-1)).toBe('running')

    act(() => fake.push({ type: 'removed' }))
    expect(seen.at(-1)).toBeNull()

    act(() => root.unmount())
    expect(fake.unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('useManagedSessionTitle', () => {
  function titled(revision: number, text: string): ManagedSessionSnapshot {
    return {
      ...snapshot(revision, 'ready'),
      content: [
        {
          id: `prompt-${revision}`,
          kind: 'user-prompt',
          provider: null,
          text,
          turnId: 'turn-1',
          updatedAt: '2026-11-02T10:00:00.000Z',
        },
      ],
    }
  }

  it('keeps a newer pushed title when the first read answers late', async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    let answer: (value: Record<string, ManagedSessionSnapshot>) => void =
      () => {}
    let push: (update: ManagedSessionUpdate) => void = () => {}
    setSessionTransport({
      getSessions: () =>
        new Promise((resolve) => {
          answer = resolve
        }),
      subscribeSession: (
        _sessionId: string,
        listener: (update: ManagedSessionUpdate) => void,
      ) => {
        push = listener
        return () => {}
      },
    } as unknown as SessionTransport)
    const seen: (string | null)[] = []
    function Probe() {
      seen.push(useManagedSessionTitle('session-1'))
      return null
    }
    const root = createRoot(document.createElement('div'))
    await act(async () => root.render(<Probe />))

    act(() => push({ snapshot: titled(2, 'edit readme'), type: 'snapshot' }))
    await act(async () => answer({ 'session-1': titled(1, 'stale title') }))
    expect(seen.at(-1)).toBe('edit readme')
    act(() => root.unmount())
  })
})
