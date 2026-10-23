import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
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
const REAL_PANES = ['Agent', 'Terminal', 'Git', 'Preview']

function createGitRepository(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'aide-catalog-repo-'))
  const run = (args: string[]): void => {
    execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', env: GIT_ENV })
  }

  run(['init', '-b', 'main'])
  writeFileSync(path.join(repoRoot, 'README.md'), '# aide\n')
  run(['add', 'README.md'])
  run(['commit', '-m', 'Initial commit'])

  return repoRoot
}

async function expectOnlyRealPanes(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog', { name: 'Add pane' })
  await expect(dialog.locator('button p.font-semibold')).toHaveText(REAL_PANES)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
}

test.describe('pane catalog', () => {
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

  test('add pane lists only real panes', async () => {
    repoRoot = createGitRepository()
    tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-catalog-'))
    app = await electron.launch({
      args: [workspaceDir],
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

    await page.getByRole('button', { name: /add pane/i }).click()
    await expectOnlyRealPanes(page)

    await page.keyboard.press('Control+K')
    const input = page.getByPlaceholder('Type a command...')
    await expect(input).toBeFocused()
    await input.fill('New pane...')
    await page.getByText('New pane...', { exact: true }).click()
    await expectOnlyRealPanes(page)
  })
})
