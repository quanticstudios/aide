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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-empty-state-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function addAgentPane(page: Page): Promise<void> {
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent unified/i }).click()
}

async function openAgentPane(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await addAgentPane(page)

  await app.evaluate(() => {
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
  return page
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const pane = page.getByTestId('managed-agent-pane').last()
  await pane.getByRole('textbox', { name: /claude prompt/i }).fill(text)
  await pane.getByRole('button', { name: /send prompt/i }).click()
}

test.describe('agent empty state', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.beforeEach(async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-empty-state-e2e-data-'),
    )
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
  })

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows the workspace context and reuses a recent prompt', async () => {
    if (!app) throw new Error('App did not launch.')
    const page = await openAgentPane(app)
    const workspace = await page.evaluate(async () => {
      const storage = await window.aide.getStorageSnapshot()
      return storage.workspaces[0]
    })
    if (!workspace) throw new Error('Workspace unavailable.')

    const emptyState = page.getByTestId('managed-empty-state')
    await expect(emptyState).toContainText(workspace.name)
    await expect(emptyState).toContainText(workspace.branchName)
    await expect(emptyState).toContainText('Claude')
    await expect(emptyState).not.toContainText('Recent prompts')
    await expect(
      page.getByRole('textbox', { name: /claude prompt/i }),
    ).toBeFocused()

    await sendPrompt(page, 'Explain the build setup')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: Explain the build setup',
    )

    await addAgentPane(page)
    const newPane = page.getByTestId('managed-agent-pane').last()
    const recentPrompt = newPane
      .getByTestId('managed-empty-state')
      .getByRole('button', { name: 'Explain the build setup' })
    await expect(recentPrompt).toBeVisible()
    await recentPrompt.click()

    const newPrompt = newPane.getByRole('textbox', { name: /claude prompt/i })
    await expect(newPrompt).toHaveValue('Explain the build setup')
    await expect(newPrompt).toBeFocused()
    await expect(
      newPane.getByTestId('managed-content-user-prompt'),
    ).toHaveCount(0)
  })

  test('marks a finished turn that has no assistant text', async () => {
    if (!app) throw new Error('App did not launch.')
    const page = await openAgentPane(app)

    await sendPrompt(page, 'empty reply')
    await expect(page.getByTestId('empty-response')).toHaveText(
      '(empty response)',
    )
    await expect(
      page.getByTestId('managed-content-assistant-text'),
    ).toHaveCount(0)
  })

  test('collapses a long user message and copies the full text', async () => {
    if (!app) throw new Error('App did not launch.')
    const page = await openAgentPane(app)
    const longPrompt = Array.from(
      { length: 12 },
      (_, index) => `prompt line ${index + 1}`,
    ).join('\n')

    await sendPrompt(page, longPrompt)
    const message = page.getByTestId('managed-content-user-prompt')
    const bubble = message.getByTestId('user-message-bubble')
    await expect(bubble).toContainText('prompt line 8')
    await expect(bubble).not.toContainText('prompt line 12')

    await message.getByRole('button', { name: 'Show more' }).click()
    await expect(bubble).toContainText('prompt line 12')
    await message.getByRole('button', { name: 'Show less' }).click()
    await expect(bubble).not.toContainText('prompt line 12')

    await message.hover()
    await message
      .getByTestId('user-message-actions')
      .getByRole('button', { name: 'Copy message', exact: true })
      .click()
    await expect
      .poll(() => app?.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(longPrompt)
  })
})
