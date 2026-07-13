import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { pickProjectRoot } from './project-picker'

describe('pickProjectRoot', () => {
  it('returns the configured test path without opening a dialog', async () => {
    const browserWindow = {} as never
    const dialogModule = {
      showOpenDialog: vi.fn(),
    }

    const previousTestPath = process.env.AIDE_TEST_PROJECT_PICK_PATH
    process.env.AIDE_TEST_PROJECT_PICK_PATH = '/tmp/aide-project'

    try {
      await expect(
        pickProjectRoot(browserWindow, dialogModule, '/work/aide'),
      ).resolves.toBe('/tmp/aide-project')

      expect(dialogModule.showOpenDialog).not.toHaveBeenCalled()
    } finally {
      if (previousTestPath === undefined) {
        // biome-ignore lint/performance/noDelete: process.env keys must be removed rather than assigned the string "undefined"
        delete process.env.AIDE_TEST_PROJECT_PICK_PATH
      } else {
        process.env.AIDE_TEST_PROJECT_PICK_PATH = previousTestPath
      }
    }
  })

  it('consumes configured test paths in order', async () => {
    const browserWindow = {} as never
    const dialogModule = { showOpenDialog: vi.fn() }
    const previousTestPaths = process.env.AIDE_TEST_PROJECT_PICK_PATHS
    process.env.AIDE_TEST_PROJECT_PICK_PATHS = [
      '/tmp/aide-first',
      '/tmp/aide-second',
    ].join(path.delimiter)

    try {
      await expect(pickProjectRoot(browserWindow, dialogModule)).resolves.toBe(
        '/tmp/aide-first',
      )
      await expect(pickProjectRoot(browserWindow, dialogModule)).resolves.toBe(
        '/tmp/aide-second',
      )
      expect(dialogModule.showOpenDialog).not.toHaveBeenCalled()
    } finally {
      if (previousTestPaths === undefined) {
        // biome-ignore lint/performance/noDelete: process.env keys must be removed rather than assigned the string "undefined"
        delete process.env.AIDE_TEST_PROJECT_PICK_PATHS
      } else {
        process.env.AIDE_TEST_PROJECT_PICK_PATHS = previousTestPaths
      }
    }
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
