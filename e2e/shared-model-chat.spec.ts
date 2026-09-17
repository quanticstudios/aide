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

async function launchAideApp(
  repository: string,
  dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-shared-chat-')),
): Promise<{
  app: ElectronApplication
  dataDirectory: string
  page: Page
}> {
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
  await prompt.press('Enter')
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

  test('opens fleet Plan first, accepts reported work, and shows actual routing after restart', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    const session = await startSharedChat(page, app)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.evaluate(async (sessionId) => {
      await window.aide.sendManagedSessionInput(sessionId, 'fleet plan')
    }, session.sessionId)
    await page
      .getByRole('button', { name: 'Open agent fleet', exact: true })
      .click()
    const drawer = page.getByTestId('fleet-drawer')
    await expect(
      drawer.getByRole('tab', { name: 'Plan', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await expect(drawer.getByTestId('fleet-plan-flow')).toContainText(
      'Persist plan',
    )
    await drawer.getByRole('button', { name: /Render drawer/ }).click()
    await expect(drawer).toContainText('Show saved nodes and routing events.')
    await expect(
      drawer.getByRole('button', {
        name: 'Accept completed work',
        exact: true,
      }),
    ).toBeDisabled()
    await drawer.getByRole('button', { name: /Persist plan/ }).click()
    await drawer
      .getByRole('button', { name: 'Accept completed work', exact: true })
      .click()
    await expect(drawer).toContainText('1 / 2 accepted')
    await page.screenshot({
      path: 'docs/verification/fleet-plan-2026-09-18.png',
    })
    await drawer.getByRole('tab', { name: 'Live flow', exact: true }).click()
    await expect(drawer).toContainText('Jev')
    const flow = drawer.getByTestId('fleet-live-flow')
    await expect(flow).toBeVisible()
    await expect(flow.locator('[data-state="running"]')).toHaveCount(0)
    await app.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        releaseFleetPreparation?: () => void
      }
      const fetch = runtime.fetch
      let isFirstRequest = true
      runtime.fetch = async (url, options) => {
        if (url === 'https://api.typesafe.ai/v1/systemone' && isFirstRequest) {
          isFirstRequest = false
          await new Promise<void>((resolve) => {
            runtime.releaseFleetPreparation = resolve
            options?.signal?.addEventListener('abort', () => resolve(), {
              once: true,
            })
          })
        }
        return fetch(url, options)
      }
    })
    await page.evaluate((sessionId) => {
      void window.aide.sendManagedSessionInput(sessionId, 'fleet consult')
    }, session.sessionId)
    await expect(
      flow.getByRole('button', {
        name: 'Required Jev context, running',
        exact: true,
      }),
    ).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect
      .poll(() =>
        flow
          .locator('path[data-state="running"]')
          .first()
          .evaluate((element) => getComputedStyle(element).animationName),
      )
      .toBe('none')
    await app.evaluate(() => {
      const runtime = globalThis as typeof globalThis & {
        releaseFleetPreparation?: () => void
      }
      runtime.releaseFleetPreparation?.()
      delete runtime.releaseFleetPreparation
    })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(
      flow.getByRole('button', { name: 'Agent claude, running', exact: true }),
    ).toBeVisible()
    await flow.getByRole('button', { name: /^Routing decision,/ }).click()
    await expect(flow).toContainText(
      'Check the drawer accessibility before implementation.',
    )
    await expect(drawer).toContainText('remainder unknown')
    await page.screenshot({
      path: 'docs/verification/fleet-live-2026-09-18.png',
    })
    await page.getByRole('button', { name: 'Interrupt @claude' }).click()
    await expect(flow.locator('[data-state="running"]')).toHaveCount(0)
    await expect(
      flow.getByTestId('fleet-live-edge-return-agent-claude'),
    ).toHaveAttribute('data-state', 'cancelled')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(flow).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Open agent fleet', exact: true }),
    ).toBeFocused()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page
      .getByRole('dialog', { name: 'Add pane' })
      .getByRole('button', { name: /^agent\b/i })
      .click()
    await page
      .getByRole('button', { name: 'Open agent fleet', exact: true })
      .click()
    await expect
      .poll(() =>
        page.evaluate(
          async ({ workspaceId, paneId }) => {
            const storage = await window.aide.getStorageSnapshot()
            const activePaneId =
              storage.lastActivePaneIdsByWorkspace[workspaceId]
            return Boolean(
              activePaneId &&
                activePaneId !== paneId &&
                activePaneId.startsWith('agent::copy-'),
            )
          },
          { workspaceId: session.workspaceId, paneId: session.paneId },
        ),
      )
      .toBe(true)
    await page
      .getByTestId('fleet-drawer')
      .getByRole('tab', { name: 'Plan', exact: true })
      .click()
    await expect(page.getByTestId('fleet-drawer')).toContainText(
      'No fleet plan has been recorded',
    )
    await page
      .getByRole('toolbar', { name: 'Pane selector' })
      .getByRole('button')
      .first()
      .click()
    await expect(page.getByTestId('fleet-drawer')).toContainText(
      '1 / 2 accepted',
    )
    await app.close()
    app = null
    const reopened = await launchAideApp(repository, dataDirectory)
    app = reopened.app
    await reopened.page
      .getByRole('button', { name: 'Open agent fleet', exact: true })
      .click()
    await expect(reopened.page.getByTestId('fleet-drawer')).toContainText(
      '1 / 2 accepted',
    )
    await reopened.page.setViewportSize({ width: 760, height: 620 })
    await expect(
      reopened.page
        .getByTestId('fleet-drawer')
        .getByRole('button', { name: 'Close agent fleet', exact: true }),
    ).toBeVisible()
    await reopened.page
      .getByTestId('fleet-drawer')
      .getByRole('tab', { name: 'Live flow', exact: true })
      .click()
    await expect(
      reopened.page
        .getByTestId('fleet-live-flow')
        .locator('[data-state="running"]'),
    ).toHaveCount(0)
    await expect(
      reopened.page
        .getByTestId('fleet-live-flow')
        .getByRole('button', { name: /^Agent claude,/ }),
    ).toBeVisible()
    await expect(
      reopened.page
        .getByTestId('fleet-live-flow')
        .getByRole('button', { name: /^Agent codex,/ }),
    ).toBeVisible()
    expect(
      await reopened.page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(760)
    await reopened.page.screenshot({
      path: 'docs/verification/fleet-narrow-2026-09-18.png',
    })
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
    await expect(
      page.getByText('Loading Agent…', { exact: true }),
    ).not.toBeVisible()
    await page.screenshot({ path: test.info().outputPath('task-history.png') })
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

  test('queues follow-ups, cancels one, and resumes after interruption', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('wait-claude')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'running' })
    for (const text of ['cancel this follow-up', 'keep this follow-up']) {
      await prompt.fill(text)
      await page.getByRole('button', { name: 'Send prompt' }).click()
    }
    const queue = page.getByTestId('managed-input-queue')
    await expect(queue).toContainText('2 queued')
    await page.screenshot({
      path: test.info().outputPath('queued-follow-ups.png'),
    })
    await queue
      .getByRole('button', { name: 'Cancel queued message' })
      .first()
      .click()
    await expect(queue).not.toContainText('cancel this follow-up')
    await page.getByRole('button', { name: 'Interrupt', exact: true }).click()
    await queue.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: keep this follow-up',
    )
    await expect(queue).not.toBeVisible()
  })

  test('keeps queued follow-ups paused across a full app restart', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const prompt = launched.page.getByRole('textbox', {
      name: /claude prompt/i,
    })
    await prompt.fill('wait-claude')
    await launched.page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getOnlySnapshot(launched.page))
      .toMatchObject({ sessionState: 'running' })
    await prompt.fill('resume after restart')
    await launched.page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(
      launched.page.getByTestId('managed-input-queue'),
    ).toContainText('resume after restart')
    await app.close()
    app = null
    const restarted = await launchAideApp(repository, dataDirectory)
    app = restarted.app
    await prepareSyntheticJev(app, restarted.page)
    const queue = restarted.page.getByTestId('managed-input-queue')
    await expect(queue).toContainText('resume after restart')
    await expect(
      restarted.page.getByTestId('managed-session-content'),
    ).not.toContainText('Handled: resume after restart')
    await queue.getByRole('button', { name: 'Resume', exact: true }).click()
    await expect(
      restarted.page.getByTestId('managed-session-content'),
    ).toContainText('Handled: resume after restart')
    await expect(queue).not.toBeVisible()
  })

  test('steers an active Codex turn through required Jev preparation', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const session = await startSharedChat(launched.page, app)
    const { page } = launched
    await page.evaluate(async (sessionId) => {
      await window.aide.switchManagedSessionProvider(sessionId, {
        mode: 'codex',
        model: 'gpt-5.6-terra',
        effort: 'medium',
      })
    }, session.sessionId)
    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('wait-codex')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'running' })
    await prompt.fill('change direction now')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await page
      .getByTestId('managed-input-queue')
      .getByRole('button', { name: 'Send now' })
      .click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Steered: change direction now',
    )
    await expect(page.getByTestId('managed-input-queue')).not.toBeVisible()
  })

  test('attaches a selected workspace file to a required-Jev turn', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    await app.evaluate(
      ({ dialog }, filePath) => {
        Object.defineProperty(dialog, 'showOpenDialog', {
          value: async () => ({ canceled: false, filePaths: [filePath] }),
        })
      },
      path.join(repository, 'README.md'),
    )
    await page.getByRole('button', { name: 'Attach workspace files' }).click()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )
    await page
      .getByRole('textbox', { name: /claude prompt/i })
      .fill('Read the attached workspace file')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: Read the attached workspace file',
    )
    await expect(page.getByTestId('composer-attachments')).not.toBeVisible()
  })

  test('preserves a ten-megabyte image draft across renderer reload', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const session = await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('Keep these screenshots for later')
    await prompt.evaluate((element) => {
      const clipboardData = new DataTransfer()
      for (const name of ['large-one.png', 'large-two.png']) {
        const bytes = new Uint8Array(5 * 1024 * 1024)
        bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
        clipboardData.items.add(new File([bytes], name, { type: 'image/png' }))
      }
      element.dispatchEvent(
        new ClipboardEvent('paste', { bubbles: true, clipboardData }),
      )
    })
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'large-two.png',
    )
    await expect
      .poll(() =>
        page.evaluate(async (sessionId) => {
          const request = indexedDB.open('aide-renderer', 1)
          const database = await new Promise<IDBDatabase>((resolve, reject) => {
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error)
          })
          try {
            const read = database
              .transaction('managed-drafts')
              .objectStore('managed-drafts')
              .get(`aide:managed-composer:${sessionId}`)
            return await new Promise<number>((resolve, reject) => {
              read.onsuccess = () =>
                resolve(read.result?.attachments?.length ?? 0)
              read.onerror = () => reject(read.error)
            })
          } finally {
            database.close()
          }
        }, session.sessionId),
      )
      .toBe(2)
    await page.reload()
    await expect(prompt).toHaveValue('Keep these screenshots for later')
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'large-one.png',
    )
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'large-two.png',
    )
    await page
      .getByRole('button', { name: 'Remove large-one.png', exact: true })
      .click()
    await expect(page.getByTestId('composer-attachments')).not.toContainText(
      'large-one.png',
    )
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
