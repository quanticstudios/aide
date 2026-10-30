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

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-limit-e2e-'))
  const run = (arguments_: string[]) =>
    execFileSync('git', arguments_, { cwd: repository, env: gitEnvironment })
  run(['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  run(['add', 'README.md'])
  run(['commit', '-m', 'Initial'])
  return repository
}

test.describe('usage limit and provider error banners', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  async function openAgentPane(fakeProviders: string): Promise<Page> {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-limit-e2e-data-'))
    app = await electron.launch({
      args: [workspaceDirectory, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDirectory,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...process.env,
        AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
        AIDE_FAKE_MANAGED_PROVIDERS: fakeProviders,
        AIDE_SOFTWARE_RENDERING: '1',
        AIDE_TEST_PROJECT_PICK_PATH: repository,
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        LANG: 'en_US.UTF-8',
        OZONE_PLATFORM: 'x11',
        SWAYSOCK: '',
        TYPESAFE_API_KEY: 'synthetic-e2e-key',
        TZ: 'America/New_York',
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
    return page
  }

  async function send(page: Page, text: string): Promise<void> {
    await page.getByRole('textbox', { name: /claude prompt/i }).fill(text)
    await page.getByRole('button', { name: /send prompt/i }).click()
  }

  test('resumes once at the reset, in local time, and not after the user typed', async () => {
    const page = await openAgentPane('1')
    // 18:50 UTC is 2:50 PM in New York on 2026-10-30.
    await page.clock.install({ time: new Date('2026-10-30T18:50:00.000Z') })
    const prompts = page.getByTestId('managed-content-user-prompt')
    const banner = page.getByTestId('usage-limit-banner')

    // The fake provider takes the reset in unix seconds: 19:00 UTC, 3:00 PM in New York.
    await send(page, 'usage limit 1793386800')
    await expect(banner).toContainText('Claude usage limit reached')
    await expect(banner).toContainText(/5-hour limit resets at 3:00\sPM\./)

    await banner.getByRole('button', { name: 'Resume at reset' }).click()
    await expect(banner).toContainText('Aide will send "continue" then.')
    await page.clock.fastForward('09:00')
    await expect(prompts.filter({ hasText: 'continue' })).toHaveCount(0)
    await page.clock.fastForward('01:00')
    await expect(prompts.filter({ hasText: 'continue' })).toHaveCount(1)
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: continue',
    )
    await expect(banner).toBeHidden()

    await send(page, 'usage limit 1793388600')
    await expect(banner).toContainText(/resets at 3:30\sPM\./)
    await banner.getByRole('button', { name: 'Resume at reset' }).click()
    await banner.getByRole('button', { name: 'Cancel resume' }).click()
    await expect(
      banner.getByRole('button', { name: 'Resume at reset' }),
    ).toBeVisible()

    await banner.getByRole('button', { name: 'Resume at reset' }).click()
    await page
      .getByRole('textbox', { name: /claude prompt/i })
      .fill('a draft I am writing')
    await page.clock.fastForward('35:00')
    await expect(banner).toContainText(
      'Did not resume, because you typed since.',
    )
    await expect(prompts.filter({ hasText: 'continue' })).toHaveCount(1)
  })

  test('names the fix for missing auth and retries the prompt', async () => {
    const page = await openAgentPane('1')
    const banner = page.getByTestId('thread-error-banner')

    await send(page, 'auth error')
    await expect(banner).toContainText('Claude is not signed in')
    await expect(banner).toContainText(
      'Run `claude` in a terminal and sign in with /login, then retry.',
    )
    await banner.getByRole('button', { name: 'Retry' }).click()
    await expect(
      page
        .getByTestId('managed-content-user-prompt')
        .filter({ hasText: 'auth error' }),
    ).toHaveCount(2)
    await expect(banner).toBeVisible()
  })

  test('names the fix for a missing CLI', async () => {
    const page = await openAgentPane('missing-cli')
    const banner = page.getByTestId('thread-error-banner')

    await send(page, 'hello')
    await expect(banner).toContainText('Claude CLI not found')
    await expect(banner).toContainText(
      'Configured executable "claude" was not found in PATH.',
    )
    await banner.getByRole('button', { name: 'Retry' }).click()
    await expect(banner).toContainText('Claude CLI not found')
  })
})
