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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-plan-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.getByRole('textbox', { name: /claude prompt/i }).fill(text)
  await page.getByRole('button', { name: /send prompt/i }).click()
}

/** Every live session with its mode, so a test can follow the source and any new thread. */
async function sessions(page: Page) {
  return await page.evaluate(async () =>
    Object.values(await window.aideSessions.getSessions()).map((session) => ({
      content: session.content.map((item) => item.text).join('\n'),
      interactionMode: session.interactionMode,
      paneId: session.paneId,
      pendingApprovals: session.pendingApprovals.length,
      sessionId: session.sessionId,
    })),
  )
}

async function sourceSession(page: Page) {
  const source = (await sessions(page)).find(
    (session) => !session.paneId.includes('copy-plan'),
  )
  if (!source) throw new Error('Source session unavailable.')
  return source
}

async function enterPlanMode(page: Page): Promise<void> {
  const { sessionId } = await sourceSession(page)
  await page.evaluate(
    (id) => window.aideSessions.setMode(id, 'plan'),
    sessionId,
  )
  await expect
    .poll(async () => (await sourceSession(page)).interactionMode)
    .toBe('plan')
}

test.describe('plan card', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('refines, implements and implements a plan in a new thread', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-plan-e2e-data-'))
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

    const content = page.getByTestId('managed-session-content')
    const card = page.getByTestId('managed-plan-card')
    await sendPrompt(page, 'hello')
    await expect(content).toContainText('Handled: hello')
    await enterPlanMode(page)

    // Refine: the card renders markdown, collapses the long plan, and the note denies it.
    await sendPrompt(page, 'plan approval')
    await expect(
      card.getByRole('heading', { name: 'Rename the greeting' }),
    ).toBeVisible()
    await expect(card).not.toContainText('"plan"')
    await expect(
      card.getByRole('button', { name: 'Show full plan' }),
    ).toBeVisible()
    await page.screenshot({ path: '/tmp/aide-plan-card.png' })
    await card.getByRole('button', { name: /^Refine/ }).click()
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await expect(prompt).toBeFocused()
    await prompt.fill('Split step two.')
    await page.getByRole('button', { name: 'Refine the plan' }).click()
    await expect(content).toContainText(
      'claude got the denial reason: Split step two.',
    )
    await expect(card).toHaveCount(0)
    expect(await sourceSession(page)).toMatchObject({
      interactionMode: 'plan',
      pendingApprovals: 0,
    })

    // Implement: approves and leaves plan mode.
    await sendPrompt(page, 'plan approval')
    await card.getByRole('button', { name: /^Implement\s*1$/ }).click()
    await expect(card).toHaveCount(0)
    await expect
      .poll(async () => (await sourceSession(page)).interactionMode)
      .toBe('build')
    expect((await sourceSession(page)).pendingApprovals).toBe(0)

    // Implement in a new thread: a build-mode session gets the plan, the source keeps planning.
    await enterPlanMode(page)
    await sendPrompt(page, 'plan approval')
    await card
      .getByRole('button', { name: /^Implement in a new thread/ })
      .click()
    await expect
      .poll(
        async () =>
          (await sessions(page)).find((session) =>
            session.paneId.includes('copy-plan'),
          ) ?? null,
      )
      .toMatchObject({
        content: expect.stringContaining(
          'Handled: Implement this plan:\n\n# Rename the greeting',
        ),
        interactionMode: 'build',
      })
    await expect(page.getByText(/Implement this plan:/).first()).toBeVisible()
    await expect
      .poll(async () => await sourceSession(page))
      .toMatchObject({ interactionMode: 'plan', pendingApprovals: 0 })
  })
})
