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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-queue-e2e-'))
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
      AIDE_FAKE_STREAM_SECONDS: '600',
      AIDE_FAKE_STREAM_TOKENS_PER_SECOND: '5',
      AIDE_FAKE_STREAM_TOOL_EVERY: '0',
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
    const session = Object.values(await window.aideSessions.getSessions())[0]
    if (!session) throw new Error('Managed session did not start.')
    return session
  })
}

async function promptTexts(page: Page): Promise<string[]> {
  const snapshot = await getSnapshot(page)
  return snapshot.content
    .filter((item) => item.kind === 'user-prompt')
    .map((item) => item.text)
}

async function startLongTurn(page: Page) {
  await page.evaluate(() =>
    localStorage.setItem('aide.send-while-running', 'queue'),
  )
  const prompt = page.getByRole('textbox', { name: /claude prompt/i })
  await prompt.fill('perf-stream')
  await page.getByRole('button', { name: 'Send prompt' }).click()
  await expect
    .poll(() => getSnapshot(page).catch(() => null))
    .toMatchObject({ sessionState: 'running' })
  return prompt
}

test.describe('agent message queue', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.beforeEach(() => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-queue-e2e-data-'))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('queues on Enter, steers on Mod+Enter, then sends one per finished turn', async () => {
    const launched = await openAgentPane(repository ?? '', dataDirectory ?? '')
    app = launched.app
    const { page } = launched
    const prompt = await startLongTurn(page)

    const strip = page.getByTestId('managed-queued-messages')
    const rows = strip.getByTestId('managed-queued-message')
    for (const text of ['first', 'second', 'doomed']) {
      await prompt.fill(text)
      await prompt.press('Enter')
      await expect(rows.filter({ hasText: text })).toHaveCount(1)
    }
    await expect(rows).toHaveText([/first/, /second/, /doomed/])

    await rows
      .filter({ hasText: 'doomed' })
      .getByRole('button', { name: 'Delete' })
      .click()
    await rows
      .filter({ hasText: 'second' })
      .getByRole('button', { name: 'Move up' })
      .click()
    await expect(rows).toHaveText([/second/, /first/])

    await rows
      .filter({ hasText: 'first' })
      .getByRole('button', { name: 'Edit' })
      .click()
    const editor = strip.getByRole('textbox', { name: 'Edit queued message' })
    await editor.fill('first edited')
    await editor.press('Enter')
    await expect(rows).toHaveText([/second/, /first edited/])
    expect(await promptTexts(page)).toEqual(['perf-stream'])

    await prompt.fill('steer now')
    await prompt.press('Control+Enter')

    await expect(page.getByText('Steered: steer now')).toBeVisible()
    await expect
      .poll(() => promptTexts(page))
      .toEqual(['perf-stream', 'steer now', 'second', 'first edited'])
    await expect(page.getByText('Handled: first edited')).toBeVisible()
    await expect(strip).toHaveCount(0)
    expect((await getSnapshot(page)).turns).toHaveLength(3)
  })

  test('keeps the queue across a renderer reload and promotes one to steer', async () => {
    const launched = await openAgentPane(repository ?? '', dataDirectory ?? '')
    app = launched.app
    const { page } = launched
    const prompt = await startLongTurn(page)

    await prompt.fill('promote me')
    await prompt.press('Enter')
    const rows = page.getByTestId('managed-queued-message')
    await expect(rows).toHaveText([/promote me/])

    await page.reload()
    await expect(rows).toHaveText([/promote me/])

    await rows.getByRole('button', { name: 'Steer now' }).click()
    await expect(page.getByText('Steered: promote me')).toBeVisible()
    await expect(page.getByTestId('managed-queued-messages')).toHaveCount(0)
    expect(await promptTexts(page)).toEqual(['perf-stream', 'promote me'])
  })
})
