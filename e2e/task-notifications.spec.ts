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

function createRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-notify-e2e-'))
  for (const arguments_ of [
    ['init', '-b', 'main'],
    ['add', 'README.md'],
    ['commit', '-m', 'Initial'],
  ]) {
    if (arguments_[0] === 'add')
      writeFileSync(path.join(repository, 'README.md'), 'before\n')
    execFileSync('git', arguments_, { cwd: repository, env: gitEnvironment })
  }
  return repository
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  const prompt = page.getByRole('textbox', { name: /claude prompt/i })
  await prompt.fill(text)
  await page.getByRole('button', { name: /send prompt/i }).click()
}

interface Stubbed {
  notifications: Array<{ title: string; body: string; silent: boolean }>
  badges: number[]
}

async function stubbed(app: ElectronApplication): Promise<Stubbed> {
  return await app.evaluate(() => {
    const state = (globalThis as unknown as { __notify: Stubbed }).__notify
    return {
      notifications: [...state.notifications],
      badges: [...state.badges],
    }
  })
}

async function setFocused(app: ElectronApplication, focused: boolean) {
  await app.evaluate((_electron, value) => {
    ;(globalThis as unknown as { __focused: boolean }).__focused = value
  }, focused)
}

test.describe('task notifications', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  /** Opens a project with one Agent pane, notifications and the badge stubbed, and the window unfocused. */
  async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-notify-e2e-data-'))
    const launched = await electron.launch({
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
    app = launched
    await launched.evaluate(
      ({ app: electronApp, BrowserWindow, Notification }) => {
        const scope = globalThis as unknown as {
          __focused: boolean
          __notify: Stubbed
        }
        scope.__focused = false
        scope.__notify = { notifications: [], badges: [] }
        Notification.isSupported = () => true
        Notification.prototype.show = function (this: Electron.Notification) {
          scope.__notify.notifications.push({
            title: this.title,
            body: this.body,
            silent: this.silent,
          })
        }
        electronApp.setBadgeCount = (count?: number) => {
          scope.__notify.badges.push(count ?? 0)
          return true
        }
        BrowserWindow.getFocusedWindow = () =>
          scope.__focused ? (BrowserWindow.getAllWindows()[0] ?? null) : null
        globalThis.fetch = async (url, options) => {
          if (url !== 'https://api.typesafe.ai/v1/systemone')
            throw new Error(`Unexpected request: ${url}`)
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
      },
    )
    const page = await launched.firstWindow()
    await page.waitForLoadState('domcontentloaded')
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

    return { app: launched, page }
  }

  test('names the thread, toasts when focused, notifies the OS otherwise, and badges waiting threads', async () => {
    const { app, page } = await launch()

    await sendPrompt(page, 'Fix checkout')
    await expect
      .poll(
        async () => (await stubbed(app as ElectronApplication)).notifications,
      )
      .toEqual([{ title: 'Fix checkout', body: 'Done', silent: true }])

    await sendPrompt(page, 'approval')
    await expect
      .poll(async () =>
        (await stubbed(app as ElectronApplication)).notifications.at(-1),
      )
      .toEqual({
        title: 'Fix checkout',
        body: 'Approval needed: Bash',
        silent: true,
      })
    await expect
      .poll(async () =>
        (await stubbed(app as ElectronApplication)).badges.at(-1),
      )
      .toBe(1)
    await expect(page.getByText('Approval needed: Bash')).toHaveCount(0)
    await page.keyboard.press('1')
    await expect
      .poll(async () =>
        (await stubbed(app as ElectronApplication)).badges.at(-1),
      )
      .toBe(0)

    const session = await page.evaluate(async () => {
      const snapshot = Object.values(await window.aideSessions.getSessions())[0]
      if (!snapshot) throw new Error('Managed session did not start.')
      return {
        paneId: snapshot.paneId,
        sessionId: snapshot.sessionId,
        workspaceId: snapshot.workspaceId,
      }
    })
    const activePaneId = () =>
      page.evaluate(
        async (workspaceId) =>
          (await window.aide.getStorageSnapshot()).lastActivePaneIdsByWorkspace[
            workspaceId
          ],
        session.workspaceId,
      )
    await page.getByRole('button', { name: /add pane/i }).click()
    await page
      .getByRole('dialog', { name: 'Add pane' })
      .getByRole('button', { name: /^git\b/i })
      .click()
    await expect.poll(activePaneId).not.toBe(session.paneId)

    const osCount = (await stubbed(app)).notifications.length
    await setFocused(app, true)
    // Sent over IPC so the git pane keeps focus until the toast is clicked.
    await page.evaluate(
      (sessionId) => window.aideSessions.send(sessionId, 'input'),
      session.sessionId,
    )
    const toast = page.locator('[data-slot="toast-region"]')
    await expect(toast).toContainText('Fix checkout')
    await expect(toast).toContainText(
      'Input needed: What should claude do next?',
    )
    expect((await stubbed(app)).notifications).toHaveLength(osCount)
    await expect
      .poll(async () =>
        (await stubbed(app as ElectronApplication)).badges.at(-1),
      )
      .toBe(1)
    await page.screenshot({
      path: test.info().outputPath('task-notification-toast.png'),
    })

    await toast.getByRole('button', { name: 'Open', exact: true }).click()
    await expect.poll(activePaneId).toBe(session.paneId)
  })
  test('notifies and badges a pitwall chat that no aide pane shows', async () => {
    const pitwall = process.env.AIDE_E2E_PITWALL
    test.skip(
      !pitwall,
      'needs AIDE_E2E_PITWALL: only the daemon runs chats aide has no pane for',
    )
    const { app, page } = await launch()
    const chat = (args: string[]) =>
      execFileSync(pitwall as string, ['chat', ...args], {
        encoding: 'utf8',
        env: process.env,
      }).trim()
    const id = chat([
      'new',
      '--dir',
      repository as string,
      '--',
      'Fix checkout',
    ])
    chat(['wait', id, '--until', 'done'])
    // why: main stays quiet about what a chat did before aide first saw it.
    await expect
      .poll(() =>
        page.evaluate(
          async (chatId) =>
            (await window.aideSessions.listSessions()).tasks.find((task) =>
              task.sessionId.endsWith(chatId),
            )?.activityKey ?? null,
          id,
        ),
      )
      .not.toBeNull()

    chat(['send', id, '--', 'Ship it'])
    await expect
      .poll(async () => (await stubbed(app)).notifications)
      .toEqual([{ title: 'Fix checkout', body: 'Done', silent: true }])
    chat(['send', id, '--', 'input'])
    await expect
      .poll(async () => (await stubbed(app)).notifications.at(-1))
      .toEqual({
        title: 'Fix checkout',
        body: 'Input needed: What should claude do next?',
        silent: true,
      })
    await expect.poll(async () => (await stubbed(app)).badges.at(-1)).toBe(1)
  })
})
