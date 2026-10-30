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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-stash-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), '# aide\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function launchAideApp(
  repository: string,
  dataDirectory: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({
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
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

async function openAgentPane(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: /^agent unified/i }).click()
  await page.evaluate(async () => {
    const storage = await window.aide.getStorageSnapshot()
    const workspace = storage.workspaces[0]
    if (!workspace) throw new Error('Workspace unavailable.')
    await window.aide.updateJevSettings(workspace.id, {
      allowProcessing: true,
    })
  })
}

function promptBox(page: Page) {
  return page.getByRole('textbox', { name: /claude prompt/i })
}

async function sendPrompt(page: Page, text: string): Promise<void> {
  await promptBox(page).fill(text)
  await promptBox(page).press('Enter')
  await expect(page.getByTestId('managed-session-content')).toContainText(
    `Handled: ${text}`,
  )
}

test.describe('composer stash and prompt history', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
    app = null
    dataDirectory = null
    repository = null
  })

  test('keeps stashed drafts and prompt history across a relaunch', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-stash-e2e-data-'))
    let launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    await openAgentPane(launched.page)

    await sendPrompt(launched.page, 'first prompt')
    await sendPrompt(launched.page, 'second prompt')
    await promptBox(launched.page).fill('draft to keep')
    await promptBox(launched.page).press('Control+s')
    await expect(promptBox(launched.page)).toHaveValue('')
    await expect(
      launched.page.getByRole('button', { name: 'Stashed drafts (1)' }),
    ).toBeVisible()

    await app.close()
    launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    const page = launched.page
    const prompt = promptBox(page)

    await prompt.click()
    await prompt.press('ArrowUp')
    await expect(prompt).toHaveValue('second prompt')
    await prompt.press('ArrowUp')
    await expect(prompt).toHaveValue('first prompt')
    await prompt.press('ArrowDown')
    await expect(prompt).toHaveValue('second prompt')
    await prompt.press('ArrowDown')
    await expect(prompt).toHaveValue('')

    await page.getByRole('button', { name: 'Stashed drafts (1)' }).click()
    await page
      .getByTestId('composer-stash-menu')
      .getByRole('button', { name: /^draft to keep/ })
      .click()
    await expect(prompt).toHaveValue('draft to keep')
    await expect(
      page.getByRole('button', { name: /Stashed drafts/ }),
    ).toHaveCount(0)
  })

  test('attaches a long paste and downscales a pasted screenshot', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-stash-e2e-data-'))
    const launched = await launchAideApp(repository, dataDirectory)
    app = launched.app
    const page = launched.page
    await openAgentPane(page)
    const prompt = promptBox(page)
    await expect(prompt).toBeEnabled()

    const pastedText = 'log line\n'.repeat(2_300)
    const pasteText = () =>
      prompt.evaluate((element, text) => {
        const data = new DataTransfer()
        data.setData('text/plain', text)
        element.dispatchEvent(
          new ClipboardEvent('paste', {
            bubbles: true,
            cancelable: true,
            clipboardData: data,
          }),
        )
      }, pastedText)
    await pasteText()
    const chip = page.getByTestId('pasted-text-attachment')
    await expect(chip).toContainText('pasted-text-1.txt')
    await expect(prompt).toHaveValue('')
    await chip.getByRole('button', { name: 'Paste inline' }).click()
    await expect(chip).toHaveCount(0)
    await expect(prompt).toHaveValue(pastedText)

    await prompt.fill('')
    await prompt.evaluate(async (element) => {
      const canvas = new OffscreenCanvas(6000, 4000)
      const context = canvas.getContext('2d')
      if (!context) throw new Error('No canvas context.')
      context.fillStyle = '#336699'
      context.fillRect(0, 0, 6000, 4000)
      const blob = await canvas.convertToBlob({ type: 'image/png' })
      const data = new DataTransfer()
      data.items.add(new File([blob], 'screen.png', { type: 'image/png' }))
      element.dispatchEvent(
        new ClipboardEvent('paste', {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      )
    })
    const image = page.getByRole('img', { name: 'screen.png' })
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate((element: HTMLImageElement) => [
          element.naturalWidth,
          element.naturalHeight,
        ]),
      )
      .toEqual([2048, 1365])

    await page.getByRole('button', { name: 'Remove screen.png' }).click()
    await pasteText()
    await prompt.fill('summarize the log')
    await prompt.press('Enter')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: summarize the log',
    )
    await expect(page.getByTestId('message-attachments')).toContainText(
      'pasted-text-1.txt',
    )
  })
})
