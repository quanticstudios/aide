import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { AideApi } from '../../../shared/ipc'
import { isDaemonTransport } from './daemon-transport'
import {
  dismissDaemonDefaultNotice,
  getSessionBackend,
  initializeSessionBackend,
  isDaemonDefaultNoticeDue,
  setSessionBackend,
} from './session-backend'
import { getSessionTransport } from './session-transport'

function stubWindow(defaultSessionBackend?: string, isExistingInstall = true) {
  const storage = new Map<string, string>()
  const api = {
    closeManagedSession: vi.fn(),
    defaultSessionBackend,
    isExistingInstall,
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
  it('is pitwall unless the user or AIDE_SESSION_BACKEND picks built-in', () => {
    stubWindow()
    expect(getSessionBackend()).toBe('pitwall')
    stubWindow('built-in')
    expect(getSessionBackend()).toBe('built-in')
    stubWindow()
    setSessionBackend('built-in')
    expect(getSessionBackend()).toBe('built-in')
  })

  it('shows the default notice once to an upgraded install on the default', () => {
    stubWindow()
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(true)
    dismissDaemonDefaultNotice()
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(false)
  })

  it('skips the default notice on a fresh install, a picked backend or an override', () => {
    stubWindow(undefined, false)
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(false)

    stubWindow()
    setSessionBackend('pitwall')
    expect(isDaemonDefaultNoticeDue()).toBe(false)

    stubWindow('built-in')
    expect(isDaemonDefaultNoticeDue()).toBe(false)
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
