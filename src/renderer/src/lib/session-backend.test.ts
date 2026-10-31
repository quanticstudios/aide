import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AideApi } from '../../../shared/ipc'
import { isDaemonTransport } from './daemon-transport'
import {
  dismissDaemonDefaultNotice,
  initializeSessionBackend,
  isDaemonDefaultNoticeDue,
} from './session-backend'
import { getSessionTransport, setSessionTransport } from './session-transport'

function stubWindow(
  isExistingInstall = true,
  storage = new Map<string, string>(),
) {
  vi.stubGlobal('window', {
    aide: {
      getPitwallEndpoint: vi.fn(async () => null),
      isExistingInstall,
    } as unknown as AideApi,
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      removeItem: (key: string) => storage.delete(key),
      setItem: (key: string, value: string) => storage.set(key, value),
    },
  })
}

afterEach(() => {
  setSessionTransport(null)
  vi.unstubAllGlobals()
})

describe('session backend', () => {
  it('runs every session on the daemon transport', () => {
    stubWindow()
    expect(getSessionTransport()).toBeNull()
    initializeSessionBackend()
    expect(isDaemonTransport(getSessionTransport())).toBe(true)
  })

  it('shows the default notice once to an upgraded install', () => {
    stubWindow()
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(true)
    dismissDaemonDefaultNotice()
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(false)
  })

  it('skips the default notice on a fresh install', () => {
    stubWindow(false)
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(false)
  })

  it('shows the notice again to an install that went back to built-in', () => {
    stubWindow(
      true,
      new Map([
        ['aide.pitwall-default-notice-seen', '1'],
        ['aide.session-backend', 'built-in'],
      ]),
    )
    initializeSessionBackend()
    expect(isDaemonDefaultNoticeDue()).toBe(true)
    dismissDaemonDefaultNotice()
    expect(isDaemonDefaultNoticeDue()).toBe(false)
  })
})
