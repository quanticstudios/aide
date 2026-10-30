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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-tasks-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

test.describe('agent tasks', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows a turn checklist and a nested subagent row', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-tasks-e2e-data-'))
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
    await prompt.fill('todos')
    await page.getByRole('button', { name: /send prompt/i }).click()

    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Tracking three tasks.',
    )
    const taskList = page.getByTestId('managed-task-list')
    await expect(taskList).toContainText('1/3')
    await expect(page.getByTestId('managed-content-tool-call')).toHaveCount(0)

    await taskList.getByText('Tasks').click()
    await expect(taskList.getByRole('listitem')).toHaveCount(3)
    await expect(taskList.getByTestId('managed-task-in_progress')).toHaveText(
      'Write the checklist',
    )
    await expect(taskList.getByTestId('managed-task-completed')).toHaveText(
      'Read the ticket',
    )

    await prompt.fill('subagent')
    await page.getByRole('button', { name: /send prompt/i }).click()

    const subagentRow = page.getByTestId('managed-content-tool-call')
    await expect(subagentRow).toContainText('Explore the repo')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'The subagent finished exploring.',
    )
    await expect(subagentRow).toHaveAttribute('data-status', 'completed')
    await expect(subagentRow.getByTestId('tool-call-duration')).toHaveText(/s$/)
    await expect(page.getByTestId('tool-call-output')).toHaveCount(0)

    await page.getByTestId('managed-tool-call-group').locator('summary').click()
    await page.getByTestId('tool-call-Task').click()
    const output = page.getByTestId('tool-call-output')
    await expect(output).toContainText('Listing the repo root.')
    await expect(output).toContainText('Found 12 source files.')
    await page.screenshot({
      path: 'docs/verification/agent-tasks-2026-09-19.png',
      fullPage: true,
    })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('managed-task-list')).toContainText('1/3')
    await expect(page.getByTestId('managed-content-tool-call')).toContainText(
      'Explore the repo',
    )
  })
})
