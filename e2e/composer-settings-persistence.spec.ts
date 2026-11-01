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
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

function runGit(workingDirectory: string, arguments_: string[]): void {
  execFileSync('git', arguments_, {
    cwd: workingDirectory,
    env: gitEnvironment,
  })
}

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-composer-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), '# aide\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial commit'])
  return repository
}

async function launchAideApp(
  repository: string,
  dataDirectory: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
    args: [workspaceDirectory, '--force-device-scale-factor=1'],
    executablePath: path.join(
      workspaceDirectory,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
      AIDE_FAKE_MANAGED_PROVIDERS: '1',
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
  return { app, page }
}

async function openAgentPane(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent\b/i }).click()
}

test.describe('composer settings persistence', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
    app = null
    dataDirectory = null
    repository = null
  })

  test('restores the composer toolbar after a relaunch', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-composer-e2e-data-'))
    let launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    await openAgentPane(launched.page)

    await launched.page
      .getByRole('button', { name: 'Supervised', exact: true })
      .click()
    await launched.page.getByRole('button', { name: /^Full access\b/ }).click()

    await launched.page
      .getByRole('button', { name: 'Claude Sonnet 5', exact: true })
      .click()
    const picker = launched.page.locator('[data-model-selector-menu]')
    await picker.getByRole('button', { name: 'Codex', exact: true }).click()
    await picker
      .getByRole('button')
      .filter({ hasText: 'GPT-5.6 Terra' })
      .click()
    await expect(
      launched.page.getByRole('button', { name: 'GPT-5.6 Terra', exact: true }),
    ).toBeVisible()

    await launched.page
      .getByRole('button', { name: 'Reasoning settings', exact: true })
      .click()
    await launched.page
      .getByRole('menu', { name: 'Reasoning settings' })
      .getByRole('menuitem', { name: /^Low\b/ })
      .click()
    await expect(
      launched.page.getByRole('button', { name: 'Reasoning settings' }),
    ).toHaveText(/Low · Fast/)

    await app.close()
    launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    const page = launched.page

    await expect(
      page.getByRole('button', { name: 'GPT-5.6 Terra', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reasoning settings' }),
    ).toHaveText(/Low · Fast/)
    await expect(
      page.getByRole('button', { name: /^Full access\b/ }),
    ).toBeVisible()
  })

  test('adopts a selection left behind in local storage', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-composer-e2e-data-'))
    const launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    const page = launched.page

    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await page.evaluate(async () => {
      const storage = await window.aide.getStorageSnapshot()
      const workspaceId = storage.workspaces[0].id
      localStorage.setItem(`aide:workspace:${workspaceId}:provider`, 'codex')
      localStorage.setItem(
        `aide:workspace:${workspaceId}:provider-selection:codex`,
        JSON.stringify({
          effort: 'low',
          modelId: 'gpt-5.6-terra',
          serviceTier: 'priority',
        }),
      )
    })

    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()

    await expect(
      page.getByRole('button', { name: 'GPT-5.6 Terra', exact: true }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Reasoning settings' }),
    ).toHaveText(/Low · Fast/)
  })
})
