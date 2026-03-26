import path from 'node:path'

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

const workspaceDir = '/home/pho7on/Work/aide'

async function launchAideApp(): Promise<{
  app: ElectronApplication
  page: Page
}> {
  const app = await electron.launch({
    args: [workspaceDir],
    executablePath: path.join(
      workspaceDir,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      LIBGL_ALWAYS_SOFTWARE: '1',
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('active-pane-name')).toBeVisible()

  return { app, page }
}

test.describe('electron spatial navigation', () => {
  let app: ElectronApplication | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    app = null
  })

  test('can reach pane 4 and 5 in Electron', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched

    await page.getByRole('button', { name: /editor inspect/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Editor inspect',
    )

    await page.getByRole('button', { name: /preview target/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Preview target',
    )
  })

  test('moves panes horizontally with Alt+h and Alt+l', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched

    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Chat task thread',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('l')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await page.keyboard.down('Alt')
    await page.keyboard.press('l')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Preview target',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('h')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
  })

  test('moves workspaces vertically with Alt+j and Alt+k', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('j')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'agent-review',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('k')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )
  })
})
