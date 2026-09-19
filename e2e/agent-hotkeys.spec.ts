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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-hotkeys-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function openAgentPane(
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
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent\b/i }).click()

  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.typesafe.ai/v1/systemone') {
        return await nativeFetch(url, options)
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

  return { app, page }
}

async function getSnapshot(page: Page) {
  return await page.evaluate(async () => {
    const session = Object.values(
      await window.aide.getManagedSessionSnapshots(),
    )[0]
    if (!session) throw new Error('Managed session did not start.')
    return session
  })
}

test.describe('agent pane hotkeys', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.beforeEach(() => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-hotkeys-e2e-data-'))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('opens each composer menu, closes it with Escape, then interrupts', async () => {
    const launched = await openAgentPane(repository ?? '', dataDirectory ?? '')
    app = launched.app
    const { page } = launched

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('wait-claude')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getSnapshot(page))
      .toMatchObject({ sessionState: 'running' })

    const modelMenu = page.locator('[data-model-selector-menu]')
    await prompt.press('Control+Shift+M')
    await expect(modelMenu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(modelMenu).toBeHidden()

    const effortMenu = page.getByRole('menu', { name: 'Reasoning settings' })
    await prompt.press('Control+Shift+E')
    await expect(effortMenu).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(effortMenu).toBeHidden()

    const permissionMenu = page.getByTestId('permission-menu')
    await prompt.press('Control+Shift+A')
    await expect(permissionMenu).toBeVisible()
    await prompt.press('Escape')
    await expect(permissionMenu).toBeHidden()

    expect(await getSnapshot(page)).toMatchObject({ sessionState: 'running' })

    await prompt.press('Escape')
    await expect
      .poll(() => getSnapshot(page))
      .toMatchObject({
        turns: expect.arrayContaining([
          expect.objectContaining({ state: 'cancelled' }),
        ]),
      })

    await prompt.fill('/help')
    await page
      .getByTestId('managed-slash-menu')
      .getByRole('option', { name: /\/help/ })
      .click()
    await expect(prompt).toHaveValue(/Cmd\/Ctrl\+Shift\+M — model selector/)
    await expect(prompt).toHaveValue(/Cmd\/Ctrl\+Shift\+Enter/)
  })

  test('steers the oldest queued Codex message on Ctrl+Shift+Enter', async () => {
    const launched = await openAgentPane(repository ?? '', dataDirectory ?? '')
    app = launched.app
    const { page } = launched

    const claudePrompt = page.getByRole('textbox', { name: /claude prompt/i })
    await claudePrompt.fill('initialize agent pane')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: initialize agent pane',
    )

    const sessionId = (await getSnapshot(page)).sessionId
    await page.evaluate(async (id) => {
      await window.aide.switchManagedSessionProvider(id, {
        mode: 'codex',
        model: 'gpt-5.6-terra',
        effort: 'medium',
      })
    }, sessionId)

    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('wait-codex')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getSnapshot(page))
      .toMatchObject({ sessionState: 'running' })

    // why: a recipient message cannot steer, so it holds the queue open for the next one.
    await page.evaluate(
      async (id) =>
        await window.aide.sendManagedSessionInput(id, 'ask claude', ['Claude']),
      sessionId,
    )
    await prompt.fill('change direction now')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    const queue = page.getByTestId('managed-input-queue')
    await expect(queue).toContainText('change direction now')
    await queue
      .getByRole('button', { name: 'Cancel queued message' })
      .first()
      .click()
    await expect(queue).toContainText('1 queued')

    await prompt.press('Control+Shift+Enter')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Steered: change direction now',
    )
    await expect(queue).toBeHidden()
  })
})
