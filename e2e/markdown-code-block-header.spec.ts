import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-code-header-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function launchAideApp(
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
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function sendPrompt(page: Page, lines: string[]): Promise<void> {
  await page
    .getByRole('textbox', { name: /claude prompt/i })
    .fill(lines.join('\n'))
  await page.getByRole('button', { name: /send prompt/i }).click()
  await expect(page.getByTestId('managed-session-content')).toContainText(
    `Handled: ${lines[0]}`,
  )
}

const longBlock = Array.from({ length: 40 }, (_, index) => `line ${index + 1}`)

test.describe('markdown code block header', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('copies a block, keeps wrap across a relaunch and expands a long block', async () => {
    test.setTimeout(120_000)
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-code-header-e2e-data-'),
    )
    let launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    let page = launched.page
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await page.evaluate(async () => {
      const storage = await window.aide.getStorageSnapshot()
      const workspace = storage.workspaces[0]
      if (!workspace) throw new Error('Workspace unavailable.')
      await window.aide.updateJevSettings(workspace.id, {
        allowProcessing: true,
      })
    })

    await sendPrompt(page, [
      'blocks',
      '```ts',
      'const answer: number = 42',
      'const next = answer + 1',
      '```',
      '```',
      ...longBlock,
      '```',
      '| name | a very long column header that keeps going |',
      '| - | - |',
      `| ${'w'.repeat(300)} | ${'c'.repeat(300)} |`,
    ])
    const content = page.getByTestId('managed-session-content')
    const tsBlock = content
      .getByTestId('markdown-code-block')
      .filter({ hasText: 'const answer' })
    await expect(tsBlock).toContainText('ts')

    await tsBlock.getByRole('button', { name: 'Copy code' }).click()
    await expect(
      tsBlock.getByRole('button', { name: 'Copied code' }),
    ).toBeVisible()
    await expect
      .poll(() => app?.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('const answer: number = 42\nconst next = answer + 1')

    const wrap = tsBlock.getByRole('button', { name: 'Wrap lines' })
    await expect(wrap).toHaveAttribute('aria-pressed', 'false')
    await expect(tsBlock.locator('pre')).toHaveCSS('white-space', 'pre')
    await wrap.click()
    await expect(wrap).toHaveAttribute('aria-pressed', 'true')
    await expect(tsBlock.locator('pre')).toHaveCSS('white-space', 'pre-wrap')

    const long = content
      .getByTestId('markdown-code-block')
      .filter({ hasText: 'line 1' })
    const longPre = long.locator('pre')
    const collapsedHeight = await longPre.evaluate((pre) => pre.clientHeight)
    expect(
      await longPre.evaluate((pre) => pre.scrollHeight > pre.clientHeight),
    ).toBe(true)
    await long.getByRole('button', { name: 'Show all 40 lines' }).click()
    await expect(long.getByRole('button', { name: /show all/i })).toHaveCount(0)
    expect(await longPre.evaluate((pre) => pre.clientHeight)).toBeGreaterThan(
      collapsedHeight,
    )
    await expect(long.getByText('line 40')).toBeVisible()

    const table = content.getByTestId('markdown-table')
    expect(
      await content.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    expect(
      await table
        .locator('.table-block-scroll')
        .evaluate((element) => element.scrollWidth > element.clientWidth),
    ).toBe(true)
    await table.getByRole('button', { name: 'Copy as CSV' }).click()
    await expect
      .poll(() => app?.evaluate(({ clipboard }) => clipboard.readText()))
      .toMatch(
        /^name,a very long column header that keeps going\r\nw{300},c{300}$/,
      )
    await page.screenshot({
      path: 'test-results/markdown-code-block-header.png',
    })

    await app.close()
    launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    page = launched.page
    await sendPrompt(page, ['again', '```ts', 'const again = 1', '```'])
    await expect(
      page
        .getByTestId('markdown-code-block')
        .filter({ hasText: 'const again' })
        .getByRole('button', { name: 'Wrap lines' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  test('types a shell command into a new terminal pane without pressing Enter', async () => {
    test.setTimeout(90_000)
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-code-header-e2e-data-'),
    )
    const launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    const page = launched.page
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await page.evaluate(async () => {
      const storage = await window.aide.getStorageSnapshot()
      const workspace = storage.workspaces[0]
      if (!workspace) throw new Error('Workspace unavailable.')
      await window.aide.updateJevSettings(workspace.id, {
        allowProcessing: true,
      })
    })

    await sendPrompt(page, ['run', '```bash', 'touch ran-marker', '```'])
    await page
      .getByTestId('markdown-code-block')
      .filter({ hasText: 'touch ran-marker' })
      .getByRole('button', { name: 'Run in terminal' })
      .click()

    await expect(page.locator('.xterm-rows')).toContainText('touch ran-marker')
    // why: a pressed Enter would create the file within this window.
    await page.waitForTimeout(1500)
    expect(existsSync(path.join(repository, 'ran-marker'))).toBe(false)
  })
})
