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

  test('moves panes horizontally with Alt+Left and Alt+Right', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched

    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Chat task thread',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Preview target',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowLeft')
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

  test('opens overview with Ctrl+Tab and jumps to another workspace', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched
    const overview = page.locator(
      '[data-testid="workspace-switcher-overlay"][data-mode="overview"]',
    )

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )

    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Control')

    await expect(overview).toBeVisible()
    await expect(overview.getByText('Overview')).toBeVisible()
    await expect(overview.getByText('Current')).toBeVisible()
    const checkoutWorkspace = overview.getByRole('option', {
      name: /checkout-redesign/i,
    })
    await expect(checkoutWorkspace).toBeVisible()
    await expect(checkoutWorkspace.getByText('storefront')).toBeVisible()

    await checkoutWorkspace.click()

    await expect(overview).not.toBeVisible()
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'checkout-redesign',
    )
  })

  test('supports sidebar hover, focus, and pinned-open persistence', async () => {
    const launched = await launchAideApp()
    app = launched.app

    const { page } = launched

    await page.evaluate(() => {
      window.localStorage.removeItem('aide.sidebar.pinned')
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const sidebarShell = page.getByTestId('sidebar-shell')
    const workspaceTree = page.getByTestId('workspace-tree-panel')

    await expect(workspaceTree).toHaveAttribute('data-expanded', 'false')

    await sidebarShell.hover()
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.mouse.move(1400, 120)
    await page.waitForTimeout(180)
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'false')

    await page.getByLabel('aide').focus()
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.getByRole('button', { name: /pin sidebar open/i }).click()
    await page.mouse.move(1400, 120)
    await page.waitForTimeout(180)
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')
  })
})
