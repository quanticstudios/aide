import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-thinking-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('agent thinking', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows thinking live, then collapses it with its duration', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-thinking-e2e-data-'))
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

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    // why: the live row must show within 200 ms of the first delta, so the page records when it first appears.
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (
          document.querySelector(
            '[data-testid="managed-content-reasoning-text"][data-state="live"]',
          )
        ) {
          Object.assign(window, { liveThinkingSeenAt: Date.now() })
          observer.disconnect()
        }
      })
      observer.observe(document.body, { childList: true, subtree: true })
    })
    await prompt.fill('think-stream')
    await page.getByRole('button', { name: /send prompt/i }).click()

    const live = page.locator(
      '[data-testid="managed-content-reasoning-text"][data-state="live"]',
    )
    await expect(live).toContainText('Thinking')
    await expect(live.locator('.thinking-shimmer')).not.toHaveCSS(
      'animation-name',
      'none',
    )
    await expect(live.getByTestId('thinking-dot')).toBeHidden()

    const reasoning = page.getByTestId('managed-content-reasoning-text')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Done thinking.',
    )
    await expect(reasoning).toHaveAttribute('data-state', 'done')
    await expect(reasoning).toContainText(/Thought for [23]s/)
    await expect(reasoning.getByTestId('thinking-preview')).toHaveText(
      'Checking the latest idea. step 16 step 17 step 18 step 19 step 20 step 21 step 22 step 23 step 24 step 25 step 26 step 27 step 28 step 29',
    )
    await expect(reasoning).not.toContainText('step 0')

    const firstDeltaToLiveRow = await page.evaluate(async () => {
      const snapshots = await window.aideSessions.getSessions()
      const item = Object.values(snapshots)
        .flatMap((snapshot) => snapshot.content)
        .find((entry) => entry.kind === 'reasoning-text')
      const seenAt = (window as unknown as { liveThinkingSeenAt: number })
        .liveThinkingSeenAt
      return seenAt - Date.parse(item?.createdAt ?? '')
    })
    expect(firstDeltaToLiveRow).toBeLessThanOrEqual(200)

    await reasoning.getByRole('button', { expanded: false }).click()
    await expect(reasoning.locator('pre')).toContainText('step 0')
    await expect(reasoning.locator('pre')).toContainText(
      'Checking the latest idea.',
    )

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await prompt.fill('think-stream')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(live.getByTestId('thinking-dot')).toBeVisible()
    await expect(live.locator('.thinking-shimmer')).toHaveCSS(
      'animation-name',
      'none',
    )
  })
})
