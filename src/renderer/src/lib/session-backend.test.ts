import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AideApi } from '../../../shared/ipc'
import { isDaemonTransport } from './daemon-transport'
import {
  getSessionBackend,
  initializeSessionBackend,
  setSessionBackend,
} from './session-backend'
import { getSessionTransport } from './session-transport'

function stubWindow(defaultSessionBackend?: string) {
  const storage = new Map<string, string>()
  const api = {
    closeManagedSession: vi.fn(),
    defaultSessionBackend,
    getPitwallEndpoint: vi.fn(async () => null),
  }
  vi.stubGlobal('window', {
    aide: api as unknown as AideApi,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
  return api
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  setSessionBackend('built-in')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('session backend', () => {
  it('is built-in unless the user or AIDE_SESSION_BACKEND picks pitwall', () => {
    stubWindow()
    expect(getSessionBackend()).toBe('built-in')
    stubWindow('pitwall')
    expect(getSessionBackend()).toBe('pitwall')
    setSessionBackend('built-in')
    expect(getSessionBackend()).toBe('built-in')
  })

  it('swaps the transport both ways without closing built-in sessions', () => {
    const api = stubWindow('pitwall')
    initializeSessionBackend()
    const daemon = getSessionTransport()
    expect(isDaemonTransport(daemon)).toBe(true)

    setSessionBackend('built-in')
    expect(isDaemonTransport(getSessionTransport())).toBe(false)
    setSessionBackend('pitwall')
    const next = getSessionTransport()
    expect(isDaemonTransport(next) && next !== daemon).toBe(true)
    expect(api.closeManagedSession).not.toHaveBeenCalled()
  })
})
