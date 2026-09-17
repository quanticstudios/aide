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

const workspaceDir = path.resolve(import.meta.dirname, '..')
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

function createGitRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-shared-chat-'))

  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), '# aide\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial commit'])
  runGit(repository, [
    'remote',
    'add',
    'origin',
    'https://github.com/example/aide.git',
  ])
  runGit(repository, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  runGit(repository, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])

  return repository
}

async function launchAideApp(repository: string): Promise<{
  app: ElectronApplication
  dataDirectory: string
  page: Page
}> {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-shared-chat-'))
  const app = await electron.launch({
    args: [workspaceDir, '--force-device-scale-factor=1'],
    executablePath: path.join(
      workspaceDir,
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

  return { app, dataDirectory, page }
}

async function prepareSyntheticJev(
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.typesafe.ai/v1/systemone') {
        return await nativeFetch(url, options)
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
          usage: { input_tokens: 100, output_tokens: 10 },
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    }
  })
  await page.evaluate(async () => {
    const storage = await window.aide.getStorageSnapshot()
    await Promise.all(
      storage.workspaces.map(async (workspace) => {
        await window.aide.updateJevSettings(workspace.id, {
          allowProcessing: true,
        })
      }),
    )
  })
}

async function getOnlySnapshot(page: Page) {
  return await page.evaluate(async () => {
    const snapshots = Object.values(
      await window.aide.getManagedSessionSnapshots(),
    )

    if (snapshots.length !== 1) {
      throw new Error(`Expected one managed session, got ${snapshots.length}.`)
    }

    return snapshots[0]
  })
}

async function startSharedChat(page: Page, app: ElectronApplication) {
  await expect(page.getByText('No project selected')).toBeVisible()
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent\b/i }).click()
  await prepareSyntheticJev(app, page)
  const prompt = page.getByRole('textbox', { name: /claude prompt/i })
  await prompt.fill('initialize shared chat')
  await page.getByRole('button', { name: /send prompt/i }).click()
  await expect(page.getByTestId('managed-session-content')).toContainText(
    'Handled: initialize shared chat',
  )
  await expect
    .poll(() => getOnlySnapshot(page))
    .toMatchObject({
      sessionState: 'ready',
    })

  return await page.evaluate(async () => {
    const snapshots = Object.values(
      await window.aide.getManagedSessionSnapshots(),
    )
    const session = snapshots[0]

    if (!session) {
      throw new Error('Managed session did not start.')
    }

    return await window.aide.configureManagedSessionAgents(session.sessionId, [
      {
        alias: 'Claude',
        selection: {
          effort: 'medium',
          mode: 'claude',
          model: 'claude-sonnet-5',
        },
      },
      {
        alias: 'Codex',
        selection: {
          effort: 'medium',
          mode: 'codex',
          model: 'gpt-5.6-terra',
          serviceTier: 'priority',
        },
      },
    ])
  })
}

async function selectPlanMode(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Build', exact: true }).click()
  await expect
    .poll(() => getOnlySnapshot(page))
    .toMatchObject({
      interactionMode: 'plan',
    })
}

test.describe('shared model chat', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
    app = null
    dataDirectory = null
    repository = null
  })

  test('searches, archives and reopens saved tasks with durable attention state', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const session = await startSharedChat(launched.page, app)
    const { page } = launched
    await page.getByRole('button', { name: 'Open task history' }).click()
    const task = page.getByTestId('saved-task')
    await expect(task).toContainText('initialize shared chat')
    await task.getByRole('button', { name: 'Rename', exact: true }).click()
    await page.getByRole('textbox', { name: 'Task title' }).fill('Daily review')
    await page.getByRole('button', { name: 'Save title' }).click()
    await task.getByRole('button', { name: 'Pin', exact: true }).click()
    await task.getByRole('button', { name: 'Mark read' }).click()
    await task.getByRole('button', { name: 'Archive', exact: true }).click()
    await expect(task).toHaveCount(0)
    await page.getByRole('checkbox', { name: 'Archived', exact: true }).check()
    await expect(task).toContainText('Pinned · Daily review')
    await task.getByRole('button', { name: 'Restore', exact: true }).click()
    await page
      .getByRole('checkbox', { name: 'Archived', exact: true })
      .uncheck()
    await page.getByRole('button', { name: 'Close', exact: true }).click()
    await page.reload()
    await page.getByRole('button', { name: 'Open task history' }).click()
    await expect(task).toContainText('Pinned · Daily review')
    await expect(task).not.toContainText('Unread')
    const snapshot = await page.evaluate(() =>
      window.aide.getTaskLibrary('Handled: initialize'),
    )
    expect(snapshot.tasks.map((entry) => entry.sessionId)).toEqual([
      session.sessionId,
    ])
    await task
      .getByRole('button', { name: 'Pinned · Daily review', exact: true })
      .click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'initialize shared chat',
    )
    await page.getByRole('button', { name: /Open activity inbox/ }).click()
    await expect(page.getByText('No tasks need attention.')).toBeVisible()
    await page
      .getByRole('checkbox', { name: 'Notify when Aide is in the background' })
      .uncheck()
    expect(
      await page.evaluate(
        async () => (await window.aide.getTaskLibrary()).notificationsEnabled,
      ),
    ).toBe(false)
  })

  test('keeps the orchestrator while configured plan opinions retain model attribution', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const configured = await startSharedChat(launched.page, app)
    const { page } = launched

    expect(configured.agents).toEqual([
      expect.objectContaining({ alias: 'claude' }),
      expect.objectContaining({ alias: 'codex' }),
    ])
    const orchestrator = {
      model: configured.model,
      selection: configured.orchestratorSelection,
    }

    await selectPlanMode(page)
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@Claude @Codex compare the implementation')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: compare the implementation',
    )
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Claude · claude-sonnet-5',
    )
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Codex · gpt-5.6-terra',
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        agents: configured.agents,
        model: orchestrator.model,
        orchestratorSelection: orchestrator.selection,
      })

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Claude · claude-sonnet-5',
    )
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Codex · gpt-5.6-terra',
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        agents: configured.agents,
        interactionMode: 'plan',
        model: orchestrator.model,
        orchestratorSelection: orchestrator.selection,
      })
  })

  test('preserves a completed opinion when a peer fails, then interrupts only the pending peer', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    await selectPlanMode(page)

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@Claude @Codex fail-claude')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: fail-claude',
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        turns: expect.arrayContaining([
          expect.objectContaining({
            recipientAlias: 'claude',
            state: 'failed',
          }),
          expect.objectContaining({
            recipientAlias: 'codex',
            state: 'completed',
          }),
        ]),
      })
    const retryTurn = page.getByRole('button', { name: 'Retry turn' })
    await expect(retryTurn).toBeVisible()
    await retryTurn.locator('xpath=../..').hover()
    await retryTurn.click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        turns: expect.arrayContaining([
          expect.objectContaining({
            recipientAlias: 'codex',
            state: 'completed',
          }),
          expect.objectContaining({
            recipientAlias: 'claude',
            state: 'failed',
          }),
        ]),
      })

    await prompt.fill('@Claude @Codex wait-claude')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(
      page.getByRole('button', { name: 'Interrupt @claude' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Interrupt @claude' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        turns: expect.arrayContaining([
          expect.objectContaining({
            recipientAlias: 'claude',
            state: 'cancelled',
          }),
          expect.objectContaining({
            recipientAlias: 'codex',
            state: 'completed',
          }),
        ]),
      })
  })
})
