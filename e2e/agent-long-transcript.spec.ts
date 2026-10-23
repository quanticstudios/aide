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
const content = '[data-testid="managed-session-content"]'

function runGit(workingDirectory: string, arguments_: string[]): void {
  execFileSync('git', arguments_, {
    cwd: workingDirectory,
    env: gitEnvironment,
  })
}

function createRepository(): string {
  const repository = mkdtempSync(
    path.join(tmpdir(), 'aide-long-transcript-e2e-'),
  )
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

function countTranscriptNodes(page: Page): Promise<number> {
  return page.evaluate(
    (selector) => document.querySelectorAll(`${selector} *`).length,
    content,
  )
}

function scrollHeight(page: Page): Promise<number> {
  return page.evaluate(
    (selector) => document.querySelector(selector)?.scrollHeight ?? 0,
    content,
  )
}

function distanceFromBottom(page: Page): Promise<number> {
  return page.evaluate((selector) => {
    const scroll = document.querySelector(selector)
    if (!scroll) throw new Error('Transcript unavailable.')
    return scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight
  }, content)
}

test.describe('long agent transcript', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('opens, scrolls and follows a 2,000-item transcript', async () => {
    test.setTimeout(120_000)
    repository = createRepository()
    dataDirectory = mkdtempSync(
      path.join(tmpdir(), 'aide-long-transcript-e2e-data-'),
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
    const transcript = page.getByTestId('managed-session-content')
    const lastStep = transcript.getByText('Step 999 line 3: checked')
    await prompt.fill('long transcript')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(lastStep).toBeVisible({ timeout: 30_000 })
    const nodesAt2000 = await countTranscriptNodes(page)

    // why: the open clock starts when the pane's scroll container mounts, so app boot stays out of it.
    await page.addInitScript(() => {
      const marks: { start?: number; end?: number } = {}
      Object.assign(window, { __transcriptOpen: marks })
      const poll = () => {
        const scroll = document.querySelector(
          '[data-testid="managed-session-content"]',
        )
        if (scroll && marks.start === undefined) marks.start = performance.now()
        if (scroll?.textContent?.includes('Step 999 line 3: checked')) {
          marks.end = performance.now()
          return
        }
        requestAnimationFrame(poll)
      }
      requestAnimationFrame(poll)
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(lastStep).toBeInViewport({ timeout: 30_000 })
    const openMs = await page.evaluate(() => {
      const marks = (
        window as unknown as {
          __transcriptOpen: { start: number; end: number }
        }
      ).__transcriptOpen
      return marks.end - marks.start
    })

    const frames = await page.evaluate(async (selector) => {
      const scroll = document.querySelector(selector)
      if (!scroll) throw new Error('Transcript unavailable.')
      const steps = 120
      const stride = Math.ceil(scroll.scrollHeight / steps)
      const deltas: number[] = []
      let previous = performance.now()
      for (let step = 0; step < steps && scroll.scrollTop > 0; step++) {
        scroll.scrollTop -= stride
        await new Promise(requestAnimationFrame)
        const now = performance.now()
        deltas.push(now - previous)
        previous = now
      }
      scroll.scrollTop = 0
      deltas.sort((a, b) => a - b)
      return {
        count: deltas.length,
        medianMs: deltas[Math.floor(deltas.length / 2)] ?? 0,
        worstMs: deltas.at(-1) ?? 0,
      }
    }, content)
    console.log('long transcript open', { nodesAt2000, openMs, frames })
    await expect(
      transcript.getByText('Step 0 line 0: checked'),
    ).toBeInViewport()

    await page.evaluate((selector) => {
      const scroll = document.querySelector(selector)
      if (scroll) scroll.scrollTop = scroll.scrollHeight
    }, content)
    await expect(lastStep).toBeInViewport()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2)

    const heightAt2000 = await scrollHeight(page)
    await prompt.fill('long transcript')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect
      .poll(() => scrollHeight(page), { timeout: 30_000 })
      .toBeGreaterThan(heightAt2000 * 1.5)
    await expect(lastStep.last()).toBeInViewport()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2)
    const nodesAt4000 = await countTranscriptNodes(page)

    await prompt.fill('hello')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(transcript.getByText('Handled: hello')).toBeInViewport()
    await expect.poll(() => distanceFromBottom(page)).toBeLessThan(2)

    test.info().annotations.push({
      type: 'long-transcript',
      description: JSON.stringify({ openMs, frames, nodesAt2000, nodesAt4000 }),
    })
    console.log('long transcript', { openMs, frames, nodesAt2000, nodesAt4000 })
    expect(openMs).toBeLessThan(300)
    expect(frames.medianMs).toBeLessThan(1000 / 50)
    expect(nodesAt4000).toBeLessThan(nodesAt2000 * 1.5)
  })
})
