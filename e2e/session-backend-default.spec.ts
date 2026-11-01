import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

// why: these specs need a pitwall aide cannot find, so they never start the user's daemon.
const { PITWALL_SOCKET: _socket, ...env } = process.env
const pathWithoutPitwall = (process.env.PATH ?? '')
  .split(path.delimiter)
  .filter((dir) => !existsSync(path.join(dir, 'pitwall')))
  .join(path.delimiter)

test.describe('pitwall as the default session backend', () => {
  let app: ElectronApplication | null = null
  let root: string

  test.beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'aide-default-backend-e2e-'))
    const repository = path.join(root, 'repo')
    execFileSync('git', ['init', '-b', 'main', repository], {
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
  })

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    rmSync(root, { force: true, recursive: true })
  })

  async function launch(): Promise<Page> {
    await app?.close()
    const database = path.join(root, 'data', 'aide.sqlite3')
    const isFresh = !existsSync(database)
    app = await electron.launch({
      args: [workspaceDirectory, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDirectory,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...env,
        AIDE_DATABASE_PATH: database,
        AIDE_FAKE_MANAGED_PROVIDERS: '1',
        AIDE_SOFTWARE_RENDERING: '1',
        AIDE_TEST_PROJECT_PICK_PATH: path.join(root, 'repo'),
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HOME: root,
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        PATH: pathWithoutPitwall,
        SWAYSOCK: '',
        WAYLAND_DISPLAY: '',
        XDG_RUNTIME_DIR: path.join(root, 'run'),
        XDG_SESSION_TYPE: 'x11',
        XDG_STATE_HOME: path.join(root, 'state'),
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    if (isFresh) {
      await page
        .getByRole('button', { name: /open project/i })
        .last()
        .click()
    }
    await expect(page.getByRole('button', { name: /add pane/i })).toBeVisible()
    return page
  }

  /** Leaves localStorage as an install from before pitwall became the default had it. */
  async function makeUpgradedInstall(page: Page) {
    await page.evaluate(() =>
      window.localStorage.removeItem('aide.pitwall-default-notice-seen'),
    )
  }

  test('a fresh install says pitwall is missing, with no built-in fallback', async () => {
    const page = await launch()
    const setup = page.getByTestId('pitwall-setup-card')
    await expect(setup).toContainText('pitwall is not installed')
    await expect(setup.getByRole('button')).toHaveText(['Check again'])
    await expect(page.getByTestId('daemon-default-notice')).toHaveCount(0)
  })

  test('an upgraded install gets the notice once', async () => {
    await makeUpgradedInstall(await launch())
    const page = await launch()
    const notice = page.getByTestId('daemon-default-notice')
    await expect(notice).toContainText('Sessions now run on pitwall')
    await expect(notice.getByRole('button')).toHaveText(['Got it'])
    await notice.getByRole('button', { name: 'Got it' }).click()
    await expect(notice).toHaveCount(0)

    const relaunched = await launch()
    await expect(relaunched.getByTestId('pitwall-setup-card')).toBeVisible()
    await expect(relaunched.getByTestId('daemon-default-notice')).toHaveCount(0)
  })

  test('an install that went back to built-in gets the notice again', async () => {
    const first = await launch()
    await expect(first.getByTestId('daemon-default-notice')).toHaveCount(0)
    await first.evaluate(() =>
      window.localStorage.setItem('aide.session-backend', 'built-in'),
    )
    const page = await launch()
    const notice = page.getByTestId('daemon-default-notice')
    await notice.getByRole('button', { name: 'Got it' }).click()
    await expect(notice).toHaveCount(0)

    const relaunched = await launch()
    await expect(relaunched.getByTestId('daemon-default-notice')).toHaveCount(0)
  })
})
