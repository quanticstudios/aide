import { describe, expect, it, vi } from 'vitest'

import { ApplicationRuntime } from './application-runtime'

describe('ApplicationRuntime', () => {
  it('initializes services, registers IPC, and creates the initial window', () => {
    const initializeServices = vi.fn()
    const registerIpcHandlers = vi.fn()
    const createMainWindow = vi.fn()
    const reapStoppedManagedSessions = vi.fn()
    const unref = vi.fn()
    let reaperCallback: (() => void) | undefined
    const startReaper = vi.fn((callback: () => void) => {
      reaperCallback = callback
      return { unref }
    })
    const runtime = new ApplicationRuntime({
      closeDatabase: vi.fn(),
      createMainWindow,
      hasWindows: () => false,
      initializeServices: () => {
        initializeServices()
        return true
      },
      quiescePersistenceWrites: vi.fn(),
      registerIpcHandlers,
      registerRecoveryIpcHandlers: vi.fn(),
      reapStoppedManagedSessions,
      refreshKnownGoodBackup: vi.fn(),
      startReaper,
      shutdownServices: vi.fn(),
    })

    runtime.start()

    expect(initializeServices).toHaveBeenCalledOnce()
    expect(registerIpcHandlers).toHaveBeenCalledOnce()
    expect(createMainWindow).toHaveBeenCalledOnce()
    expect(startReaper).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000)
    expect(unref).toHaveBeenCalledOnce()
    if (!reaperCallback) {
      throw new Error('expected the runtime to register a reaper')
    }
    reaperCallback()
    expect(reapStoppedManagedSessions).toHaveBeenCalledOnce()
    expect(
      vi.mocked(initializeServices).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(registerIpcHandlers).mock.invocationCallOrder[0] ?? Infinity,
    )
    expect(
      vi.mocked(registerIpcHandlers).mock.invocationCallOrder[0],
    ).toBeLessThan(
      vi.mocked(createMainWindow).mock.invocationCallOrder[0] ?? Infinity,
    )
  })

  it('recreates the main window only when no window is present', () => {
    const createMainWindow = vi.fn()
    let hasWindows = true
    const runtime = new ApplicationRuntime({
      closeDatabase: vi.fn(),
      createMainWindow,
      hasWindows: () => hasWindows,
      initializeServices: () => true,
      quiescePersistenceWrites: vi.fn(),
      registerIpcHandlers: vi.fn(),
      registerRecoveryIpcHandlers: vi.fn(),
      reapStoppedManagedSessions: vi.fn(),
      refreshKnownGoodBackup: vi.fn(),
      startReaper: () => ({ unref: vi.fn() }),
      shutdownServices: vi.fn(),
    })

    runtime.ensureMainWindow()
    hasWindows = false
    runtime.ensureMainWindow()

    expect(createMainWindow).toHaveBeenCalledOnce()
  })

  it('quiesces writes before services stop and refreshes the backup before closing once', async () => {
    const events: string[] = []
    const shutdownServices = vi.fn(async () => {
      events.push('services stopped')
    })
    const runtime = new ApplicationRuntime({
      closeDatabase: () => {
        events.push('database closed')
      },
      createMainWindow: vi.fn(),
      hasWindows: () => false,
      initializeServices: () => true,
      quiescePersistenceWrites: () => {
        events.push('writes quiesced')
        return Promise.resolve()
      },
      registerIpcHandlers: vi.fn(),
      registerRecoveryIpcHandlers: vi.fn(),
      reapStoppedManagedSessions: vi.fn(),
      refreshKnownGoodBackup: () => {
        events.push('backup refreshed')
      },
      startReaper: () => ({ unref: vi.fn() }),
      shutdownServices,
    })

    await Promise.all([runtime.shutdown(), runtime.shutdown()])
    await runtime.shutdown()

    expect(shutdownServices).toHaveBeenCalledOnce()
    expect(events).toEqual([
      'writes quiesced',
      'services stopped',
      'backup refreshed',
      'database closed',
    ])
    expect(runtime.isShutdownComplete()).toBe(true)
  })

  it('starts in recovery without normal IPC or hydration reaper and resumes later', () => {
    let servicesAvailable = false
    const registerIpcHandlers = vi.fn()
    const registerRecoveryIpcHandlers = vi.fn()
    const startReaper = vi.fn(() => ({ unref: vi.fn() }))
    const runtime = new ApplicationRuntime({
      closeDatabase: vi.fn(),
      createMainWindow: vi.fn(),
      hasWindows: () => false,
      initializeServices: () => servicesAvailable,
      quiescePersistenceWrites: vi.fn(),
      registerIpcHandlers,
      registerRecoveryIpcHandlers,
      reapStoppedManagedSessions: vi.fn(),
      refreshKnownGoodBackup: vi.fn(),
      startReaper,
      shutdownServices: vi.fn(),
    })

    runtime.start()

    expect(registerRecoveryIpcHandlers).toHaveBeenCalledOnce()
    expect(registerIpcHandlers).not.toHaveBeenCalled()
    expect(startReaper).not.toHaveBeenCalled()

    servicesAvailable = true
    expect(runtime.resume()).toBe(true)
    expect(registerIpcHandlers).toHaveBeenCalledOnce()
    expect(startReaper).toHaveBeenCalledOnce()
  })
})
