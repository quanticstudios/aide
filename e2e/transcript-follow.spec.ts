import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Locator,
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
  const repository = mkdtempSync(
    path.join(tmpdir(), 'aide-transcript-follow-e2e-'),
  )
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

function distanceFromBottom(page: Page): Promise<number> {
  return page
    .getByTestId('managed-session-content')
    .evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)
}

// why: on CI the 300-line fake stream outlasts one expect timeout, so follow it 50 lines at a time.
async function expectStreamedThrough(
  reply: Locator,
  lastLine: number,
): Promise<void> {
  const lineText = (line: number) => `line ${String(line).padStart(3, '0')}`
  for (let line = 50; line < lastLine; line += 50) {
    await expect(reply).toContainText(lineText(line))
  }
  await expect(reply).toContainText(lineText(lastLine))
}

test.describe('transcript follow', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('follows one growing reply and stops when the reader scrolls up', async () => {
    test.setTimeout(90_000)
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-transcript-follow-e2e-data-'),
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

    const content = page.getByTestId('managed-session-content')
    const replies = page.getByTestId('managed-content-assistant-text')
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('stream-lines')
    await page.getByRole('button', { name: /send prompt/i }).click()

    await expectStreamedThrough(replies.first(), 150)
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(40)
    await expectStreamedThrough(replies.first(), 299)
    await expect
      .poll(() => content.evaluate((el) => el.scrollHeight / el.clientHeight))
      .toBeGreaterThan(2)
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(40)
    await expect(page.getByText('line 299')).toBeInViewport()

    await prompt.fill('short question')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(replies.nth(1)).toContainText('Handled: short question')
    const question = page.getByTestId('managed-content-user-prompt').nth(1)
    const questionOffset = () =>
      question.evaluate(
        (el) =>
          el.getBoundingClientRect().top -
          (el
            .closest('[data-testid="managed-session-content"]')
            ?.getBoundingClientRect().top ?? 0),
      )
    // why: a negative offset already passes "<= 40", so wait for both bounds at once.
    await expect
      .poll(async () => {
        const offset = await questionOffset()
        return offset >= 0 && offset <= 40 ? 'pinned' : offset
      })
      .toBe('pinned')
    const trailingSpace = () =>
      content.evaluate(
        (el) =>
          (el.firstElementChild as HTMLElement | null)?.style.paddingBottom,
      )
    expect(await trailingSpace()).toMatch(/px$/)

    const jump = page.getByRole('button', { name: /jump to latest/i })
    await content.hover()
    await page.mouse.wheel(0, -600)
    await expect.poll(trailingSpace).toBe('')
    await expect(jump).toBeVisible()
    await jump.click()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(40)
    expect(await trailingSpace()).toBe('')

    await prompt.fill('stream-lines')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(replies.nth(2)).toContainText('line 060')
    await content.hover()
    await page.mouse.wheel(0, -2000)
    await expectStreamedThrough(replies.nth(2), 299)
    expect(await distanceFromBottom(page)).toBeGreaterThan(400)

    await expect(jump).toBeVisible()
    await jump.click()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThanOrEqual(40)
    await expect(jump).toBeHidden()
  })
})
