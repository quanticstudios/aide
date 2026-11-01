import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

const workspaceDirectory = path.resolve(import.meta.dirname, '..')
const pitwall = process.env.AIDE_E2E_PITWALL
const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

function runGit(cwd: string, args: string[]): void {
  execFileSync('git', args, { cwd, env: gitEnvironment })
}

/** A repository on branch fix-flake whose pull request #241 has a failing check and a review thread on README.md line 2, as e2e/fake-gh/gh reports them. */
function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-pr-flow-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  runGit(repository, ['checkout', '-b', 'fix-flake'])
  const fixtures = path.join(repository, '.git', 'aide-e2e-gh')
  mkdirSync(fixtures)
  writeFileSync(
    path.join(fixtures, 'pr.json'),
    JSON.stringify({
      baseRefName: 'main',
      headRefOid: 'abc123',
      isDraft: false,
      mergeable: 'MERGEABLE',
      number: 241,
      reviewDecision: 'CHANGES_REQUESTED',
      state: 'OPEN',
      statusCheckRollup: [
        {
          __typename: 'CheckRun',
          conclusion: 'FAILURE',
          detailsUrl: 'https://ci.example.com/linux',
          name: 'linux',
          status: 'COMPLETED',
        },
        {
          __typename: 'CheckRun',
          conclusion: 'SUCCESS',
          detailsUrl: 'https://ci.example.com/macos',
          name: 'macos',
          status: 'COMPLETED',
        },
      ],
      url: 'https://github.com/example/widgets/pull/241',
    }),
  )
  writeFileSync(
    path.join(fixtures, 'checks.json'),
    JSON.stringify([
      { bucket: 'fail', link: 'https://ci.example.com/linux', name: 'linux' },
      { bucket: 'pass', link: 'https://ci.example.com/macos', name: 'macos' },
    ]),
  )
  writeFileSync(
    path.join(fixtures, 'reviews.json'),
    JSON.stringify([
      {
        data: {
          repository: {
            pullRequest: {
              reviewThreads: {
                pageInfo: { endCursor: null, hasNextPage: false },
                nodes: [
                  {
                    comments: {
                      nodes: [
                        {
                          author: { login: 'octocat' },
                          body: 'Say which turn edited it.',
                        },
                      ],
                      totalCount: 1,
                    },
                    isResolved: false,
                    line: 2,
                    originalLine: 2,
                    path: 'README.md',
                  },
                ],
              },
              reviews: { nodes: [] },
            },
          },
        },
      },
    ]),
  )
  return repository
}

// The daemon-backend CI job sets AIDE_E2E_PITWALL; e2e/pitwall-daemon.ts puts e2e/fake-gh first on the daemon's PATH.
test.describe('pull request flow on the pitwall daemon', () => {
  test.skip(!pitwall, 'needs AIDE_E2E_PITWALL, a pitwall binary')

  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('shows the pull request, sends its failures, fixes them in a new thread and merges', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-pr-flow-e2e-data-'))
    app = await electron.launch({
      args: [workspaceDirectory, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDirectory,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...process.env,
        AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
        AIDE_SOFTWARE_RENDERING: '1',
        AIDE_TEST_PROJECT_PICK_PATH: repository,
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        SWAYSOCK: '',
        // why: the daemon gates aide's chats as aide does (ENG-2934), and its fake Jev takes any key.
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

    const firstPane = page.getByTestId('managed-agent-pane').first()
    await firstPane
      .getByRole('textbox', { name: /claude prompt/i })
      .fill('edit readme')
    await firstPane.getByRole('button', { name: /send prompt/i }).click()
    const content = firstPane.getByTestId('managed-session-content')
    await expect(content).toContainText('Handled: edit readme')

    // pitwall polls a new branch's pull request at once, then every 10 s.
    const row = firstPane.getByTestId('managed-pull-request')
    await expect(row).toContainText('#241', { timeout: 30_000 })
    await expect(row).toContainText('1 passing · 1 failing · 0 pending')
    await expect(row).toContainText('Changes requested')
    await expect(row).toContainText('Failing: linux')
    await expect(row).toContainText('1 unresolved thread')
    await row.screenshot({ path: 'test-results/pull-request-row.png' })

    await row.getByRole('button', { name: 'Send to agent' }).first().click()
    await expect(content).toContainText(
      'Handled: These checks failed on pull request #241:',
    )
    await expect(content).toContainText('Fix these and push.')

    await row
      .getByRole('button', { name: 'Fix in a new thread' })
      .last()
      .click()
    const newPane = page.getByTestId('managed-agent-pane').last()
    await expect(page.getByTestId('managed-agent-pane')).toHaveCount(2)
    await expect(newPane.getByTestId('managed-session-content')).toContainText(
      'Handled: Reviewers asked for changes on pull request #241.',
    )
    // The new thread's tab sits in the same folder on the same branch, so pitwall reports the same pull request for it.
    await expect(newPane.getByTestId('managed-pull-request')).toContainText(
      '#241',
      { timeout: 30_000 },
    )

    await newPane
      .getByTestId('managed-pull-request')
      .getByRole('button', { name: 'Merge' })
      .click()
    const dialog = page.getByRole('dialog', { name: 'Merge #241?' })
    await expect(dialog).toContainText('1 failing and 0 pending check.')
    await dialog.getByRole('button', { name: 'Merge' }).click()
    const merged = path.join(repository, '.git', 'aide-e2e-gh', 'merged')
    await expect.poll(() => existsSync(merged)).toBe(true)
    expect(readFileSync(merged, 'utf8')).toBe('241 --squash\n')
  })
})
