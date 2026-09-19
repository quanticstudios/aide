import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
  type Page,
  test,
} from '@playwright/test'

const workspaceDir = path.resolve(import.meta.dirname, '..')
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

function createGitRepository(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'aide-header-repo-'))
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', env: GIT_ENV })
  }

  run(['init', '-b', 'main'])
  writeFileSync(path.join(repoRoot, 'README.md'), '# aide\n')
  run(['add', 'README.md'])
  run(['commit', '-m', 'Initial commit'])

  return repoRoot
}

async function expectAlignedWithProjectRow(
  projectRow: Locator,
  paneHeader: Locator,
): Promise<void> {
  await expect(paneHeader).toBeVisible()
  const rowBox = await projectRow.boundingBox()
  const headerBox = await paneHeader.boundingBox()
  if (!rowBox || !headerBox) throw new Error('missing bounding box')

  expect(Math.abs(headerBox.height - rowBox.height)).toBeLessThanOrEqual(1)
  expect(Math.abs(headerBox.y - rowBox.y)).toBeLessThanOrEqual(1)
}

async function addPane(page: Page, paneName: RegExp): Promise<void> {
  await page.getByRole('button', { name: /add pane/i }).click()
  await page
    .getByRole('dialog', { name: 'Add pane' })
    .getByRole('button', { name: paneName })
    .click()
}

test.describe('pane header alignment', () => {
  let app: ElectronApplication | null = null
  let repoRoot: string | null = null
  let tempDirectory: string | null = null

  test.afterEach(async () => {
    await app?.close()
    app = null
    for (const directory of [repoRoot, tempDirectory]) {
      if (directory) rmSync(directory, { force: true, recursive: true })
    }
    repoRoot = null
    tempDirectory = null
  })

  test('pane headers match the sidebar project row', async () => {
    repoRoot = createGitRepository()
    tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-header-'))
    app = await electron.launch({
      args: [workspaceDir, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDir,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...process.env,
        AIDE_DATABASE_PATH: path.join(tempDirectory, 'aide.sqlite3'),
        AIDE_FAKE_MANAGED_PROVIDERS: '1',
        AIDE_SOFTWARE_RENDERING: '1',
        AIDE_TEST_PROJECT_PICK_PATH: repoRoot,
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        SWAYSOCK: '',
        WAYLAND_DISPLAY: '',
        XDG_SESSION_TYPE: 'x11',
      },
    })

    const page: Page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByText('No project selected')).toBeVisible()
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')

    const sidebarShell = page.getByTestId('sidebar-shell')
    if ((await sidebarShell.getAttribute('data-expanded')) !== 'true') {
      await page.getByRole('button', { name: 'Open sidebar' }).click()
    }
    const projectRow = page.locator('[data-testid^="project-header-"]').first()
    await expect(projectRow).toBeVisible()

    await addPane(page, /^agent\b/i)
    await expectAlignedWithProjectRow(
      projectRow,
      page.getByTestId('managed-agent-pane').locator('> div').first(),
    )
    await page.screenshot({
      path: test.info().outputPath('pane-header-agent.png'),
    })

    await addPane(page, /terminal/i)
    await expectAlignedWithProjectRow(
      projectRow,
      page.locator('.terminal-pane').locator('> div').first(),
    )
    await page.screenshot({
      path: test.info().outputPath('pane-header-terminal.png'),
    })

    await addPane(page, /git/i)
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expectAlignedWithProjectRow(
      projectRow,
      page.getByTestId('git-pane').locator('> div').first(),
    )
    await page.screenshot({
      path: test.info().outputPath('pane-header-git.png'),
    })
  })
})
