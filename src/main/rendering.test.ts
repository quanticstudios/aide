import { describe, expect, it, vi } from 'vitest'

import {
  applyRenderingConfiguration,
  resolveRenderingConfiguration,
} from './rendering'

describe('resolveRenderingConfiguration', () => {
  it('keeps Linux hardware acceleration enabled by default', () => {
    expect(
      resolveRenderingConfiguration({
        argv: [],
        env: {},
        platform: 'linux',
      }),
    ).toEqual({ mode: 'hardware', source: 'default' })
  })

  it('enables the documented software fallback environment flag', () => {
    expect(
      resolveRenderingConfiguration({
        argv: [],
        env: { AIDE_SOFTWARE_RENDERING: '1' },
        platform: 'linux',
      }),
    ).toEqual({ mode: 'software', source: 'environment' })
  })

  it('enables the software fallback command-line flag', () => {
    expect(
      resolveRenderingConfiguration({
        argv: ['electron', '--aide-software-rendering'],
        env: {},
        platform: 'linux',
      }),
    ).toEqual({ mode: 'software', source: 'command-line' })
  })

  it('does not apply the Linux-only fallback on other platforms', () => {
    expect(
      resolveRenderingConfiguration({
        argv: ['electron', '--aide-software-rendering'],
        env: { AIDE_SOFTWARE_RENDERING: '1' },
        platform: 'darwin',
      }),
    ).toEqual({ mode: 'hardware', source: 'default' })
  })
})

describe('applyRenderingConfiguration', () => {
  it('does not change Electron GPU settings for the default mode', () => {
    const app = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    }
    const env: Record<string, string | undefined> = {}

    applyRenderingConfiguration(
      app,
      { mode: 'hardware', source: 'default' },
      env,
    )

    expect(app.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalled()
    expect(env).toEqual({})
  })

  it('uses SwiftShader without disabling the GPU sandbox for the fallback', () => {
    const app = {
      commandLine: { appendSwitch: vi.fn() },
      disableHardwareAcceleration: vi.fn(),
    }
    const env: Record<string, string | undefined> = {}

    applyRenderingConfiguration(
      app,
      { mode: 'software', source: 'environment' },
      env,
    )

    expect(app.disableHardwareAcceleration).toHaveBeenCalledOnce()
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'use-angle',
      'swiftshader',
    )
    expect(app.commandLine.appendSwitch).toHaveBeenCalledWith(
      'use-gl',
      'swiftshader',
    )
    expect(app.commandLine.appendSwitch).not.toHaveBeenCalledWith(
      'disable-gpu-sandbox',
    )
    expect(env).toEqual({
      LIBGL_ALWAYS_SOFTWARE: '1',
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
    })
  })
})
