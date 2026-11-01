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

const workspaceDirectory = path.resolve(import.meta.dirname, '..')
const pitwall = process.env.AIDE_E2E_PITWALL
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-e2e-'))
  execFileSync('git', ['init', '-b', 'main'], {
    cwd: repository,
    env: gitEnvironment,
  })
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  execFileSync('git', ['add', 'README.md'], {
    cwd: repository,
    env: gitEnvironment,
  })
  execFileSync('git', ['commit', '-m', 'Initial'], {
    cwd: repository,
    env: gitEnvironment,
  })
  return repository
}

// e2e/pitwall-daemon.ts starts the daemon these specs talk to, from the binary AIDE_E2E_PITWALL names.
test.describe('pitwall daemon backend', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  async function launch(): Promise<Page> {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-e2e-data-'))
    app = await electron.launch({
      args: [workspaceDirectory, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDirectory,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...process.env,
        AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
        AIDE_SOFTWARE_RENDERING: '1',
        AIDE_TEST_PROJECT_PICK_PATH: repository,
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        SWAYSOCK: '',
        TYPESAFE_API_KEY: 'synthetic-e2e-key',
        WAYLAND_DISPLAY: '',
        XDG_SESSION_TYPE: 'x11',
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    return page
  }

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows a chat started with pitwall chat new without a reload, and opens it in its workspace', async () => {
    const page = await launch()
    await page.getByRole('button', { name: 'Open task history' }).click()
    const tasks = page.getByLabel('Saved tasks')
    await expect(tasks).toBeVisible()

    execFileSync(
      pitwall as string,
      ['chat', 'new', '--dir', repository as string, '--', 'hello from cli'],
      { env: process.env },
    )

    const task = tasks
      .getByTestId('saved-task')
      .filter({ hasText: 'hello from cli' })
    await expect(task).toBeVisible()

    await task.getByRole('button').first().click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'hello from cli',
    )
    await expect(page.getByTestId('active-pane-name')).toHaveText('Agent')
  })

  test('renames and pins a chat in task history, and keeps both after a reload', async () => {
    const page = await launch()
    execFileSync(
      pitwall as string,
      ['chat', 'new', '--dir', repository as string, '--', 'rename me'],
      { env: process.env },
    )
    await page.getByRole('button', { name: 'Open task history' }).click()
    const task = page
      .getByLabel('Saved tasks')
      .getByTestId('saved-task')
      .filter({ hasText: /rename me|Renamed on the daemon/ })
    await expect(task).toContainText('rename me')
    await task.getByRole('button', { name: 'Rename', exact: true }).click()
    await page
      .getByRole('textbox', { name: 'Task title' })
      .fill('Renamed on the daemon')
    await page.getByRole('button', { name: 'Save title' }).click()
    await task.getByRole('button', { name: 'Pin', exact: true }).click()
    await expect(task).toContainText('Pinned · Renamed on the daemon')

    // why: the daemon transport keeps neither, so a new renderer reads both back from pitwall.
    await page.reload()
    await page.getByRole('button', { name: 'Open task history' }).click()
    await expect(task).toContainText('Pinned · Renamed on the daemon')
    await expect(task.getByRole('button', { name: 'Unpin' })).toBeVisible()
    const found = await page.evaluate(() =>
      window.aideSessions.listSessions('renamed on the daemon'),
    )
    expect(found.tasks.map((entry) => [entry.title, entry.pinned])).toEqual([
      ['Renamed on the daemon', true],
    ])
  })
})
