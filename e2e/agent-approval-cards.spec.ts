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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-approval-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const prompt = page.getByRole('textbox', { name: /claude prompt/i })
  await prompt.fill(text)
  await page.getByRole('button', { name: /send prompt/i }).click()
}

async function pendingApprovalCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const session = Object.values(
      await window.aide.getManagedSessionSnapshots(),
    )[0]
    return session?.pendingApprovals.length ?? 0
  })
}

async function openApprovalPane(
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
  return { app, page }
}

test.describe('agent approval cards', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows the command and the diff behind an approval and resolves from the keyboard', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-approval-e2e-data-'))
    const launched = await openApprovalPane(repository, dataDirectory)
    app = launched.app
    const { page } = launched

    await sendPrompt(page, 'approval')
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'rm -rf build && bun run build',
    )
    await page.screenshot({ path: '/tmp/aide-approval-command.png' })
    await page.keyboard.press('1')
    await expect(page.getByTestId('managed-approval-command')).toHaveCount(0)
    expect(await pendingApprovalCount(page)).toBe(0)

    await sendPrompt(page, 'edit approval')
    await expect(page.getByTestId('managed-approval-file-path')).toHaveText(
      'README.md',
    )
    const diff = page.getByTestId('managed-approval-diff')
    await expect(diff).toContainText('before')
    await expect(diff).toContainText('after')
    await page.screenshot({ path: '/tmp/aide-approval-diff.png' })
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('managed-approval-diff')).toHaveCount(0)
    expect(await pendingApprovalCount(page)).toBe(0)

    await sendPrompt(page, 'after the denial')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: after the denial',
    )
  })
  test('counts queued approvals and denies one with composer feedback for Claude and Codex', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-approval-e2e-data-'))
    const launched = await openApprovalPane(repository, dataDirectory)
    app = launched.app
    const { page } = launched
    const content = page.getByTestId('managed-session-content')
    const counter = page.getByTestId('managed-approval-counter')
    const deny = page.getByRole('button', { name: 'Deny with this feedback' })

    await sendPrompt(page, 'three approvals')
    await expect(counter).toHaveText('1 of 3')
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'echo one',
    )
    await page.keyboard.press('1')
    await expect(counter).toHaveText('1 of 2')
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'echo two',
    )

    const claudePrompt = page.getByRole('textbox', { name: /claude prompt/i })
    await expect(deny).toHaveCount(0)
    await claudePrompt.fill('Print it with printf instead.')
    await deny.click()
    await expect(content).toContainText(
      'claude got the denial reason: Print it with printf instead.',
    )
    await expect(claudePrompt).toHaveValue('')
    await expect(counter).toHaveCount(0)
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'echo three',
    )
    await page.keyboard.press('3')
    await expect(page.getByTestId('managed-approval-command')).toHaveCount(0)
    expect(await pendingApprovalCount(page)).toBe(0)

    await page.evaluate(async () => {
      const session = Object.values(
        await window.aide.getManagedSessionSnapshots(),
      )[0]
      if (!session) throw new Error('Session unavailable.')
      await window.aide.switchManagedSessionProvider(session.sessionId, {
        effort: 'medium',
        mode: 'codex',
        model: 'gpt-5.6-terra',
      })
    })
    const codexPrompt = page.getByRole('textbox', { name: /codex prompt/i })
    await codexPrompt.fill('approval')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'rm -rf build && bun run build',
    )
    await codexPrompt.fill('Keep the build folder.')
    await codexPrompt.press('Enter')
    await expect(content).toContainText(
      'codex got the denial reason: Keep the build folder.',
    )
    expect(await pendingApprovalCount(page)).toBe(0)
  })
})
