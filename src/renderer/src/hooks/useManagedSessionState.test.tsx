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
import { useManagedSessionState } from './useManagedSessionState'

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
