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

// Computed values of the tokens each view reads, per palette.
const EXPECTED = {
  dark: {
    canvas: 'rgb(8, 9, 12)',
    diffTheme: 'dark',
    keyword: 'rgb(249, 117, 131)',
    terminalText: 'rgb(242, 243, 245)',
  },
  light: {
    canvas: 'rgb(236, 238, 242)',
    diffTheme: 'light',
    keyword: 'rgb(207, 34, 46)',
    terminalText: 'rgb(20, 22, 27)',
  },
} as const

function runGit(workingDirectory: string, arguments_: string[]): void {
  execFileSync('git', arguments_, {
    cwd: workingDirectory,
    env: gitEnvironment,
  })
}

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-theme-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
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

async function pickTheme(page: Page, label: string): Promise<void> {
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings
    .getByRole('navigation', { name: 'Settings categories' })
    .getByRole('button', { name: 'Appearance', exact: true })
    .click()
  const option = settings.getByRole('radio', { name: new RegExp(`^${label}`) })
  await option.click()
  await expect(option).toHaveAttribute('aria-checked', 'true')
}

test.describe('theme switching', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('repaints the canvas, code, diff and terminal without a reload', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-theme-e2e-data-'))
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
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^terminal/i }).click()
    await expect(page.locator('.terminal-pane .xterm-rows')).not.toHaveText('')
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

    await sendPrompt(page, ['code', '```ts', 'const answer = 42', '```'])
    const keyword = page
      .getByTestId('managed-session-content')
      .locator(
        'pre[data-language="typescript"] span[style*="--shiki-token-keyword"]',
      )
      .first()
    await expect(keyword).toHaveText('const')
    await sendPrompt(page, ['edit readme'])
    const card = page.getByTestId('changed-files-card')
    await expect(card).toContainText('1 file changed')
    await card.locator('[data-path="README.md"]').click()
    const diff = page.getByTestId('diff-panel')
    await expect(diff.getByTestId('diff-panel-file')).toContainText(
      'edited by the turn',
    )

    await page.getByRole('button', { name: 'Open sidebar' }).click()

    // why: a reload would drop this marker, so its survival proves the switch is live.
    await page.evaluate(() => {
      document.documentElement.dataset.themeE2eMarker = 'kept'
    })

    for (const [label, palette] of [
      ['Dark', 'dark'],
      ['Light', 'light'],
      ['Dark', 'dark'],
    ] as const) {
      await pickTheme(page, label)
      const expected = EXPECTED[palette]
      await expect(page.locator('html')).toHaveAttribute(
        'data-palette',
        palette,
      )
      await page.screenshot({
        path: `test-results/theme-settings-${palette}.png`,
      })
      await page
        .getByRole('dialog', { name: 'Settings', exact: true })
        .getByRole('button', { name: 'Back to app' })
        .click()

      await expect(page.locator('body')).toHaveCSS(
        'background-color',
        expected.canvas,
      )
      await expect(keyword).toHaveCSS('color', expected.keyword)
      await expect(diff.locator('.diff-tailwindcss-wrapper')).toHaveAttribute(
        'data-theme',
        expected.diffTheme,
      )
      await expect(page.locator('.terminal-pane .xterm-rows')).toHaveCSS(
        'color',
        expected.terminalText,
      )
      await page.screenshot({ path: `test-results/theme-main-${palette}.png` })
    }

    await expect(page.locator('html')).toHaveAttribute(
      'data-theme-e2e-marker',
      'kept',
    )
  })
})
