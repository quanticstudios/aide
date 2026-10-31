import { execFileSync } from 'node:child_process'
import {
  existsSync,
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
  allowProcessing = true,
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
  await page.evaluate(async (allowProcessing) => {
    const storage = await window.aide.getStorageSnapshot()
    await Promise.all(
      storage.workspaces.map(async (workspace) => {
        await window.aide.updateJevSettings(workspace.id, {
          allowProcessing,
        })
      }),
    )
  }, allowProcessing)
}

/** Waits until the session transport answers again after a reload; the daemon transport refuses reads while it reconnects. */
async function waitForSessions(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.aideSessions.getSessions().then(
          () => true,
          () => false,
        ),
      ),
    )
    .toBe(true)
}

async function getOnlySnapshot(page: Page) {
  return await page.evaluate(async () => {
    const snapshots = Object.entries(await window.aideSessions.getSessions())

    if (snapshots.length !== 1) {
      throw new Error(`Expected one managed session, got ${snapshots.length}.`)
    }

    // why: the daemon backend keys a chat by aide's pane session id, while its snapshot carries pitwall's chat id; panes, drafts and tasks use aide's.
    const [[sessionId, snapshot]] = snapshots
    return { ...snapshot, sessionId }
  })
}

/**
 * Opens the project and starts one Claude or Codex chat, the way a user does.
 * @remarks Use it unless the spec tests multi-agent routing; startSharedChat's setAgents stays built-in only (ENG-2706).
 */
async function startPlainChat(
  page: Page,
  app: ElectronApplication,
  provider: 'claude' | 'codex' = 'claude',
  text = 'initialize shared chat',
  reply = `Handled: ${text}`,
) {
  await expect(page.getByText('No project selected')).toBeVisible()
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent\b/i }).click()
  await prepareSyntheticJev(app, page)
  if (provider === 'codex') {
    await page
      .getByRole('button', { name: 'Claude Sonnet 5', exact: true })
      .click()
    const picker = page.locator('[data-model-selector-menu]')
    await picker.getByRole('button', { name: 'Codex', exact: true }).click()
    await picker
      .getByRole('button')
      .filter({ hasText: 'GPT-5.6 Terra' })
      .click()
  }
  const prompt = page.getByRole('textbox', {
    name: new RegExp(`${provider} prompt`, 'i'),
  })
  await prompt.fill(text)
  await prompt.press('Enter')
  await expect(page.getByTestId('managed-session-content')).toContainText(reply)
  await expect
    .poll(() => getOnlySnapshot(page))
    .toMatchObject({
      provider,
      sessionState: 'ready',
    })

  return await getOnlySnapshot(page)
}

