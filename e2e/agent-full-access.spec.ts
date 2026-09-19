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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-full-access-e2e-'))
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

async function selectPermissionMode(
  page: Page,
  current: string,
  next: string,
): Promise<void> {
  await page.getByRole('button', { exact: true, name: current }).click()
  await page.getByRole('button', { name: new RegExp(`^${next}`) }).click()
  await expect(
    page.getByRole('button', { exact: true, name: next }),
  ).toBeVisible()
}

async function pendingApprovalCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const session = Object.values(
      await window.aide.getManagedSessionSnapshots(),
    )[0]
    return session?.pendingApprovals.length ?? 0
  })
}

test.describe('agent full access', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('auto-allows requests the permission mode covers and still asks for the rest', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-full-access-e2e-data-'),
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

    await selectPermissionMode(page, 'Supervised', 'Full access')
    await sendPrompt(page, 'approval')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Allowed by Full access: Bash: rm -rf build && bun run build',
    )
    await expect(page.getByTestId('managed-approval-command')).toHaveCount(0)
    expect(await pendingApprovalCount(page)).toBe(0)

    await selectPermissionMode(page, 'Full access', 'Auto-accept edits')
    await sendPrompt(page, 'edit approval')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Allowed by Auto-accept edits: Edit: README.md',
    )
    await expect(page.getByTestId('managed-approval-diff')).toHaveCount(0)
    expect(await pendingApprovalCount(page)).toBe(0)

    await sendPrompt(page, 'approval')
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'rm -rf build && bun run build',
    )
    await page.keyboard.press('1')
    await expect(page.getByTestId('managed-approval-command')).toHaveCount(0)

    await selectPermissionMode(page, 'Auto-accept edits', 'Supervised')
    await sendPrompt(page, 'approval')
    await expect(page.getByTestId('managed-approval-command')).toHaveText(
      'rm -rf build && bun run build',
    )
    expect(await pendingApprovalCount(page)).toBe(1)
  })
})
