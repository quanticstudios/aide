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

async function setDaemonBackend(page: Page, isOn: boolean): Promise<void> {
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' })
  if (await openSidebar.isVisible()) await openSidebar.click()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  const toggle = settings.getByRole('switch', {
    name: 'Run sessions on the pitwall daemon',
  })
  if ((await toggle.isChecked()) !== isOn) await toggle.press('Space')
  await expect(toggle).toBeChecked({ checked: isOn })
  await settings.getByRole('button', { name: 'Back to app' }).click()
}

// The daemon-backend CI job sets AIDE_E2E_PITWALL; e2e/pitwall-daemon.ts starts the daemon these specs talk to.
test.describe('pitwall daemon backend', () => {
  test.skip(!pitwall, 'needs AIDE_E2E_PITWALL, a pitwall binary')

  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  async function launch(backend: string): Promise<Page> {
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
        AIDE_FAKE_MANAGED_PROVIDERS: '1',
        AIDE_SESSION_BACKEND: backend,
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
    const page = await launch('pitwall')
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

  test('keeps built-in sessions across a switch to pitwall and back', async () => {
    const page = await launch('built-in')
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await app?.evaluate(() => {
      globalThis.fetch = async (url, options) => {
        if (url !== 'https://api.typesafe.ai/v1/systemone') {
          throw new Error(`Unexpected request: ${url}`)
        }
        const request = JSON.parse(String(options?.body)) as {
          questions: Record<string, unknown>
        }
        return new Response(
          JSON.stringify({
            answers: Object.fromEntries(
              Object.keys(request.questions).map((key) => [
                key,
                { noul: 0.8, type: 'noul' },
              ]),
            ),
            model: 'jev-1.13.0',
            usage: { input_tokens: 10, output_tokens: 1 },
          }),
          { headers: { 'content-type': 'application/json' } },
        )
      }
    })
    await page.evaluate(async () => {
      const storage = await window.aide.getStorageSnapshot()
      const workspace = storage.workspaces[0]
      if (!workspace) throw new Error('Workspace unavailable.')
      await window.aide.updateJevSettings(workspace.id, {
        allowProcessing: true,
      })
    })
    await page
      .getByRole('textbox', { name: /claude prompt/i })
      .fill('keep me built in')
    await page.getByRole('button', { name: /send prompt/i }).click()
    const content = page.getByTestId('managed-session-content')
    await expect(content).toContainText('Handled: keep me built in')

    await setDaemonBackend(page, true)
    await expect(content).not.toContainText('Handled: keep me built in')

    await setDaemonBackend(page, false)
    await expect(content).toContainText('Handled: keep me built in')
  })
})
