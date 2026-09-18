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
  if (!allowProcessing) return
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
    await page.getByText('Jev · Workspace permission required').click()
    await page.getByRole('button', { name: 'Close Jev setup' }).click()
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeHidden()
    await page.getByText('Jev · Workspace permission required').click()
    await page
      .getByRole('checkbox', {
        name: 'Allow TypeSafe processing for this workspace',
      })
      .focus()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeHidden()
    await page.getByText('Jev · Workspace permission required').click()
    await expect(
      page.getByText(/Enable your operating system keyring/),
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
        'Allow TypeSafe processing for this workspace in Jev setup before sending a message.',
      ),
    ).toBeVisible()
    await expect(prompt).toHaveValue('help with this ordinary folder')
    await page
      .getByRole('checkbox', {
        name: 'Allow TypeSafe processing for this workspace',
      })
      .check()
    await page.getByRole('button', { name: 'Save Jev settings' }).click()
    await expect(page.getByText('Jev · Ready')).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeHidden()
    const jevSettingsButton = page.getByRole('button', {
      name: 'Jev settings',
    })
    await jevSettingsButton.click()
    await expect(page.getByText('Jev · Ready')).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Close Jev setup' }).click()
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeHidden()
    await expect(jevSettingsButton).toBeFocused()
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
      await page.evaluate(() => window.aide.getManagedSessionSnapshots()),
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
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
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

    await prompt.fill('@')
    await expect(
      page.getByRole('option', { name: /@claude/i }),
    ).toHaveAttribute('aria-selected', 'true')
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

    await prompt.press('Backspace')
    await expect(page.getByTestId('managed-recipient-chips')).toHaveCount(0)
    await prompt.fill('@')
    await prompt.press('ArrowUp')
    await expect(page.getByRole('option', { name: /^Files/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    await prompt.press('Enter')
    await expect(page.getByTestId('composer-attachments')).toContainText(
      'README.md',
    )
    await expect(prompt).toHaveValue('')
  })

  test('ranks skill names first and removes stale suggestions while typing', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
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

  test('opens settings with searchable shortcuts and persists preferences without losing the draft', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
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
    await search.fill('visible model')
    await expect(settings).toContainText('Choose a visible model')
    await expect(settings).not.toContainText('Open command palette')
    await search.fill('')
    const notifications = settings.getByRole('switch', {
      name: /Background task notifications/,
    })
    await expect(notifications).toBeEnabled()
    const wasEnabled = await notifications.isChecked()
    await settings.locator('[data-slot="switch-content"]').click()
    await expect
      .poll(async () =>
        page.evaluate(
          async () => (await window.aide.getTaskLibrary()).notificationsEnabled,
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

  test('queues follow-ups, cancels one, and resumes after interruption', async () => {
    repository = createGitRepository()
    const launched = await launchAideApp(repository)
    app = launched.app
    dataDirectory = launched.dataDirectory
    await startSharedChat(launched.page, app)
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
    for (const text of ['cancel this follow-up', followUp]) {
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
    const queue = page.getByTestId('managed-input-queue')
    await expect(queue).toContainText('2 queued')
    const previewToggle = queue
      .locator('summary')
      .filter({ hasText: 'Use Fable' })
    await previewToggle.focus()
    await page.keyboard.press('Enter')
    await expect(
      queue.getByTestId('queued-message-preview').last(),
    ).toContainText(followUp)
    await expect(
      queue.getByRole('img', { name: 'preview.png', exact: true }),
    ).toBeVisible()
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
      'Handled: Use Fable 5.1 in v0.0.2.',
    )
    await expect(queue).not.toBeVisible()
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
