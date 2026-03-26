import { describe, expect, it, vi } from 'vitest'

import {
  focusHyprlandStartupWorkspace,
  resolveHyprlandStartupWorkspace,
  shouldUseHyprlandStartupWorkspace,
} from './hyprland'

describe('shouldUseHyprlandStartupWorkspace', () => {
  it('enables startup workspace placement on Hyprland Linux sessions', () => {
    expect(
      shouldUseHyprlandStartupWorkspace(
        {
          HYPRLAND_INSTANCE_SIGNATURE: 'hypr-test',
        },
        'linux',
      ),
    ).toBe(true)
  })

  it('ignores non-Hyprland or non-Linux sessions', () => {
    expect(shouldUseHyprlandStartupWorkspace({}, 'linux')).toBe(false)
    expect(
      shouldUseHyprlandStartupWorkspace(
        {
          HYPRLAND_INSTANCE_SIGNATURE: 'hypr-test',
        },
        'darwin',
      ),
    ).toBe(false)
  })
})

describe('resolveHyprlandStartupWorkspace', () => {
  it('defaults to workspace 1', () => {
    expect(resolveHyprlandStartupWorkspace({})).toBe('1')
  })

  it('allows overriding the startup workspace through env', () => {
    expect(
      resolveHyprlandStartupWorkspace({
        AIDE_HYPRLAND_WORKSPACE: '3',
      }),
    ).toBe('3')
  })
})

describe('focusHyprlandStartupWorkspace', () => {
  it('dispatches hyprctl to the requested workspace', async () => {
    const runHyprctl = vi.fn().mockResolvedValue(undefined)
    const env = {
      AIDE_HYPRLAND_WORKSPACE: '2',
      HYPRLAND_INSTANCE_SIGNATURE: 'hypr-test',
    }

    await expect(
      focusHyprlandStartupWorkspace({
        env,
        platform: 'linux',
        runHyprctl,
      }),
    ).resolves.toBe(true)

    expect(runHyprctl).toHaveBeenCalledWith(['dispatch', 'workspace', '2'], env)
  })

  it('skips hyprctl outside Hyprland sessions', async () => {
    const runHyprctl = vi.fn().mockResolvedValue(undefined)

    await expect(
      focusHyprlandStartupWorkspace({
        env: {},
        platform: 'linux',
        runHyprctl,
      }),
    ).resolves.toBe(false)

    expect(runHyprctl).not.toHaveBeenCalled()
  })
})
