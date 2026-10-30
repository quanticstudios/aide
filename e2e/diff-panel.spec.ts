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

// why: each scope gets its own file, so a scope showing another scope's file fails the test.
function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-diff-panel-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  runGit(repository, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  runGit(repository, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])
  runGit(repository, ['checkout', '-b', 'feature'])
  mkdirSync(path.join(repository, 'src', 'feature'), { recursive: true })
  writeFileSync(path.join(repository, 'src', 'feature', 'branch.ts'), 'one\n')
  runGit(repository, ['add', 'src'])
  runGit(repository, ['commit', '-m', 'Branch work'])
  writeFileSync(path.join(repository, 'notes.txt'), 'local notes\n')
  return repository
}

test.describe('diff panel', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('opens a turn file and switches between the three scopes', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-diff-panel-e2e-data-'),
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
    await prompt.fill('edit readme')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: edit readme',
    )

    const card = page.getByTestId('changed-files-card')
    await expect(card).toContainText('1 file changed')
    await card.locator('[data-path="README.md"]').click()

    const panel = page.getByTestId('diff-panel')
    const tree = panel.getByTestId('changed-files-tree')
    const fileDiff = panel.getByTestId('diff-panel-file')
    await expect(panel.getByRole('tab', { name: 'Turn' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await expect(tree.locator('[data-path]')).toHaveCount(1)
    await expect(tree.locator('[data-path="README.md"]')).toBeVisible()
    await expect(fileDiff).toContainText('edited by the turn')

    await panel.getByRole('tab', { name: 'Branch' }).click()
    await expect(tree.locator('[data-path="src/feature"]')).toBeVisible()
    await expect(
      tree.locator('[data-path="src/feature/branch.ts"]'),
    ).toBeVisible()
    await expect(tree.locator('[data-path]')).toHaveCount(2)
    await expect(fileDiff).toContainText('one')

    await panel.getByRole('tab', { name: 'Uncommitted' }).click()
    await expect(tree.locator('[data-path="README.md"]')).toBeVisible()
    await expect(tree.locator('[data-path="notes.txt"]')).toBeVisible()
    await expect(tree.locator('[data-path]')).toHaveCount(2)
    await tree.locator('[data-path="notes.txt"]').click()
    await expect(fileDiff).toContainText('local notes')
    await page.screenshot({ path: 'test-results/diff-panel.png' })

    await panel.getByRole('button', { name: 'Close diff panel' }).click()
    await expect(panel).toHaveCount(0)
  })
})
