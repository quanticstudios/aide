import { describe, expect, it, vi } from 'vitest'

import { pickProjectRoot } from './project-picker'

describe('pickProjectRoot', () => {
  it('returns the configured test path without opening a dialog', async () => {
    const browserWindow = {} as never
    const dialogModule = {
      showOpenDialog: vi.fn(),
    }

    vi.stubEnv('AIDE_TEST_PROJECT_PICK_PATH', '/tmp/aide-project')

    await expect(
      pickProjectRoot(browserWindow, dialogModule, '/work/aide'),
    ).resolves.toBe('/tmp/aide-project')

    expect(dialogModule.showOpenDialog).not.toHaveBeenCalled()

    vi.unstubAllEnvs()
  })

  it('returns the selected directory from the dialog', async () => {
    const browserWindow = {} as never
    const dialogModule = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: false,
        filePaths: ['/work/aide'],
      }),
    }

    await expect(
      pickProjectRoot(browserWindow, dialogModule, '/work'),
    ).resolves.toBe('/work/aide')

    expect(dialogModule.showOpenDialog).toHaveBeenCalledWith(browserWindow, {
      defaultPath: '/work',
      properties: ['openDirectory'],
      title: 'Open project folder',
    })
  })

  it('returns null when the dialog is canceled', async () => {
    const browserWindow = {} as never
    const dialogModule = {
      showOpenDialog: vi.fn().mockResolvedValue({
        canceled: true,
        filePaths: [],
      }),
    }

    await expect(
      pickProjectRoot(browserWindow, dialogModule, '/work'),
    ).resolves.toBeNull()
  })
})
