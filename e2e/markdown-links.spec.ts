import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const repository = mkdtempSync(
    path.join(tmpdir(), 'aide-markdown-links-e2e-'),
  )
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  mkdirSync(path.join(repository, 'src'))
  writeFileSync(path.join(repository, 'src/foo.ts'), 'export {}\n')
  runGit(repository, ['add', '.'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('markdown links', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('opens https links through the system browser and turns file paths into chips', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-markdown-links-e2e-data-'),
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

    await app.evaluate(({ shell }) => {
      const opened: string[] = []
      Object.assign(globalThis, { openedUrls: opened })
      shell.openExternal = async (url) => {
        opened.push(url)
      }
    })
    const openedUrls = () =>
      app?.evaluate(
        () => (globalThis as unknown as { openedUrls: string[] }).openedUrls,
      )

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill(
      'links: [the docs](https://example.com/docs), [bad](javascript:alert(1)) and `src/foo.ts:42`',
    )
    await page.getByRole('button', { name: /send prompt/i }).click()
    const content = page.getByTestId('managed-session-content')
    await expect(content).toContainText('Handled: links')

    const link = content.getByRole('link', { name: 'the docs' }).last()
    await link.click()
    await link.click({ button: 'middle' })
    await link.click({ modifiers: ['Control'] })
    await content.getByText('bad', { exact: true }).last().click()
    await page.evaluate(async () => {
      await window.aide.openExternal('file:///etc/passwd')
      await window.aide.openExternal('vscode://file/etc/passwd')
    })
    await expect
      .poll(openedUrls)
      .toEqual([
        'https://example.com/docs',
        'https://example.com/docs',
        'https://example.com/docs',
      ])
    expect(app.windows()).toHaveLength(1)

    await expect(
      content.getByRole('button', { name: 'src/foo.ts:42' }).last(),
    ).toBeVisible()

    const inlineScriptRan = await page.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'window.inlineScriptRan = true'
      document.head.append(script)
      return 'inlineScriptRan' in window
    })
    expect(inlineScriptRan).toBe(false)
    await page.screenshot({ path: 'test-results/markdown-links.png' })
  })
})
