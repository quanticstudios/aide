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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-turn-diff-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('turn diff chip', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows the turn diff chip and expands the turn patch', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-turn-diff-e2e-data-'))
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
    await prompt.fill('say hello')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: say hello',
    )
    await expect(page.getByTestId('turn-diff-chip')).toHaveCount(0)

    await prompt.fill('edit readme')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: edit readme',
    )

    const chip = page.getByTestId('turn-diff-chip')
    await expect(chip).toHaveCount(1)
    await expect(chip).toHaveText('+1 -0 · 1 file')

    await chip.click()
    const files = page.getByTestId('turn-diff-files')
    await expect(files).toContainText('README.md')
    await expect(files).toContainText('edited by the turn')
    await expect(
      files.locator('[data-component="git-diff-view"]'),
    ).toHaveAttribute('data-highlighter', 'aide-shiki')
    await page.screenshot({ path: 'test-results/agent-turn-diff.png' })

    await chip.click()
    await expect(files).toHaveCount(0)
  })
})