async function startSharedChat(page: Page, app: ElectronApplication) {
  const session = await startPlainChat(page, app)

  return await page.evaluate(async (sessionId) => {
    return await window.aideSessions.setAgents(sessionId, [
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
  }, session.sessionId)
}

async function selectPlanMode(page: Page): Promise<void> {
  const prompt = page.getByRole('textbox', { name: /prompt/i })
  await prompt.fill('/plan')
  await page.getByRole('option', { name: /\/plan/ }).click()
  await expect
    .poll(() => getOnlySnapshot(page))
    .toMatchObject({
      interactionMode: 'plan',
    })
}

async function selectProviderSkill(
  page: Page,
  skillName: string,
): Promise<void> {
  const prompt = page.getByRole('textbox', { name: /prompt/i })
  await prompt.fill(`/${skillName}`)
  const skill = page.getByRole('option', {
    name: new RegExp(`/${skillName}.*Runs with`, 'i'),
  })
  await expect(skill).toBeVisible()
  await skill.click()
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

  test('focuses the composer when entering and returning to an agent pane', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched

    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await expect(prompt).toBeFocused()

    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^git\b/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await page.getByRole('button', { name: 'Agent', exact: true }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText('Agent')
    await expect(prompt).toBeFocused()
  })

  test('distinguishes Codex activity from the final response', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    if (process.env.AIDE_E2E_PITWALL) {
      // why: the daemon transport never reads aide's IPC below; pitwall's fake script streams both phases.
      await startPlainChat(
        page,
        app,
        'codex',
        'codex commentary',
        'The capital of Japan is Tokyo.',
      )
    } else {
      await startPlainChat(page, app)
      const snapshot = await getOnlySnapshot(page)
      const response = snapshot.content.find(
        (item) => item.kind === 'assistant-text',
      )
      if (!response) throw new Error('Missing assistant response')
      snapshot.revision += 100
      snapshot.content = [
        ...snapshot.content.filter((item) => item.kind !== 'assistant-text'),
        {
          ...response,
          provider: 'codex',
          model: 'gpt-6-astra',
          phase: 'commentary',
          text: '`[aide · geography]` Checking the answer.',
        },
        {
          ...response,
          id: 'final-answer',
          provider: 'codex',
          model: 'gpt-6-astra',
          phase: 'final_answer',
          text: '`[aide · geography]` The capital of Japan is Tokyo.',
        },
      ]
      const synced = await page.evaluate(
        (sessionId) => window.aide.syncManagedSession(sessionId),
        snapshot.sessionId,
      )
      await app.evaluate(
        ({ BrowserWindow }, { seq, snapshot }) => {
          BrowserWindow.getAllWindows()[0].webContents.send(
            'managed-session:event',
            {
              deltas: [
                {
                  revision: snapshot.revision,
                  seq,
                  sessionId: snapshot.sessionId,
                  snapshot,
                  type: 'snapshot',
                  updatedAt: snapshot.updatedAt,
                  version: 1,
                },
              ],
              sessionId: snapshot.sessionId,
              type: 'deltas',
            },
          )
        },
        { seq: (synced?.seq ?? 0) + 1, snapshot },
      )
    }
    const messages = page.getByTestId('managed-content-assistant-text')
    await expect(messages).toHaveCount(2)
    const activity = page.getByTestId('assistant-activity')
    await expect(
      activity.getByText('Checking the answer.', { exact: true }),
    ).toBeHidden()
    await activity.locator('summary').click()
    await expect(
      activity.getByText('Checking the answer.', { exact: true }),
    ).toBeVisible()
    await activity.locator('summary').focus()
    await page.keyboard.press('Enter')
    await expect(
      activity.getByText('Checking the answer.', { exact: true }),
    ).toBeHidden()
    await expect(messages.last()).toContainText(
      'The capital of Japan is Tokyo.',
    )
    await expect(messages.locator('.message-session-label')).toHaveCount(2)
    const labelBounds = await messages
      .last()
      .locator('.message-session-label')
      .boundingBox()
    const answerBounds = await messages
      .last()
      .getByText('The capital of Japan is Tokyo.', { exact: true })
      .boundingBox()
    expect(answerBounds?.y).toBeGreaterThanOrEqual(
      (labelBounds?.y ?? 0) + (labelBounds?.height ?? 0),
    )
    await expect(messages.getByText('Codex', { exact: true })).toHaveCount(1)
    await messages.last().hover()
    await page
      .getByRole('button', { name: 'Copy response', exact: true })
      .click()
    await expect
      .poll(() => app?.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('`[aide · geography]` The capital of Japan is Tokyo.')
    const first = await messages.first().boundingBox()
    const last = await messages.last().boundingBox()
    expect(last?.y).toBeGreaterThan((first?.y ?? 0) + (first?.height ?? 0))
    await page.screenshot({
      path: test.info().outputPath('codex-message-formatting.png'),
    })
  })

  test('keeps copy actions below the response and copies only reply text', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    await startPlainChat(page, app)
    const reply = page.getByTestId('managed-content-assistant-text').last()
    const actions = page.getByTestId('response-actions').last()
    const userMessage = page.getByTestId('managed-content-user-prompt').last()
    await page.getByRole('banner').hover()
    await expect(actions).toHaveCSS('opacity', '0')
    await expect(userMessage.getByTestId('user-message-actions')).toHaveCSS(
      'opacity',
      '0',
    )
    await userMessage.hover()
    await expect(userMessage.getByTestId('user-message-actions')).toHaveCSS(
      'opacity',
      '1',
    )
    await expect(actions).toHaveCSS('opacity', '0')
    const userActions = userMessage.getByTestId('user-message-actions')
    const bubbleBounds = await userMessage
      .getByTestId('user-message-bubble')
      .boundingBox()
    const userActionBounds = await userActions.boundingBox()
    expect(userActionBounds?.y).toBeGreaterThanOrEqual(
      (bubbleBounds?.y ?? 0) + (bubbleBounds?.height ?? 0),
    )
    await userActions
      .getByRole('button', { name: 'Copy message', exact: true })
      .click()
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('initialize shared chat')
    await page.screenshot({
      path: test.info().outputPath('user-message-actions.png'),
    })
    await page.getByRole('textbox', { name: /claude prompt/i }).focus()
    await reply.hover()
    await expect(actions).toHaveCSS('opacity', '1')
    await expect(userMessage.getByTestId('user-message-actions')).toHaveCSS(
      'opacity',
      '0',
    )
    await expect(actions.locator('time')).not.toHaveText('')
    await expect(actions).toBeVisible()
    const replyBounds = await reply.boundingBox()
    const actionBounds = await actions.boundingBox()
    expect(actionBounds?.y).toBeGreaterThanOrEqual(
      (replyBounds?.y ?? 0) + (replyBounds?.height ?? 0),
    )
    const copyButton = actions.getByRole('button').first()
    await expect(copyButton).toHaveAttribute('aria-label', 'Copy response')
    await expect(copyButton).toHaveText('')
    await copyButton.hover()
    await expect(
      page.getByRole('tooltip', { name: 'Copy response' }),
    ).toBeVisible()
    await copyButton.click()
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe('Handled: initialize shared chat')
    await page.screenshot({
      path: test.info().outputPath('response-actions.png'),
    })
  })

  test('branches a response into an independent same-workspace conversation', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    const source = await startPlainChat(page, app)

    await page
      .getByTestId('response-actions')
      .last()
      .getByRole('button', { name: 'Branch conversation' })
      .click()

    await expect
      .poll(() =>
        page.evaluate(
          async (sourceSessionId) =>
            (await window.aideSessions.listSessions()).tasks.find(
              (task) => task.sessionId !== sourceSessionId,
            ) ?? null,
          source.sessionId,
        ),
      )
      .not.toBeNull()
    const branched = await page.evaluate(
      async (sourceSessionId) =>
        (await window.aideSessions.listSessions()).tasks.find(
          (task) => task.sessionId !== sourceSessionId,
        ) ?? null,
      source.sessionId,
    )
    if (!branched) throw new Error('Branched conversation was not saved.')

    const branchSnapshot = await page.evaluate(
      (sessionId) => window.aideSessions.getSavedSession(sessionId),
      branched.sessionId,
    )
    const sourceSnapshot = await page.evaluate(
      (sessionId) => window.aideSessions.getSavedSession(sessionId),
      source.sessionId,
    )
    const discussion = (snapshot: typeof sourceSnapshot) =>
      snapshot?.content.filter(
        (item) => item.kind === 'assistant-text' || item.kind === 'user-prompt',
      ) ?? []
    expect(discussion(branchSnapshot)).toEqual(discussion(sourceSnapshot))
    expect(branched.sessionId).not.toBe(source.sessionId)
    expect(branched.workspaceId).toBe(source.workspaceId)

    const branchPrompt = page
      .locator('[data-active-pane="true"]')
      .getByRole('textbox', { name: /claude prompt/i })
    await branchPrompt.fill('take a different path')
    await branchPrompt.press('Enter')
    await expect
      .poll(async () => {
        const snapshots = await page.evaluate(() =>
          window.aideSessions.getSessions(),
        )
        return snapshots[source.sessionId]?.content.some((item) =>
          item.text.includes('take a different path'),
        )
      })
      .toBe(false)
    await expect
      .poll(async () => {
        const snapshots = await page.evaluate(() =>
          window.aideSessions.getSessions(),
        )
        return branched.sessionId
          ? snapshots[branched.sessionId]?.content.some((item) =>
              item.text.includes('take a different path'),
            )
          : false
      })
      .toBe(true)
  })

  test('chats in an ordinary folder without Git and restores the project after restart', async () => {
    repository = mkdtempSync(path.join(tmpdir(), 'aide-folder-chat-'))
    writeFileSync(path.join(repository, 'README.md'), '# Ordinary folder\n')
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => window.aide.getStorageSnapshot())).projects
            .length,
      )
      .toBe(1)
    const imported = await page.evaluate(() => window.aide.getStorageSnapshot())
    expect(imported.projects[0]).toMatchObject({
      kind: 'folder',
      repoRoot: repository,
    })
    expect(imported.workspaces[0]?.worktreePath).toBe(repository)
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await page.setViewportSize({ width: 1100, height: 720 })
    await prepareSyntheticJev(app, page, false)
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Jev settings', exact: true }),
    ).toHaveCount(0)
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await expect(prompt).toBeInViewport({ ratio: 1 })
    await expect(
      page.getByRole('button', { name: 'Send prompt', exact: true }),
    ).toBeInViewport({ ratio: 1 })
    await prompt.fill('help with this ordinary folder')
    await prompt.press('Enter')
    await expect(
      page.getByText(
        'Allow TypeSafe processing for this workspace in Settings before sending a message.',
      ),
    ).toBeVisible()
    await expect(prompt).toHaveValue('help with this ordinary folder')
    const openSettings = page.getByRole('button', {
      name: 'Open Settings',
      exact: true,
    })
    await openSettings.click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(
      settings.getByRole('heading', { name: 'Jev', exact: true }),
    ).toBeVisible()
    await expect(
      settings.getByText(/Enable your operating system keyring/),
    ).toHaveCount(0)
    await page.screenshot({
      path: 'docs/verification/settings-jev-2026-09-19.png',
    })
    await settings
      .getByRole('switch', {
        name: 'Allow TypeSafe processing for this workspace',
      })
      .press('Space')
    await settings.getByRole('button', { name: 'Save Jev settings' }).click()
    await expect(settings.getByRole('status')).toHaveText('Ready')
    await page.keyboard.press('Escape')
    await expect(settings).toBeHidden()
    await expect(openSettings).toBeFocused()
    await expect(prompt).toHaveValue('help with this ordinary folder')
    await prompt.press('Enter')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: help with this ordinary folder',
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'ready' })
    await page.screenshot({
      path: 'docs/verification/chat-polish-2026-09-18.png',
    })
    const session = await getOnlySnapshot(page)
    expect(
      await page.evaluate(
        (id) => window.aide.listTurnCheckpoints(id),
        session.sessionId,
      ),
    ).toEqual([])
    expect(existsSync(path.join(repository, '.git'))).toBe(false)
    await app.close()
    const restarted = await launchAideApp(repository, dataDirectory)
    app = restarted.app
    await expect(
      restarted.page.getByTestId('managed-session-content'),
    ).toContainText('Handled: help with this ordinary folder')
    const restored = await restarted.page.evaluate(() =>
      window.aide.getStorageSnapshot(),
    )
    expect(restored.projects[0]?.id).toBe(imported.projects[0]?.id)
    expect(restored.workspaces[0]?.worktreePath).toBe(repository)
    expect(existsSync(path.join(repository, '.git'))).toBe(false)
  })

  test('reopens a closed Agent conversation while New chat and other workspaces stay fresh', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const restoredSession = await startPlainChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await app.evaluate(
      ({ dialog }, filePath) => {
        Object.defineProperty(dialog, 'showOpenDialog', {
          value: async () => ({ canceled: false, filePaths: [filePath] }),
        })
      },
      path.join(repository, 'README.md'),
    )
    await prompt.fill('Keep this draft after closing the pane')
    await page.getByRole('button', { name: 'Attach workspace files' }).click()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
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
            return await new Promise<{
              attachments: number
              text: string
            }>((resolve, reject) => {
              read.onsuccess = () =>
                resolve({
                  attachments: read.result?.attachments?.length ?? 0,
                  text: read.result?.text ?? '',
                })
              read.onerror = () => reject(read.error)
            })
          } finally {
            database.close()
          }
        }, restoredSession.sessionId),
      )
      .toEqual({
        attachments: 1,
        text: 'Keep this draft after closing the pane',
      })

    const agentTab = page
      .locator('.workspace-strip')
      .getByRole('button', { name: 'Agent', exact: true })
    await agentTab.hover()
    await page.getByRole('button', { name: 'Close Agent', exact: true }).click()
    await expect(prompt).toBeHidden()

    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: initialize shared chat',
    )
    await expect(prompt).toHaveValue('Keep this draft after closing the pane')
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )
    await expect
      .poll(() =>
        page.evaluate(
          async (sessionId) =>
            (await window.aideSessions.listSessions()).tasks.find(
              (task) => task.sessionId === sessionId,
            ),
          restoredSession.sessionId,
        ),
      )
      .toMatchObject({
        paneId: restoredSession.paneId,
        sessionId: restoredSession.sessionId,
      })

    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page.getByRole('button', { name: /^Add to / }).click()
    await page.getByRole('menuitem', { name: 'New chat' }).click()
    const activePane = page.locator('[data-active-pane="true"]')
    await expect(
      activePane.getByRole('textbox', { name: /claude prompt/i }),
    ).toHaveValue('')
    await expect(activePane.getByTestId('composer-attachments')).toBeHidden()
    await expect(
      activePane.getByTestId('managed-session-content'),
    ).not.toContainText('Handled: initialize shared chat')

    await page.getByRole('button', { name: /^Add to / }).click()
    await page.getByRole('menuitem', { name: 'New workspace' }).click()
    await page.getByLabel('Workspace name').fill('Isolated workspace')
    await page.getByLabel('Branch name').fill('codex/isolated-workspace')
    await page
      .getByRole('button', { name: /create workspace/i })
      .last()
      .click()
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Isolated workspace',
    )
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await expect(
      activePane.getByRole('textbox', { name: /claude prompt/i }),
    ).toHaveValue('')
    await expect(activePane.getByTestId('composer-attachments')).toBeHidden()
    await expect(
      activePane.getByTestId('managed-session-content'),
    ).not.toContainText('Handled: initialize shared chat')
  })

  test('waits for model discovery before selecting a skill or sending with Enter', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    const capabilities = await page.evaluate(() =>
      window.aide.getProviderCapabilities(),
    )
    await app.evaluate(({ ipcMain }, result) => {
      ipcMain.removeHandler('app:get-provider-capabilities')
      const pending = new Promise((resolve) => {
        Reflect.set(globalThis, 'releaseTestCapabilities', () =>
          resolve(result),
        )
      })
      ipcMain.handle('app:get-provider-capabilities', () => pending)
    }, capabilities)
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()
    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /^agent\b/i }).click()
    await prepareSyntheticJev(app, page)
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('preserve this draft')
    await prompt.press('Enter')
    await expect(prompt).toHaveValue('preserve this draft')
    expect(
      await page.evaluate(() => window.aideSessions.getSessions()),
    ).toEqual({})
    await prompt.fill('/claude-test-skill')
    const skill = page.getByRole('option', { name: /\/claude-test-skill/ })
    await expect(skill).toBeDisabled()
    await app.evaluate(() => {
      Reflect.get(globalThis, 'releaseTestCapabilities')()
      Reflect.deleteProperty(globalThis, 'releaseTestCapabilities')
    })
    await expect(skill).toBeEnabled()
    await skill.click()
    await expect(page.getByTestId('managed-provider-skill-chip')).toContainText(
      '@Claude · /claude-test-skill',
    )
  })

  test('selects the highlighted agent mention with the keyboard', async () => {
    repository = createGitRepository()
    writeFileSync(
      path.join(repository, 'fleet.ts'),
      'export const fleet = true\n',
    )
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@')
    await expect(
      page.getByRole('option', { name: /@claude/i }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({ path: test.info().outputPath('mention-menu.png') })
    await prompt.press('ArrowDown')
    await expect(page.getByRole('option', { name: /@codex/i })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await prompt.press('Enter')

    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeVisible()
    await expect(prompt).toHaveValue('')
    await expect(page.getByTestId('managed-recipient-menu')).toHaveCount(0)

    await page.screenshot({ path: test.info().outputPath('recipient-tag.png') })
    await prompt.press('Backspace')
    await expect(page.getByTestId('managed-recipient-chips')).toHaveCount(0)
    await prompt.fill('@')
    await prompt.press('Enter')
    await page.getByRole('button', { name: 'Remove @claude' }).click()
    await expect(page.getByTestId('managed-recipient-chips')).toHaveCount(0)
    await expect(prompt).toBeFocused()
    await prompt.fill('Please inspect @flee')
    await expect(
      page.getByRole('option', { name: /fleet\.ts/ }),
    ).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({
      path: test.info().outputPath('inline-file-search.png'),
    })
    await prompt.press('Enter')
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'fleet.ts',
    )
    await expect(prompt).toHaveValue('Please inspect ')

    await prompt.fill('@claude-test')
    const skill = page.getByRole('option', { name: /\/claude-test-skill/ })
    await expect(skill).toHaveAttribute('aria-selected', 'true')
    await page.screenshot({
      path: test.info().outputPath('inline-skill-search.png'),
    })
    await prompt.press('Tab')
    await expect(page.getByTestId('managed-provider-skill-chip')).toContainText(
      '@Claude · /claude-test-skill',
    )
    await prompt.fill('Please ask @cod')
    await prompt.press('Enter')
    await expect(prompt).toHaveValue('Please ask ')
    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeVisible()
    await expect(page.getByTestId('managed-provider-skill-chip')).toHaveCount(0)
  })

  test('keeps the composer responsive during a sustained Codex stream', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const session = await startPlainChat(launched.page, app, 'codex')
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('stream-codex')
    const startedAt = Date.now()
    await prompt.press('Enter')
    await expect(page.getByText('Codex is working...')).toBeVisible()

    await prompt.fill('draft typed during stream')
    await expect(prompt).toHaveValue('draft typed during stream')
    await page
      .getByRole('button', { name: 'Supervised', exact: true })
      .first()
      .click()
    await expect(
      page.getByRole('button', { name: /^Auto-accept edits\b/ }),
    ).toBeVisible()
    await page
      .locator('article[data-active-pane="true"]')
      .click({ position: { x: 1, y: 1 } })

    await expect
      .poll(() => getOnlySnapshot(page), { timeout: 5_000 })
      .toMatchObject({ sessionState: 'ready' })
    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000)
    await expect(prompt).toHaveValue('draft typed during stream')
    const streamedText = await page.evaluate(async (sessionId) => {
      const snapshot = (await window.aideSessions.getSessions())[sessionId]
      return snapshot?.content
        .filter(
          (item) => item.kind === 'assistant-text' && item.provider === 'codex',
        )
        .at(-1)?.text
    }, session.sessionId)
    expect(streamedText).toBe(
      `${Array.from({ length: 120 }, (_, index) => `${index.toString().padStart(3, '0')} `).join('')}complete`,
    )
  })

  test('reattaches to a Codex stream after a renderer reload with the same transcript', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app, 'codex')
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('stream-codex')
    await prompt.press('Enter')
    const streamed = page.getByTestId('managed-content-assistant-text').last()
    await expect(streamed).toContainText('005 ')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // why: the daemon transport refuses reads while it reconnects after the reload, so wait for the pane first.
    await expect(
      page.getByTestId('managed-content-assistant-text').last(),
    ).toContainText(
      `${Array.from({ length: 120 }, (_, index) => `${index.toString().padStart(3, '0')} `).join('')}complete`,
      { timeout: 10_000 },
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'ready' })
  })

  test('navigates the conversation minimap with scrolling, clicks and keyboard', async () => {
    test.setTimeout(150_000)
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    // invariant: the track only scrolls when the tick stack is taller than the rail, so the viewport cannot keep whatever size the desktop hands the window.
    const cdp = await app.context().newCDPSession(page)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 1,
      height: 920,
      mobile: false,
      width: 1440,
    })
    await expect
      .poll(() => page.evaluate(() => globalThis.innerHeight))
      .toBeLessThanOrEqual(920)
    const session = await startPlainChat(page, app)
    const rail = page.getByRole('navigation', { name: 'Conversation minimap' })
    await expect(rail).toBeHidden()
    for (let index = 0; index < 60; index++) {
      await page.evaluate(
        async ({ id, index }) => {
          await window.aideSessions.send(id, `Minimap message ${index}`)
        },
        { id: session.sessionId, index },
      )
    }
    const content = page.getByTestId('managed-session-content')
    await expect(content).toContainText('Handled: Minimap message 59', {
      timeout: 60_000,
    })
    await expect(rail).toBeVisible()
    const ticks = rail.getByRole('button')
    await expect(ticks).toHaveCount(61)
    await content.evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await expect(ticks.last()).toHaveAttribute('aria-current', 'location')
    const track = rail.locator('.conversation-minimap-track')
    await expect
      .poll(() =>
        track.evaluate(
          (element) => new DOMMatrix(getComputedStyle(element).transform).m42,
        ),
      )
      .toBeLessThan(0)
    await ticks.last().focus()
    await page.keyboard.press('Home')
    await expect(ticks.first()).toBeFocused()
    await expect(ticks.first()).toHaveAttribute('aria-current', 'location')
    await expect
      .poll(() => content.evaluate((element) => element.scrollTop))
      .toBe(0)
    await ticks.nth(4).click()
    await expect(ticks.nth(4)).toHaveAttribute('aria-current', 'location')
    await ticks.nth(4).hover()
    await expect(rail.getByRole('tooltip')).toContainText('Minimap message 3')
    const tickWidth = (index: number) =>
      ticks
        .nth(index)
        .locator('span')
        .evaluate((element) => element.getBoundingClientRect().width)
    await expect.poll(() => tickWidth(4)).toBeGreaterThan(24)
    expect(await tickWidth(3)).toBeGreaterThan(await tickWidth(2))
    await expect(ticks.nth(4).locator('span')).toHaveCSS('opacity', '1')
    const preview = await rail.getByRole('tooltip').boundingBox()
    const tick = await ticks.nth(4).boundingBox()
    if (!preview || !tick) throw new Error('Minimap preview or tick is hidden')
    expect(
      Math.abs(preview.y + preview.height / 2 - (tick.y + tick.height / 2)),
    ).toBeLessThanOrEqual(2)
    await page.screenshot({ path: '/tmp/aide-minimap-hover.png' })
    await page.mouse.move(400, 400)
    await expect(rail.getByRole('tooltip')).toBeHidden()
    await expect
      .poll(() =>
        ticks
          .first()
          .locator('span')
          .evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBe(6)
    await expect(ticks.nth(4).locator('span')).toHaveCSS('opacity', '1')
    await expect(ticks.nth(4).locator('span')).toHaveCSS('border-radius', '0px')
    await expect.poll(() => tickWidth(4)).toBe(6)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(track).not.toHaveCSS('transition-property', /transform/)
    await ticks.nth(2).click()
    await expect(ticks.nth(2)).toHaveAttribute('aria-current', 'location')
    await page.keyboard.press('End')
    await expect(ticks.last()).toBeFocused()
    await expect(ticks.last()).toHaveAttribute('aria-current', 'location')
    await page.screenshot({ path: '/tmp/aide-minimap.png' })
  })

  test('keeps model and effort controls available during a reply and applies the next choice after it finishes', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    const session = await startPlainChat(page, app)
    await page.evaluate(
      async (id) => window.aideSessions.send(id, 'approval'),
      session.sessionId,
    )
    // why: the pending approval is published after sendManagedSessionInput resolves, so a bare read can land on the snapshot before it.
    let waiting = await getOnlySnapshot(page)
    await expect
      .poll(
        async () => {
          waiting = await getOnlySnapshot(page)
          return waiting.pendingApprovals.length
        },
        { timeout: 15_000 },
      )
      .toBe(1)
    const capabilities = await page.evaluate(() =>
      window.aide.getProviderCapabilities(),
    )
    const original = capabilities.providers.claude.models.find(
      (model) => model.id === waiting.model,
    )
    const target = capabilities.providers.codex.models.find(
      (model) => model.id === 'gpt-5.6-terra',
    )
    if (!original || !target) throw new Error('Missing test models')
    await page
      .getByRole('button', { name: original.label, exact: true })
      .click()
    const picker = page.locator('[data-model-selector-menu]')
    await picker.getByRole('button', { name: 'Codex', exact: true }).click()
    await picker.getByRole('button').filter({ hasText: target.label }).click()
    await expect(page.getByText('Next message', { exact: true })).toBeVisible()
    await page
      .getByRole('button', { name: 'Reasoning settings', exact: true })
      .click()
    await page
      .getByRole('menu', { name: 'Reasoning settings' })
      .getByRole('menuitem', { name: /^High\b/ })
      .click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        provider: 'claude',
        model: waiting.model,
        pendingProviderSelection: {
          mode: 'codex',
          model: target.id,
          effort: 'high',
        },
      })
    await page.reload()
    await expect(
      page.getByRole('button', { name: target.label, exact: true }),
    ).toBeEnabled()
    await expect(page.getByText('Next message', { exact: true })).toBeVisible()
    await page.evaluate(
      async ({ sessionId, requestId }) =>
        window.aideSessions.resolveApproval(sessionId, requestId, 'accept'),
      {
        sessionId: session.sessionId,
        requestId: waiting.pendingApprovals[0].id,
      },
    )
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ provider: 'codex', model: target.id, effort: 'high' })
    await expect(page.getByText('Next message', { exact: true })).toBeHidden()
    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('next model reply')
    await prompt.press('Enter')
    await expect(
      page.getByTestId('managed-content-assistant-text').last(),
    ).toContainText('Handled: next model reply')
    expect((await getOnlySnapshot(page)).turns.at(-1)?.provider).toBe('codex')
  })

  test('shows provider reasoning options and applies keyboard selections', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    const session = await startPlainChat(page, app)
    const trigger = page.getByRole('button', {
      name: 'Reasoning settings',
      exact: true,
    })
    await trigger.click()
    const menu = page.getByRole('menu', { name: 'Reasoning settings' })
    await expect(menu).toBeVisible()
    await expect(menu).not.toContainText('Thinking Budget')
    await expect(menu).not.toContainText('Service Tier')
    await page
      .locator('[data-slot="dropdown-popover"]')
      .evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        )
      })
    await page.screenshot({
      path: test.info().outputPath('claude-reasoning.png'),
    })
    const low = menu.getByRole('menuitem', { name: /^Low\b/ })
    await low.focus()
    await page.keyboard.press('Enter')
    await expect(menu).toBeHidden()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ effort: 'low' })
    await page.evaluate(async (sessionId) => {
      await window.aideSessions.setModel(sessionId, {
        mode: 'codex',
        model: 'gpt-5.6-terra',
        effort: 'medium',
        serviceTier: 'priority',
      })
    }, session.sessionId)
    await trigger.click()
    await expect(menu).toContainText('Service Tier')
    await expect(menu).toContainText('Fast')
    await expect(menu).not.toContainText('Thinking Budget')
    await page
      .locator('[data-slot="dropdown-popover"]')
      .evaluate(async (element) => {
        await Promise.all(
          element
            .getAnimations({ subtree: true })
            .map((animation) => animation.finished),
        )
      })
    await page.screenshot({
      path: test.info().outputPath('codex-reasoning.png'),
    })
    await menu.getByRole('menuitem', { name: /^Provider default/ }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ serviceTier: null })
    await page.reload()
    await waitForSessions(page)
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ serviceTier: null })
    await trigger.click()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
  })

  test('clears accepted drafts and restores only an untouched failed submission', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })

    await app.evaluate(({ ipcMain }) => {
      const rejectors: Array<(reason: Error) => void> = []
      ipcMain.removeHandler('managed-session:send-input')
      ipcMain.handle(
        'managed-session:send-input',
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectors.push(reject)
          }),
      )
      Reflect.set(
        globalThis,
        'pendingManagedInputCount',
        () => rejectors.length,
      )
      Reflect.set(globalThis, 'rejectManagedInput', () => {
        const reject = rejectors.shift()
        if (!reject) throw new Error('No managed input is waiting.')
        reject(new Error('Synthetic rejected input.'))
      })
    })

    await prompt.fill('@cod')
    await page.getByRole('option', { name: /@codex/i }).click()
    await prompt.fill('first submitted draft')
    await prompt.press('Enter')
    await expect(prompt).toHaveValue('')
    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeHidden()
    await expect
      .poll(() =>
        app.evaluate(() =>
          Reflect.get(globalThis, 'pendingManagedInputCount')(),
        ),
      )
      .toBe(1)

    await prompt.fill('new draft survives the failed send')
    await app.evaluate(() => Reflect.get(globalThis, 'rejectManagedInput')())
    await expect(prompt).toHaveValue('new draft survives the failed send')
    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeHidden()

    await prompt.fill('@cod')
    await page.getByRole('option', { name: /@codex/i }).click()
    await prompt.fill('@README')
    await page.getByRole('option', { name: /README\.md/ }).click()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )
    await prompt.fill('restore this failed submission')
    await prompt.press('Enter')
    await expect(prompt).toHaveValue('')
    await expect(page.getByTestId('managed-recipient-chips')).toHaveCount(0)
    await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
    await expect
      .poll(() =>
        app.evaluate(() =>
          Reflect.get(globalThis, 'pendingManagedInputCount')(),
        ),
      )
      .toBe(1)

    await app.evaluate(() => Reflect.get(globalThis, 'rejectManagedInput')())
    await expect(prompt).toHaveValue('restore this failed submission')
    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeVisible()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )

    await prompt.press('Enter')
    await expect(prompt).toHaveValue('')
    await expect(page.getByTestId('managed-recipient-chips')).toHaveCount(0)
    await expect(page.getByTestId('composer-attachments')).toHaveCount(0)
    await expect
      .poll(() =>
        app.evaluate(() =>
          Reflect.get(globalThis, 'pendingManagedInputCount')(),
        ),
      )
      .toBe(1)

    await prompt.fill('@cla')
    await page.getByRole('option', { name: /@claude/i }).click()
    await prompt.fill('@README')
    await page.getByRole('option', { name: /README\.md/ }).click()
    await expect(
      page.getByRole('button', { name: 'Remove @claude' }),
    ).toBeVisible()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )

    await app.evaluate(() => Reflect.get(globalThis, 'rejectManagedInput')())
    await expect(prompt).toHaveValue('')
    await expect(
      page.getByRole('button', { name: 'Remove @claude' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Remove @codex' }),
    ).toBeHidden()
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )
  })

  test('ranks skill names first and removes stale suggestions while typing', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app)
    const { page } = launched
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('app:get-provider-skills')
      ipcMain.handle('app:get-provider-skills', () => ({
        errors: {},
        skills: [
          {
            id: 'bootstrap',
            name: 'vercel:bootstrap',
            description: 'Bootstrap with pro-design',
            owner: 'Claude',
            provider: 'claude',
          },
          {
            id: 'design',
            name: 'pro-design',
            description: 'Design a clear interface',
            owner: 'Claude',
            provider: 'claude',
          },
          {
            id: 'codex-design',
            name: 'pro-design',
            description: 'Design a clear interface',
            owner: 'Codex',
            provider: 'codex',
          },
          {
            id: 'release',
            name: 'release',
            description: 'Publish the app',
            owner: 'Claude',
            provider: 'claude',
          },
        ],
      }))
    })
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('/')
    const menu = page.getByTestId('managed-slash-menu')
    await expect(
      menu.getByRole('option', { name: /vercel:bootstrap/ }),
    ).toBeVisible()
    await prompt.fill('/pro-des')
    const options = menu.getByRole('option')
    await expect(options).toHaveCount(3)
    await expect(options.nth(0)).toContainText('/pro-design')
    await expect(options.nth(0)).toContainText('Claude')
    await expect(options.nth(1)).toContainText('Codex')
    await expect(options.nth(2)).toContainText('/vercel:bootstrap')
    await prompt.fill('/release')
    await expect(options).toHaveCount(1)
    await expect(options.first()).toContainText('/release')
    await prompt.fill('/nothing-matches')
    await expect(options).toHaveCount(0)
    await expect(menu).toContainText('No matching commands or skills.')
  })

  test('runs a Claude skill with its owner and clears opinion recipients', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })

    await prompt.fill('@cod')
    await page.getByRole('option', { name: /@codex/i }).click()
    await expect(
      page.getByRole('button', { name: /Remove @codex/i }),
    ).toBeVisible()

    await prompt.fill('/claude-test-skill')
    await expect(page.getByTestId('managed-slash-menu')).toBeVisible()
    await prompt.press('Escape')
    await expect(page.getByTestId('managed-slash-menu')).toBeHidden()
    await expect(prompt).toHaveValue('/claude-test-skill')
    await prompt.fill('')
    await selectProviderSkill(page, 'claude-test-skill')
    await expect(
      page.getByRole('button', { name: /Remove @codex/i }),
    ).toBeHidden()
    await expect(page.getByTestId('managed-provider-skill-chip')).toHaveText(
      '@Claude · /claude-test-skill ×',
    )
    await expect(
      page.getByText('Runs with Claude', { exact: true }),
    ).toBeVisible()
    await expect(page.getByTestId('managed-session-content')).not.toContainText(
      'Handled with claude skill',
    )

    await prompt.fill('review this change')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled with claude skill claude:skill:claude-test-skill: review this change',
    )
    await expect(page.getByTestId('managed-provider-skill-chip')).toBeHidden()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        provider: 'claude',
        sessionState: 'ready',
      })
  })

  test('switches to a Codex skill owner and restores its draft in a narrow pane', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const session = await startSharedChat(launched.page, app)
    const { page } = launched
    await page.setViewportSize({ width: 1100, height: 720 })

    await page.getByRole('button', { name: 'Split horizontally' }).click()
    await page.getByRole('button', { name: 'Terminal', exact: true }).click()

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@cla')
    await page.getByRole('option', { name: /@claude/i }).click()
    await prompt.fill('/')

    const pane = page.getByTestId('managed-agent-pane')
    const menu = page.getByTestId('managed-slash-menu')
    const send = pane.getByRole('button', { name: 'Send prompt' })
    await expect(menu).toBeVisible()
    await expect(send).toBeInViewport({ ratio: 1 })
    const paneBounds = await pane.boundingBox()
    const menuBounds = await menu.boundingBox()
    expect(paneBounds).not.toBeNull()
    expect(menuBounds).not.toBeNull()
    expect(menuBounds?.x).toBeGreaterThanOrEqual(paneBounds?.x ?? 0)
    expect((menuBounds?.x ?? 0) + (menuBounds?.width ?? 0)).toBeLessThanOrEqual(
      (paneBounds?.x ?? 0) + (paneBounds?.width ?? 0) + 1,
    )
    await page.screenshot({
      path: 'docs/verification/provider-skills-2026-09-18.png',
    })

    await prompt.fill('/codex-test-skill')
    await page
      .getByRole('option', {
        name: /\/codex-test-skill.*Runs with Codex/i,
      })
      .click()
    await expect(
      page.getByRole('button', { name: /Remove @claude/i }),
    ).toBeHidden()
    await expect(page.getByTestId('managed-provider-skill-chip')).toHaveText(
      '@Codex · /codex-test-skill ×',
    )
    const codexPrompt = page.getByRole('textbox', { name: /codex prompt/i })
    await codexPrompt.fill('prepare the release')
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
            return await new Promise<string | null>((resolve, reject) => {
              read.onsuccess = () =>
                resolve(read.result?.selectedSkill?.id ?? null)
              read.onerror = () => reject(read.error)
            })
          } finally {
            database.close()
          }
        }, session.sessionId),
      )
      .toBe('codex:skill:eafb4a4ea8096486')

    await page.reload()
    await expect(
      page.getByRole('textbox', { name: /codex prompt/i }),
    ).toHaveValue('prepare the release')
    await expect(page.getByTestId('managed-provider-skill-chip')).toHaveText(
      '@Codex · /codex-test-skill ×',
    )
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled with codex skill codex:skill:eafb4a4ea8096486: prepare the release',
    )
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Codex · gpt-5.6-terra',
    )
    await expect(page.getByTestId('managed-provider-skill-chip')).toBeHidden()
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
      await window.aideSessions.send(sessionId, 'fleet plan')
    }, session.sessionId)
    const drawer = page.getByTestId('fleet-drawer')
    const workspaceContent = page.getByTestId('workspace-content')
    const fullContentWidth = await workspaceContent.evaluate(
      (element) => element.getBoundingClientRect().width,
    )
    const closedPosition = await drawer.evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      parentRight: element.parentElement?.getBoundingClientRect().right ?? 0,
    }))
    expect(closedPosition.left).toBeGreaterThanOrEqual(
      closedPosition.parentRight,
    )
    await page.getByRole('button', { name: 'Open agent fleet' }).click()
    await expect
      .poll(() =>
        drawer.evaluate((element) => element.parentElement?.scrollLeft),
      )
      .toBe(0)
    await expect
      .poll(() =>
        drawer.evaluate((element) =>
          Math.round(new DOMMatrix(getComputedStyle(element).transform).m41),
        ),
      )
      .toBe(0)
    await expect
      .poll(() =>
        workspaceContent.evaluate(
          (element) => element.getBoundingClientRect().width,
        ),
      )
      .toBeLessThan(fullContentWidth - 300)
    const contentRight = await workspaceContent.evaluate(
      (element) => element.getBoundingClientRect().right,
    )
    expect(
      await drawer.evaluate((element) => element.getBoundingClientRect().left),
    ).toBeGreaterThanOrEqual(contentRight - 1)
    await expect(
      drawer.getByRole('tab', { name: 'Plan', exact: true }),
    ).toHaveAttribute('aria-selected', 'true')
    await drawer.getByRole('button', { name: 'Close agent fleet' }).click()
    await expect(drawer).toBeHidden()
    await page.getByRole('button', { name: 'Open agent fleet' }).click()
    await expect(drawer).toBeVisible()
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
      void window.aideSessions.send(sessionId, 'fleet consult')
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
    await drawer
      .getByRole('button', { name: 'Close agent fleet', exact: true })
      .click()
    await page.getByRole('button', { name: 'Interrupt @claude' }).click()
    await page
      .getByRole('button', { name: 'Open agent fleet', exact: true })
      .click()
    await expect(flow.locator('[data-state="running"]')).toHaveCount(0)
    await expect(
      flow.getByTestId('fleet-live-edge-return-agent-claude'),
    ).toHaveAttribute('data-state', 'cancelled')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(flow).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden()
    await expect
      .poll(() =>
        workspaceContent.evaluate(
          (element) => element.getBoundingClientRect().width,
        ),
      )
      .toBe(fullContentWidth)
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
    const session = await startPlainChat(launched.page, app)
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
      window.aideSessions.listSessions('Handled: initialize'),
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
        async () =>
          (await window.aideSessions.listSessions()).notificationsEnabled,
      ),
    ).toBe(false)
  })

  test('opens settings with searchable shortcuts and persists preferences without losing the draft', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app)
    const { page } = launched
    await page.setViewportSize({ width: 1100, height: 720 })
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('Keep this draft while I check settings')
    await page.getByRole('button', { name: 'Open sidebar' }).click()
    const trigger = page.getByRole('button', {
      name: 'Open settings',
      exact: true,
    })
    await trigger.click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await expect(settings).toBeVisible()
    const search = settings.getByRole('searchbox', {
      name: 'Search settings',
    })
    await expect(search).toBeFocused()
    await page.screenshot({
      path: test.info().outputPath('settings-search-focused.png'),
    })
    await search.fill('visible model')
    await expect(settings).toContainText('Choose a visible model')
    await expect(settings).not.toContainText('Open command palette')
    await search.fill('Ctrl+B')
    await expect(settings).toContainText('Toggle left sidebar')
    await expect(settings).not.toContainText('Choose a visible model')
    await search.fill('')
    const notifications = settings.getByRole('switch', {
      name: /Background task notifications/,
    })
    await expect(notifications).toBeEnabled()
    const wasEnabled = await notifications.isChecked()
    await settings.locator('[data-slot="switch-content"]').first().click()
    await expect
      .poll(async () =>
        page.evaluate(
          async () =>
            (await window.aideSessions.listSessions()).notificationsEnabled,
        ),
      )
      .toBe(!wasEnabled)
    const categories = settings.getByRole('navigation', {
      name: 'Settings categories',
    })
    await categories
      .getByRole('button', { name: 'Keyboard shortcuts', exact: true })
      .click()
    await expect(settings).toContainText('Open command palette')
    await expect(notifications).toHaveCount(0)
    await categories
      .getByRole('button', { name: 'Appearance', exact: true })
      .click()
    const animations = settings.getByRole('button', { name: /Animations/ })
    await animations.click()
    await page
      .getByRole('option', { name: 'Reduced motion', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await animations.click()
    await page.getByRole('option', { name: 'On', exact: true }).click()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
    await animations.click()
    await page
      .getByRole('option', { name: 'System default', exact: true })
      .click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'full')
    await animations.click()
    await page
      .getByRole('option', { name: 'Reduced motion', exact: true })
      .click()
    await page.screenshot({
      path: test.info().outputPath('settings-appearance.png'),
    })
    await categories
      .getByRole('button', { name: 'General', exact: true })
      .click()
    await page.screenshot({
      path: test.info().outputPath('settings-desktop.png'),
    })
    await page.setViewportSize({ width: 740, height: 720 })
    expect(
      await settings.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true)
    await page.screenshot({
      path: test.info().outputPath('settings-narrow.png'),
    })
    await search.focus()
    await page.keyboard.press('Escape')
    await expect(settings).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await expect(prompt).toHaveValue('Keep this draft while I check settings')
    await trigger.click()
    await expect(notifications).toBeEnabled()
    await expect(notifications).toBeChecked({ checked: !wasEnabled })
    await settings.getByRole('button', { name: 'Back to app' }).click()
    await expect(prompt).toHaveValue('Keep this draft while I check settings')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
  })

  test('hands a follow-up with images to the running agent', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app)
    const { page } = launched
    await page.setViewportSize({ width: 1100, height: 720 })
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('wait-claude')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'running' })
    const followUp =
      'Use Fable 5.1 in v0.0.2.\nKeep the entire message and its screenshot.'
    for (const text of [followUp]) {
      await prompt.fill(text)
      if (text === followUp) {
        const thumbnail = readFileSync(
          path.join(workspaceDir, 'build/icon.png'),
        ).toString('base64')
        await prompt.evaluate((element, base64) => {
          const clipboardData = new DataTransfer()
          const bytes = Uint8Array.from(atob(base64), (character) =>
            character.charCodeAt(0),
          )
          clipboardData.items.add(
            new File([bytes], 'preview.png', { type: 'image/png' }),
          )
          clipboardData.items.add(
            new File([bytes], 'second-preview.png', { type: 'image/png' }),
          )
          element.dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, clipboardData }),
          )
        }, thumbnail)
        await expect(
          page
            .getByTestId('composer-attachments')
            .getByRole('img', { name: 'preview.png', exact: true }),
        ).toBeVisible()
        const composer = page.getByTestId('managed-composer')
        const imageBounds = await composer
          .getByRole('img', { name: 'preview.png', exact: true })
          .boundingBox()
        const closeBounds = await composer
          .getByRole('button', { name: 'Remove preview.png' })
          .boundingBox()
        if (!imageBounds || !closeBounds)
          throw new Error('Attachment preview is missing')
        expect(imageBounds.width).toBe(imageBounds.height)
        expect(closeBounds.x).toBeGreaterThan(
          imageBounds.x + imageBounds.width / 2,
        )
        expect(closeBounds.y).toBeLessThan(
          imageBounds.y + imageBounds.height / 2,
        )
        expect(
          await composer.evaluate(
            (element) => getComputedStyle(element).borderWidth,
          ),
        ).toBe('0px')
        expect(
          await composer.evaluate(
            (element) => getComputedStyle(element).backgroundColor,
          ),
        ).not.toBe(
          await page
            .getByTestId('managed-agent-pane')
            .evaluate((element) => getComputedStyle(element).backgroundColor),
        )
        await page.screenshot({
          path: test.info().outputPath('composer-thumbnail.png'),
        })
      }
      await page.getByRole('button', { name: 'Send prompt' }).click()
    }
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Steered: Use Fable 5.1 in v0.0.2.',
    )
    const sentMessage = page
      .getByTestId('managed-content-user-prompt')
      .filter({ hasText: 'Use Fable' })
    await expect(sentMessage.getByRole('img')).toHaveCount(2)
    await expect(
      sentMessage.getByRole('button', { name: /Remove/ }),
    ).toHaveCount(0)
    await app.close()
    app = null
    const restarted = await launchAideApp(repository, dataDirectory)
    app = restarted.app
    await expect(
      restarted.page
        .getByTestId('managed-content-user-prompt')
        .filter({ hasText: 'Use Fable' })
        .getByRole('img'),
    ).toHaveCount(2)
  })

  test('sends Codex follow-ups immediately through required Jev preparation', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app, 'codex')
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /codex prompt/i })
    await prompt.fill('wait-codex')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({ sessionState: 'running' })
    await prompt.fill('change direction now')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Steered: change direction now',
    )
  })

  test('labels a running Codex opinion response under a Claude parent', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })

    await prompt.fill('@Codex wait-codex')
    await page.getByRole('button', { name: 'Send prompt' }).click()
    await expect(page.getByText('Codex is working...')).toBeVisible()
    await expect(page.getByText('Claude is working...')).toHaveCount(0)

    await page.getByRole('button', { name: 'Interrupt @codex' }).click()
    await expect
      .poll(() => getOnlySnapshot(page))
      .toMatchObject({
        turns: expect.arrayContaining([
          expect.objectContaining({
            recipientAlias: 'codex',
            state: 'cancelled',
          }),
        ]),
      })
  })

  test('attaches a selected workspace file to a required-Jev turn', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startPlainChat(launched.page, app)
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
    const session = await startPlainChat(launched.page, app)
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

  test('keeps the orchestrator while tagged opinions retain model attribution in Build and Plan', async () => {
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

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@cla')
    await page.getByRole('option', { name: /@claude/i }).click()
    await expect(
      page.getByRole('button', { name: /Remove @claude/i }),
    ).toBeVisible()
    await prompt.fill('@cod')
    await prompt.press('Enter')
    await expect(
      page.getByRole('button', { name: /Remove @codex/i }),
    ).toBeVisible()
    await prompt.fill('compare the implementation')
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

    await selectPlanMode(page)
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
  test('closes the configured agents popover on an outside click', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched

    const trigger = page.getByRole('button', { name: 'Agents', exact: true })
    const popover = page.getByText('Configured agents', { exact: true })

    await trigger.click()
    await expect(popover).toBeVisible()
    await page.getByText('@claude', { exact: true }).click()
    await expect(popover).toBeVisible()

    await page.getByTestId('managed-session-content').click()
    await expect(popover).toBeHidden()

    await trigger.click()
    await expect(popover).toBeVisible()
    await trigger.click()
    await expect(popover).toBeHidden()
  })

  test('closes the configured agents popover on Escape and refocuses the trigger', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched

    const trigger = page.getByRole('button', { name: 'Agents', exact: true })
    const popover = page.getByText('Configured agents', { exact: true })

    await trigger.click()
    await expect(popover).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(popover).toBeHidden()
    await expect(trigger).toBeFocused()
  })

  test('preserves a completed opinion when a peer fails, then interrupts only the pending peer', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
    const { page } = launched
    await selectPlanMode(page)

    // why: a peer's turn state lands after its reply is visible, so the fake provider's agent runs can outlast the 5 s default poll deadline under load.
    const peerTurnPoll = { timeout: 15_000 }

    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('@Claude @Codex fail-claude')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: fail-claude',
    )
    await expect
      .poll(() => getOnlySnapshot(page), peerTurnPoll)
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
      .poll(() => getOnlySnapshot(page), peerTurnPoll)
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
      .poll(() => getOnlySnapshot(page), peerTurnPoll)
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
  test('rounds the settings select menu and the model selector popover to 8px', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    const { page } = launched
    await startPlainChat(page, app)

    await page.locator('button.composer-tool.max-w-full').first().click()
    const picker = page.locator('[data-model-selector-menu]')
    await expect(picker).toBeVisible()
    await expect
      .poll(() =>
        picker.evaluate((element) => getComputedStyle(element).borderRadius),
      )
      .toBe('8px')
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Open sidebar' }).click()
    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('button', { name: 'Animations' }).click()
    const selectMenu = page.locator('.select__popover')
    await expect(selectMenu).toBeVisible()
    await expect
      .poll(() =>
        selectMenu.evaluate(
          (element) => getComputedStyle(element).borderRadius,
        ),
      )
      .toBe('8px')
  })
})
