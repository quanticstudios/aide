import { describe, expect, it, vi } from 'vitest'

import { createTrustedIpcRegistrar } from './trusted-ipc'

describe('createTrustedIpcRegistrar', () => {
  it('checks renderer trust before invoking a handler', () => {
    const handle = vi.fn()
    const assertTrusted = vi.fn(() => {
      throw new Error('untrusted renderer')
    })
    const ipcListener = vi.fn()

    createTrustedIpcRegistrar({ handle }, assertTrusted).handle(
      'terminal:write',
      ipcListener,
    )

    const registeredIpcListener = handle.mock.calls[0]?.[1]
    expect(() =>
      registeredIpcListener?.({ senderFrame: {} }, 'session', 'input'),
    ).toThrow('untrusted renderer')
    expect(ipcListener).not.toHaveBeenCalled()
  })

  it('preserves arguments and async results for trusted renderers', async () => {
    const handle = vi.fn()
    const event = { senderFrame: {} }
    const ipcListener = vi.fn(async (_event, value: string) => `${value}:ok`)

    createTrustedIpcRegistrar({ handle }, vi.fn()).handle(
      'storage:get-snapshot',
      ipcListener,
    )

    const registeredIpcListener = handle.mock.calls[0]?.[1]
    await expect(registeredIpcListener?.(event, 'value')).resolves.toBe(
      'value:ok',
    )
    expect(ipcListener).toHaveBeenCalledWith(event, 'value')
  })
})
