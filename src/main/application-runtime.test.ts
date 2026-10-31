import { describe, expect, it, vi } from 'vitest'

import { ApplicationRuntime } from './application-runtime'

describe('ApplicationRuntime', () => {
  it('initializes services, registers IPC, and creates the initial window', () => {
    const initializeServices = vi.fn()
    const registerIpcHandlers = vi.fn()
    const createMainWindow = vi.fn()
    const runtime = new ApplicationRuntime({
      createMainWindow,
      hasWindows: () => false,
      initializeServices,
      registerIpcHandlers,
      shutdownServices: vi.fn(),
    })

    runtime.start()

    expect(initializeServices).toHaveBeenCalledOnce()
    expect(registerIpcHandlers).toHaveBeenCalledOnce()
    expect(createMainWindow).toHaveBeenCalledOnce()
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
      createMainWindow,
      hasWindows: () => hasWindows,
      initializeServices: vi.fn(),
      registerIpcHandlers: vi.fn(),
      shutdownServices: vi.fn(),
    })

    runtime.ensureMainWindow()
    hasWindows = false
    runtime.ensureMainWindow()

    expect(createMainWindow).toHaveBeenCalledOnce()
  })

  it('runs bounded service shutdown at most once', async () => {
    const shutdownServices = vi.fn(async () => undefined)
    const runtime = new ApplicationRuntime({
      createMainWindow: vi.fn(),
      hasWindows: () => false,
      initializeServices: vi.fn(),
      registerIpcHandlers: vi.fn(),
      shutdownServices,
    })

    await Promise.all([runtime.shutdown(), runtime.shutdown()])
    await runtime.shutdown()

    expect(shutdownServices).toHaveBeenCalledOnce()
    expect(shutdownServices).toHaveBeenCalledWith('normal')
    expect(runtime.isShutdownComplete()).toBe(true)
  })
})
