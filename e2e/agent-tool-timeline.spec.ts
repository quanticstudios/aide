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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-tool-timeline-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('agent tool timeline', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  async function openAgentPane(): Promise<Page> {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-tool-timeline-e2e-data-'),
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

    return page
  }

  test('shows one expandable row per tool call and keeps it after a reload', async () => {
    const page = await openAgentPane()
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('tools')
    await page.getByRole('button', { name: /send prompt/i }).click()

    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Ran three tools.',
    )
    const rows = page.getByTestId('managed-content-tool-call')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Bash')
    await expect(rows.nth(1)).toContainText('Edit')
    await expect(rows.nth(2)).toContainText('Read')
    await expect(rows.nth(0)).toContainText('exit 0')
    await expect(page.getByTestId('tool-call-output')).toHaveCount(0)

    const group = page.getByTestId('managed-tool-call-group')
    await expect(group).toHaveCount(1)
    await expect(group).toContainText(
      'Ran 1 command, edited 1 file, read 1 file',
    )
    await expect(page.getByTestId('turn-worked-for')).toContainText(
      /^Worked for /,
    )
    await group.locator('summary').click()
    await page.getByTestId('tool-call-Bash').click()
    await expect(page.getByTestId('tool-call-output')).toHaveText('hello')
    await expect(rows.nth(0)).toContainText('echo hello')

    await page.getByTestId('tool-call-Edit').click()
    const diff = page.getByTestId('tool-call-diff')
    await expect(diff).toBeVisible()
    await expect(diff).toContainText('before')
    await expect(diff).toContainText('after')
    await page.screenshot({
      path: 'docs/verification/agent-tool-timeline-2026-09-19.png',
      fullPage: true,
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const reloadedRows = page.getByTestId('managed-content-tool-call')
    await expect(reloadedRows).toHaveCount(3)
    await expect(reloadedRows.nth(0)).toContainText('exit 0')
    await expect(page.getByTestId('tool-call-duration')).toHaveCount(3)
    await expect(page.getByTestId('tool-call-output')).toHaveCount(0)
  })

  test('draws each tool kind, ticks a running tool and marks a failed exit code red', async () => {
    const page = await openAgentPane()
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('tool kinds')
    await page.getByRole('button', { name: /send prompt/i }).click()

    const group = page.getByTestId('managed-tool-call-group')
    await group.locator('summary').click()
    await expect(page.getByTestId('tool-call-elapsed')).toHaveText(/^[1-9]s$/)

    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Ran every tool kind.',
    )
    await expect(group.locator('summary')).toContainText(
      'Ran 2 commands, ran 1 search, ran 1 web search, ran 1 subagent, called 1 MCP tool',
    )
    const rows = page.getByTestId('managed-content-tool-call')
    await expect(rows).toHaveCount(6)
    await expect(page.getByTestId('tool-call-duration')).toHaveCount(6)
    for (const header of await page
      .locator('[data-testid^="tool-call-"][aria-expanded]')
      .all()) {
      await expect(header).not.toContainText('{')
    }

    const exitCode = rows.nth(0).getByTestId('tool-call-exit-code')
    await expect(exitCode).toHaveText('exit 1')
    await expect(exitCode).toHaveClass(/text-accent-red/)
    await rows.nth(0).getByRole('button').first().click()
    const output = rows.nth(0).getByTestId('tool-call-output')
    await expect(output).toHaveText('error README.md: missing title')
    await expect(output.locator('.text-accent-red')).toHaveText('error')

    await page.getByTestId('tool-call-Grep').click()
    await expect(
      rows.nth(1).getByRole('button', { name: 'README.md:1' }),
    ).toBeVisible()
    await page.getByTestId('tool-call-WebSearch').click()
    await expect(
      rows.nth(2).getByRole('link', { name: 'Electron releases' }),
    ).toBeVisible()
    await page.getByTestId('tool-call-Task').click()
    await expect(
      rows.nth(3).getByTestId('tool-call-subagent-summary'),
    ).toHaveText('Explore · 2 tool calls: Read 1 file, ran 1 search')
    await page.getByTestId('tool-call-mcp__linear__get_issue').click()
    await expect(rows.nth(4)).toContainText('linear · get_issue')
    await expect(rows.nth(4).getByTestId('tool-call-arguments')).toHaveText(
      '{\n  "id": "ENG-1"\n}',
    )
  })
})
