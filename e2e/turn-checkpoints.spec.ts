import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-checkpoint-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('turn checkpoints', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('previews and restores code, then retries opening without repeating restoration', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-checkpoint-e2e-data-'),
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

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('change the readme')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: change the readme',
    )
    writeFileSync(path.join(repository, 'README.md'), 'after\n')

    await page.getByRole('button', { name: 'Restore checkpoint' }).click()
    await expect(
      page.getByRole('heading', { name: 'Restore checkpoint' }),
    ).toBeVisible()
    await expect(page.getByLabel('Previewed file changes')).toContainText(
      'README.md',
    )
    await page.getByLabel('Code and conversation').check()
    await page.screenshot({
      path: test.info().outputPath('checkpoint-preview.png'),
    })
    await page.evaluate(() => {
      const openDatabase = indexedDB.open.bind(indexedDB)
      indexedDB.open = () => {
        indexedDB.open = openDatabase
        throw new Error('Synthetic draft storage failure')
      }
    })
    await page
      .getByRole('button', { name: 'Restore to new conversation' })
      .click()

    await expect(page.getByRole('alert')).toContainText(
      'Synthetic draft storage failure',
    )
    expect(readFileSync(path.join(repository, 'README.md'), 'utf8')).toBe(
      'before\n',
    )
    writeFileSync(
      path.join(repository, 'README.md'),
      'user edit after restore\n',
    )
    await page
      .getByRole('button', { name: 'Retry opening conversation' })
      .click()

    const restoredPane = page.locator(
      '.workspace-slide[data-active-workspace="true"] [data-active-surface="true"]',
    )
    await expect(
      restoredPane.getByRole('textbox', { name: /claude prompt/i }),
    ).toHaveValue('change the readme')
    expect(readFileSync(path.join(repository, 'README.md'), 'utf8')).toBe(
      'user edit after restore\n',
    )
    expect(
      (await page.evaluate(() => window.aide.getTaskLibrary())).tasks,
    ).toHaveLength(2)
    await expect(
      restoredPane.getByTestId('managed-session-content'),
    ).not.toContainText('Handled: change the readme')
  })
})
