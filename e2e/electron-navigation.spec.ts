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
const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Electron Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Electron Test',
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim()
}

function createGitRepository(): string {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'aide-electron-repo-'))

  runGit(repoRoot, ['init', '-b', 'main'])
  writeFileSync(path.join(repoRoot, 'README.md'), '# aide\n')
  runGit(repoRoot, ['add', 'README.md'])
  runGit(repoRoot, ['commit', '-m', 'Initial commit'])
  runGit(repoRoot, [
    'remote',
    'add',
    'origin',
    'https://github.com/example/aide.git',
  ])
  runGit(repoRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  runGit(repoRoot, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])

  return repoRoot
}

async function launchAideApp(
  envOverrides: Record<string, string> = {},
  options: {
    expectActivePane?: boolean
    tempDirectory?: string
  } = {},
): Promise<{
  app: ElectronApplication
  page: Page
  tempDirectory: string
}> {
  const tempDirectory =
    options.tempDirectory ?? mkdtempSync(path.join(tmpdir(), 'aide-electron-'))
  const app = await electron.launch({
    args: [workspaceDir, '--force-device-scale-factor=1'],
    executablePath: path.join(
      workspaceDir,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      AIDE_DATABASE_PATH: path.join(tempDirectory, 'aide.sqlite3'),
      TYPESAFE_API_KEY:
        envOverrides.AIDE_FAKE_MANAGED_PROVIDERS === '1'
          ? 'synthetic-e2e-key'
          : (process.env.TYPESAFE_API_KEY ?? ''),
      ...envOverrides,
      WAYLAND_DISPLAY: '',
      HYPRLAND_INSTANCE_SIGNATURE: '',
      SWAYSOCK: '',
      XDG_SESSION_TYPE: 'x11',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      OZONE_PLATFORM: 'x11',
      AIDE_SOFTWARE_RENDERING: '1',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  if (options.expectActivePane) {
    await expect(page.getByTestId('active-pane-name')).toBeVisible()
  }

  return { app, page, tempDirectory }
}

async function importProject(page: Page): Promise<void> {
  await expect(page.getByText('No project selected')).toBeVisible()
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
}

async function prepareSyntheticJev(
  app: ElectronApplication,
  page: Page,
): Promise<void> {
  await app.evaluate(() => {
    const nativeFetch = globalThis.fetch
    globalThis.fetch = async (url, options) => {
      if (url !== 'https://api.typesafe.ai/v1/systemone')
        return nativeFetch(url, options)
      const request = JSON.parse(String(options?.body))
      return new Response(
        JSON.stringify({
          answers: Object.fromEntries(
            Object.keys(request.questions).map((key) => [
              key,
              { type: 'noul', noul: 0.8 },
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
    const snapshot = await window.aide.getStorageSnapshot()
    for (const workspace of snapshot.workspaces) {
      await window.aide.updateJevSettings(workspace.id, {
        allowProcessing: true,
      })
    }
  })
}

async function addPane(page: Page, paneName: RegExp): Promise<void> {
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: paneName }).click()
}

async function expandSidebar(page: Page): Promise<void> {
  await page.getByTestId('sidebar-shell').getByRole('button').first().focus()
  await expect(page.getByTestId('workspace-tree-panel')).toHaveAttribute(
    'data-expanded',
    'true',
  )
}

async function createWorkspace(
  page: Page,
  input: {
    branchName: string
    name: string
  },
): Promise<void> {
  await expandSidebar(page)
  await page
    .getByRole('button', { name: /new workspace/i })
    .last()
    .click()
  await page.getByLabel('Workspace name').fill(input.name)
  await page.getByLabel('Branch name').fill(input.branchName)
  await page
    .getByRole('button', { name: /create workspace/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText(input.name)
}

async function expectRestingViewportClean(page: Page): Promise<void> {
  const ownership = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>(
      '[data-testid="workspace-viewport"]',
    )
    const activeWorkspace = document.querySelector<HTMLElement>(
      '.workspace-slide[data-active-workspace="true"]',
    )
    const activeSurface = document.querySelector<HTMLElement>(
      '.workspace-slide[data-active-workspace="true"] [data-active-surface="true"]',
    )

    if (!viewport || !activeWorkspace || !activeSurface) {
      return {
        surfaceHeightRatio: 0,
        surfaceWidthRatio: 0,
        workspaceHeightRatio: 0,
        workspaceWidthRatio: 0,
      }
    }

    const viewportRect = viewport.getBoundingClientRect()
    const workspaceRect = activeWorkspace.getBoundingClientRect()
    const surfaceRect = activeSurface.getBoundingClientRect()

    return {
      surfaceHeightRatio: surfaceRect.height / viewportRect.height,
      surfaceWidthRatio: surfaceRect.width / viewportRect.width,
      workspaceHeightRatio: workspaceRect.height / viewportRect.height,
      workspaceWidthRatio: workspaceRect.width / viewportRect.width,
    }
  })

  expect(ownership.workspaceWidthRatio).toBeGreaterThan(0.94)
  expect(ownership.workspaceHeightRatio).toBeGreaterThan(0.94)
  expect(ownership.surfaceWidthRatio).toBeGreaterThan(0.94)
  expect(ownership.surfaceHeightRatio).toBeGreaterThan(0.94)
}

async function runPaletteCommand(page: Page, label: string): Promise<void> {
  await page.keyboard.press('Control+K')
  const input = page.getByPlaceholder('Type a command...')
  await expect(input).toBeFocused()
  await input.fill(label)
  await page.getByText(label, { exact: true }).click()
}

test.describe('electron spatial navigation', () => {
  let app: ElectronApplication | null = null
  let additionalRepoRoots: string[] = []
  let importedRepoRoot: string | null = null
  let tempDirectory: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    if (importedRepoRoot) {
      rmSync(importedRepoRoot, { force: true, recursive: true })
    }
    for (const repoRoot of additionalRepoRoots) {
      rmSync(repoRoot, { force: true, recursive: true })
    }
    if (tempDirectory) {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
    app = null
    additionalRepoRoots = []
    importedRepoRoot = null
    tempDirectory = null
  })

  test('can open a git project from the empty state', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const runtime = await page.evaluate(() => window.aide.getRuntimeSnapshot())
    await expect(page.getByTestId('app-version')).toHaveText(
      `aIDE v${runtime.appVersion}`,
    )
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') {
        consoleErrors.push(message.text())
      }
    })

    await importProject(page)

    await expect(
      page.locator('[data-testid^="project-rail-button-"]'),
    ).toHaveCount(1)
    await expect(
      page.locator(
        ':is(button, a[href], input, select, textarea, [role="button"], [role="link"]) :is(button, a[href], input, select, textarea, [role="button"], [role="link"])',
      ),
    ).toHaveCount(0)
    await expect(
      page.locator('button:not([aria-label])').filter({ hasText: /^\s*$/ }),
    ).toHaveCount(0)
    expect(consoleErrors).toEqual([])
  })

  test('shows local-only diagnostics and the explicit support export action', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const diagnosticsButton = launched.page.getByRole('button', {
      name: 'Open diagnostics',
    })
    await diagnosticsButton.click()

    await expect(
      launched.page.getByRole('heading', { name: 'Diagnostics' }),
    ).toBeVisible()
    await expect(
      launched.page.getByText(
        /Prompts, terminal output, patches, credentials, environment values, and home paths are never included\./,
      ),
    ).toBeVisible()
    await expect(
      launched.page.getByRole('button', { name: 'Export support bundle' }),
    ).toBeVisible()
    await launched.page.keyboard.press('Escape')
    await expect(
      launched.page.getByRole('heading', { name: 'Diagnostics' }),
    ).not.toBeVisible()
    await expect(diagnosticsButton).toBeFocused()
  })

  test('adds panes as full-size destinations and keeps siblings off-screen', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await addPane(page, /git/i)
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await expect(
      page.locator('.workspace-strip .workspace-strip-item'),
    ).toHaveCount(2)
    await expectRestingViewportClean(page)
  })

  test('moves panes horizontally without counting split children', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await addPane(page, /git/i)
    await addPane(page, /preview/i)
    await expect(
      page.locator('.workspace-strip .workspace-strip-item'),
    ).toHaveCount(3)

    await page.getByRole('button', { name: /git review/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await page.getByLabel(/split vertically/i).click()
    await page.getByRole('button', { name: /^Chat$/i }).click()

    await expect(
      page.locator('.workspace-strip .workspace-strip-item'),
    ).toHaveCount(3)

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Preview target',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )

    await expectRestingViewportClean(page)
  })

  test('moves workspaces vertically with no workspace bleed', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await createWorkspace(page, {
      branchName: 'workspace-2',
      name: 'Workspace 2',
    })
    await addPane(page, /git/i)
    await expectRestingViewportClean(page)

    await page.keyboard.down('Alt')
    await page.keyboard.press('k')
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await expectRestingViewportClean(page)

    await page.keyboard.down('Alt')
    await page.keyboard.press('j')
    await page.keyboard.up('Alt')
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Workspace 2',
    )
    await expectRestingViewportClean(page)
  })

  test('keeps camera navigation project-scoped and restores project selections', async () => {
    const firstProjectRoot = createGitRepository()
    const secondProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATHS: [firstProjectRoot, secondProjectRoot].join(
        path.delimiter,
      ),
    })
    app = launched.app
    importedRepoRoot = firstProjectRoot
    additionalRepoRoots.push(secondProjectRoot)
    tempDirectory = launched.tempDirectory

    const { page } = launched
    await importProject(page)
    await createWorkspace(page, {
      branchName: 'alpha-feature',
      name: 'Alpha Feature',
    })

    await expandSidebar(page)
    await page.getByRole('button', { name: /add project folder/i }).click()
    await expect(
      page.locator('[data-testid^="project-rail-button-"]'),
    ).toHaveCount(2)
    await createWorkspace(page, {
      branchName: 'beta-feature',
      name: 'Beta Feature',
    })

    await page.keyboard.press('Control+1')
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Alpha Feature',
    )
    await page.keyboard.press('Alt+j')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')

    await page.keyboard.press('Control+2')
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Beta Feature',
    )

    await page.evaluate(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          altKey: true,
          bubbles: true,
          code: 'Space',
          key: ' ',
        }),
      )
    })
    const switcher = page.locator(
      '[data-testid="workspace-switcher-overlay"][data-mode="workspace-switcher"]',
    )
    await expect(switcher).toBeVisible()
    await expect(
      switcher.getByRole('option', { name: /beta feature/i }),
    ).toBeVisible()
    await expect(
      switcher.getByRole('option', { name: /alpha feature/i }),
    ).toHaveCount(0)
    await page.keyboard.press('Escape')

    await page.keyboard.press('Control+Tab')
    const overview = page.locator(
      '[data-testid="workspace-switcher-overlay"][data-mode="overview"]',
    )
    await expect(
      overview.getByRole('option', { name: /alpha feature/i }),
    ).toBeVisible()
    await expect(
      overview.getByRole('option', { name: /beta feature/i }),
    ).toBeVisible()
  })

  test('opens overview with Ctrl+Tab and jumps to another workspace', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const overview = page.locator(
      '[data-testid="workspace-switcher-overlay"][data-mode="overview"]',
    )

    await importProject(page)
    await createWorkspace(page, {
      branchName: 'review-space',
      name: 'Review Space',
    })

    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Control')

    await expect(overview).toBeVisible()
    const reviewWorkspace = overview.getByRole('option', {
      name: /review space/i,
    })
    await expect(reviewWorkspace).toBeVisible()
    await reviewWorkspace.click()

    await expect(overview).not.toBeVisible()
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Review Space',
    )
  })

  test('supports sidebar hover, focus, and pinned-open persistence', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await page.evaluate(() => {
      window.localStorage.removeItem('aide.sidebar.pinned')
    })
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    const sidebarShell = page.getByTestId('sidebar-shell')
    const workspaceTree = page.getByTestId('workspace-tree-panel')

    await expect(workspaceTree).toHaveAttribute('data-expanded', 'false')

    await sidebarShell.hover()
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.mouse.move(1400, 120)
    await page.waitForTimeout(180)
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'false')

    await page.getByLabel('Workspace sidebar').focus()
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.getByRole('button', { name: /pin sidebar open/i }).click()
    await page.mouse.move(1400, 120)
    await page.waitForTimeout(180)
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')
  })

  test('persists explicit Jev workspace consent without exposing credentials', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_FAKE_MANAGED_PROVIDERS: '1',
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
      TYPESAFE_API_KEY: '',
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory
    const { page } = launched
    await importProject(page)
    await addPane(page, /^agent\b/i)
    await page.locator('summary').filter({ hasText: 'Jev' }).click()
    const consent = page.getByRole('checkbox', {
      name: 'Allow TypeSafe processing for this workspace',
    })
    await expect(consent).not.toBeChecked()
    const prompt = page.getByRole('textbox', { name: /claude prompt/i })
    await prompt.fill('Keep this draft until Jev is configured')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(
      page.getByText(
        /Allow TypeSafe processing for this workspace in Jev setup/,
      ),
    ).toBeVisible()
    await expect(prompt).toHaveValue('Keep this draft until Jev is configured')
    await expect(page.getByTestId('managed-input-queue')).toBeHidden()
    await expect(page.getByTestId('managed-session-content')).not.toContainText(
      'Handled:',
    )
    await consent.check()
    await page.getByRole('button', { name: 'Save Jev settings' }).click()
    await expect(
      page.getByRole('button', { name: 'Save Jev settings' }),
    ).toBeEnabled()
    await page.reload()
    await page.locator('summary').filter({ hasText: 'Jev' }).click()
    await expect(consent).toBeChecked()
    await expect(
      page.getByLabel('TypeSafe API key', { exact: true }),
    ).toHaveValue('')
    await expect(
      page.locator('summary').filter({ hasText: 'Jev' }),
    ).toContainText('API key required')
  })

  test('renders managed Claude states from structured runtime events', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_FAKE_MANAGED_PROVIDERS: '1',
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /^agent\b/i)
    await expandSidebar(page)
    await page.getByRole('button', { name: /pin sidebar open/i }).click()
    await prepareSyntheticJev(app, page)
    const workspaceSidebarRow = page
      .getByTestId('workspace-tree-panel')
      .getByRole('button', { name: /main/i })

    const promptInput = page.getByRole('textbox', { name: /claude prompt/i })
    await promptInput.fill('input')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(
      page.getByRole('button', { name: /submit answer/i }),
    ).toBeVisible()
    await expandSidebar(page)
    await expect(workspaceSidebarRow.getByText('Agent Input')).toBeVisible()
    await page.getByRole('button', { name: /Continue the task/i }).click()
    await page.getByRole('button', { name: /submit answer/i }).click()
    await expect(
      page.getByRole('button', { name: /submit answer/i }),
    ).not.toBeVisible()

    await promptInput.fill('approval')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expandSidebar(page)
    await expect(workspaceSidebarRow.getByText('Agent Approval')).toBeVisible()
    const allowOnce = page.getByRole('button', { name: /allow once/i })
    await allowOnce.hover()
    await allowOnce.click()

    await promptInput.fill('ship it')
    const sendPrompt = page.getByRole('button', { name: /send prompt/i })
    await expect(promptInput).toHaveValue('ship it')
    await expect(sendPrompt).toBeEnabled()
    await sendPrompt.click()
    await expect(promptInput).toHaveValue('')
    await expect(
      page.getByText(
        'A managed session turn is already being prepared or dispatched.',
      ),
    ).not.toBeVisible()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: ship it',
    )
  })

  test('reattaches a managed agent after renderer reload without ending its session', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_FAKE_MANAGED_PROVIDERS: '1',
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /^agent\b/i)

    const promptInput = page.getByRole('textbox', { name: /claude prompt/i })
    await prepareSyntheticJev(app, page)
    await promptInput.fill('keep this session alive')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: keep this session alive',
    )

    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    await expect(page.getByTestId('active-pane-name')).toHaveText('Agent')
    await expect(page.getByTestId('managed-session-content')).toContainText(
      'Handled: keep this session alive',
    )
  })

  test('stages, unstages, reverts and commits reviewed files', async () => {
    const chosenProjectRoot = createGitRepository()
    runGit(chosenProjectRoot, ['config', 'user.name', 'Aide test'])
    runGit(chosenProjectRoot, ['config', 'user.email', 'aide@example.com'])
    const readmePath = path.join(chosenProjectRoot, 'README.md')
    const original = readFileSync(readmePath, 'utf8')
    writeFileSync(readmePath, `${original}review this change\n`)
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory
    const { page } = launched
    await importProject(page)
    await addPane(page, /git/i)
    await page.getByTestId('git-pane-file-README.md').click()
    await page.getByRole('button', { name: 'Stage', exact: true }).click()
    await expect(
      page.getByRole('button', { name: 'Unstage', exact: true }),
    ).toBeVisible()
    expect(
      runGit(chosenProjectRoot, ['diff', '--cached', '--name-only']),
    ).toContain('README.md')
    await page.screenshot({ path: test.info().outputPath('git-review.png') })
    await page.getByRole('button', { name: 'Unstage', exact: true }).click()
    await page.getByRole('button', { name: 'Revert file', exact: true }).click()
    await page
      .getByRole('button', { name: 'Confirm revert', exact: true })
      .click()
    await expect.poll(() => readFileSync(readmePath, 'utf8')).toBe(original)
    writeFileSync(path.join(chosenProjectRoot, 'committed.txt'), 'reviewed\n')
    await page.reload()
    await page.getByTestId('git-pane-file-committed.txt').click()
    await page.getByRole('button', { name: 'Stage', exact: true }).click()
    await page
      .getByLabel('Commit message', { exact: true })
      .fill('Commit reviewed file')
    await page
      .getByRole('button', { name: 'Commit index', exact: true })
      .click()
    await expect
      .poll(() => runGit(chosenProjectRoot, ['log', '-1', '--format=%s']))
      .toBe('Commit reviewed file')
  })

  test('renders a real git pane and updates the review surface on file selection', async () => {
    const chosenProjectRoot = createGitRepository()
    const readmePath = path.join(chosenProjectRoot, 'README.md')
    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}staged\n`)
    runGit(chosenProjectRoot, ['add', 'README.md'])
    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}unstaged\n`)
    writeFileSync(path.join(chosenProjectRoot, 'notes.txt'), 'local notes\n')

    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /git/i)

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expect(page.getByTestId('git-pane')).toBeVisible()
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'README.md',
    )
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'notes.txt',
    )
    await expect(
      page.getByTestId('git-pane-file-README.md'),
    ).toHaveAccessibleName(/README\.md Modified/i)
    await expect(
      page.getByTestId('git-pane-file-notes.txt'),
    ).toHaveAccessibleName(/notes\.txt Untracked/i)

    await page.getByTestId('git-pane-file-README.md').click()
    await expect(page.getByTestId('git-pane-selected-file')).toHaveText(
      'README.md',
    )
    await expect(page.getByTestId('git-pane-diff-staged')).toContainText(
      'staged',
    )
    await expect(page.getByTestId('git-pane-diff-unstaged')).toContainText(
      'unstaged',
    )

    await page.getByTestId('git-pane-file-notes.txt').click()
    await expect(page.getByTestId('git-pane-selected-file')).toHaveText(
      'notes.txt',
    )
    await expect(page.getByTestId('git-pane-diff-untracked')).toContainText(
      'local notes',
    )
  })

  test('restores durable preview tabs and active selection after app relaunch', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /preview/i)

    await expect(page.getByTestId('preview-active-target')).toHaveText(
      'http://127.0.0.1:4173',
    )

    const targetInput = page.getByRole('textbox', { name: 'Preview target' })
    await targetInput.fill('localhost:3000')
    await page
      .getByRole('button', { name: 'Load preview', exact: true })
      .click()

    await expect(page.getByTestId('preview-active-target')).toHaveText(
      'http://localhost:3000',
    )
    const previewTabs = page.locator('[data-testid^="preview-target-"]')
    await expect(previewTabs).toHaveCount(2)

    await previewTabs.first().click()
    await expect(page.getByTestId('preview-active-target')).toHaveText(
      'http://127.0.0.1:4173',
    )

    await app.close()
    app = null

    const relaunched = await launchAideApp(
      {},
      { expectActivePane: true, tempDirectory: launched.tempDirectory },
    )
    app = relaunched.app

    await expect(
      relaunched.page.locator('[data-testid^="preview-target-"]'),
    ).toHaveCount(2)
    await expect(
      relaunched.page.getByTestId('preview-active-target'),
    ).toHaveText('http://127.0.0.1:4173')
  })

  test('runs configured setup once for new worktrees while root setup remains manual', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const setupMarkerName = '.aide-worktree-setup-cwd'
    const rootSetupMarker = path.join(chosenProjectRoot, setupMarkerName)
    const worktreePath = path.join(
      chosenProjectRoot,
      '.worktrees',
      'setup-workspace',
    )
    const worktreeSetupMarker = path.join(worktreePath, setupMarkerName)

    await importProject(page)
    await expandSidebar(page)

    await page.getByRole('button', { name: /more options for/i }).click()
    await page.getByRole('button', { name: 'Configure project setup' }).click()
    await expect(
      page.getByRole('heading', { name: 'Worktree setup' }),
    ).toBeVisible()
    await page
      .getByLabel('Project setup command')
      .fill(`printf '%s\\n' "$PWD" >> ${setupMarkerName}`)
    await page.getByRole('button', { name: 'Save setup' }).click()

    // The project root existed before setup was configured, so it remains
    // manual and has not received an implicit command execution.
    await expect(page.getByTestId('workspace-setup-status')).toContainText(
      'Setup required',
    )
    expect(existsSync(rootSetupMarker)).toBe(false)
    await page.getByRole('button', { name: 'Run setup' }).click()
    await expect.poll(() => existsSync(rootSetupMarker)).toBe(true)
    expect(readFileSync(rootSetupMarker, 'utf8').trim()).toBe(chosenProjectRoot)

    await createWorkspace(page, {
      branchName: 'setup-workspace',
      name: 'Setup workspace',
    })
    await expect.poll(() => existsSync(worktreeSetupMarker)).toBe(true)
    expect(readFileSync(worktreeSetupMarker, 'utf8').trim()).toBe(worktreePath)

    // The setup manager's persisted state survives a renderer reload; reload
    // must not cause another setup attempt or forget the successful result.
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Setup workspace',
    )
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const snapshots = await window.aide?.getWorkspaceSetupSnapshot()
          return Object.values(snapshots?.setupsByWorkspace ?? {}).find(
            (setup) => setup.state === 'succeeded',
          )?.state
        }),
      )
      .toBe('succeeded')
    expect(
      readFileSync(worktreeSetupMarker, 'utf8').trim().split('\n'),
    ).toEqual([worktreePath])

    await app.close()
    app = null

    const relaunched = await launchAideApp(
      {},
      { tempDirectory: launched.tempDirectory },
    )
    app = relaunched.app
    await expect(
      relaunched.page.getByTestId('active-workspace-name'),
    ).toHaveText('Setup workspace')
    await expect
      .poll(async () =>
        relaunched.page.evaluate(async () => {
          const snapshots = await window.aide?.getWorkspaceSetupSnapshot()
          return Object.values(snapshots?.setupsByWorkspace ?? {}).find(
            (setup) => setup.state === 'succeeded',
          )?.state
        }),
      )
      .toBe('succeeded')
    expect(
      readFileSync(worktreeSetupMarker, 'utf8').trim().split('\n'),
    ).toEqual([worktreePath])
  })

  test('opens a folder project without Git-only controls', async () => {
    const chosenProjectRoot = mkdtempSync(path.join(tmpdir(), 'aide-non-git-'))
    writeFileSync(path.join(chosenProjectRoot, 'notes.txt'), 'plain folder\n')
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      path.basename(chosenProjectRoot),
    )
    await expect(page.getByText('Folder project')).toBeVisible()
    expect(existsSync(path.join(chosenProjectRoot, '.git'))).toBe(false)

    const snapshot = await page.evaluate(() => window.aide.getStorageSnapshot())
    expect(snapshot.projects[0]?.kind).toBe('folder')
    const gitStatus = await page.evaluate(
      (workspaceId) => window.aide.getWorkspaceGitStatus(workspaceId),
      snapshot.workspaces[0]?.id ?? '',
    )
    expect(gitStatus).toEqual({
      code: 'not-a-git-worktree',
      error: 'Git actions are unavailable for folder projects.',
      ok: false,
    })

    await page.getByRole('button', { name: /add pane/i }).click()
    await expect(page.getByRole('button', { name: /^git/i })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /agent/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /terminal/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /editor/i })).toBeVisible()
    await page.getByRole('button', { name: /^terminal/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await expect(
      page.locator('.terminal-pane .xterm-helper-textarea').first(),
    ).toBeFocused()
    const file = await page.evaluate(
      (workspaceId) => window.aide.readProjectFile(workspaceId, 'notes.txt'),
      snapshot.workspaces[0]?.id ?? '',
    )
    expect(file.content).toBe('plain folder\n')
  })

  test('refocuses the terminal when returning to its pane', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await addPane(page, /git/i)

    const terminalPaneButton = page.getByRole('button', {
      name: /workspace terminal/i,
    })
    const gitPaneButton = page.getByRole('button', { name: /git review/i })

    await terminalPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await expect(
      page.locator(
        '.workspace-slide[data-active-workspace="true"] .terminal-pane .xterm-helper-textarea',
      ),
    ).toBeFocused()

    await gitPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await terminalPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await expect(
      page.locator(
        '.workspace-slide[data-active-workspace="true"] .terminal-pane .xterm-helper-textarea',
      ),
    ).toBeFocused()
  })

  test('closes terminal panes for zero and nonzero shell exits', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)

    const terminalInput = page.locator(
      '.workspace-slide[data-active-workspace="true"] .terminal-pane .xterm-helper-textarea',
    )
    await expect(terminalInput).toBeFocused()
    await page.keyboard.type('exit')
    await page.keyboard.press('Enter')

    await expect(
      page.locator('.workspace-strip .workspace-strip-item'),
    ).toHaveCount(1)
    await expect(page.getByText('Empty workspace')).toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText('')

    await addPane(page, /terminal/i)
    await expect(terminalInput).toBeFocused()
    await page.keyboard.type('exit 7')
    await page.keyboard.press('Enter')

    await expect(page.getByText('Empty workspace')).toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText('')
  })

  test('keeps the foreground selection when a background terminal exits', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await createWorkspace(page, {
      branchName: 'background-terminal',
      name: 'Foreground workspace',
    })
    await addPane(page, /git/i)

    await page.keyboard.press('Alt+k')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    const terminalInput = page.locator(
      '.workspace-slide[data-active-workspace="true"] .terminal-pane .xterm-helper-textarea',
    )
    await expect(terminalInput).toBeFocused()
    await page.keyboard.type('sleep 2; exit')
    await page.keyboard.press('Enter')

    await page.keyboard.press('Alt+j')
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Foreground workspace',
    )
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const snapshot = await window.aide.getStorageSnapshot()
            const backgroundWorkspace = snapshot.workspaces.find(
              (workspace) => workspace.name === 'main',
            )
            if (!backgroundWorkspace) return false

            return Object.values(snapshot.surfaceLayouts)
              .filter((layout) => layout.workspaceId === backgroundWorkspace.id)
              .every((layout) =>
                layout.nodes.every(
                  (node) =>
                    node.type !== 'pane' ||
                    node.viewIds.every(
                      (viewId) => !viewId.startsWith('terminal'),
                    ),
                ),
              )
          }),
        { timeout: 7_000 },
      )
      .toBe(true)

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'Foreground workspace',
    )
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
  })

  test('announces critical updates without opening or stealing focus', async () => {
    const launched = await launchAideApp({
      AIDE_FAKE_UPDATE_INITIAL_AVAILABLE: '1',
      AIDE_FAKE_UPDATE_SERVICE: '1',
      AIDE_FAKE_UPDATE_URGENCY: 'critical',
    })
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const diagnostics = page.getByRole('button', {
      name: /open diagnostics/i,
    })
    await diagnostics.focus()
    await expect(diagnostics).toBeFocused()

    const criticalAlert = page.getByRole('alert').filter({
      hasText: 'Critical update available',
    })
    await expect(criticalAlert).toBeVisible()
    await expect(diagnostics).toBeFocused()
    await expect(page.getByRole('dialog')).not.toBeVisible()

    const indicator = page.getByTestId('update-indicator')
    await indicator.click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(
      page.getByRole('button', { name: /snooze/i }),
    ).not.toBeVisible()

    await page
      .getByTestId('update-modal')
      .getByRole('button', { exact: true, name: 'Close' })
      .click()
    await expect(indicator).toBeFocused()
  })

  test('presents update lifecycle, progress, and controls accessibly', async () => {
    const launched = await launchAideApp({
      AIDE_FAKE_UPDATE_ACTIVE_MANAGED: '2',
      AIDE_FAKE_UPDATE_ACTIVE_SETUPS: '1',
      AIDE_FAKE_UPDATE_ACTIVE_TERMINALS: '1',
      AIDE_FAKE_UPDATE_CHECK_FAILURES: '1',
      AIDE_FAKE_UPDATE_DOWNLOAD_FAILURES: '1',
      AIDE_FAKE_UPDATE_SERVICE: '1',
    })
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const disclosureIndicator = page.getByTestId('update-indicator')
    await expect(disclosureIndicator).toContainText('Review update privacy')
    await disclosureIndicator.click()
    const modal = page.getByTestId('update-modal')
    await expect(modal).toBeVisible()
    const healthReporting = page.getByRole('switch', {
      name: 'Share privacy-bounded update health reports',
    })
    await expect(healthReporting).toBeDisabled()
    await expect(healthReporting).not.toBeChecked()
    await page
      .getByRole('button', {
        name: 'Acknowledge and enable health reporting',
      })
      .click()
    await expect(healthReporting).toBeEnabled()
    await expect(healthReporting).toBeChecked()
    await healthReporting.focus()
    await page.keyboard.press('Space')
    await expect(healthReporting).not.toBeChecked()

    await modal.getByRole('button', { exact: true, name: 'Close' }).click()
    await expect(disclosureIndicator).not.toBeVisible()

    await runPaletteCommand(page, 'Check for updates')
    await expect(modal).toContainText('Injected update check failure.')
    await modal.getByRole('button', { name: 'Check for updates' }).click()
    await expect(modal).toContainText('Update available')
    await expect(
      page.getByRole('button', { name: 'Snooze for 24 hours' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Snooze for 24 hours' }).click()
    await expect(modal).toContainText(/remaining/)
    await modal.getByRole('button', { exact: true, name: 'Close' }).click()

    await runPaletteCommand(page, 'Download update')
    await expect(
      page.getByRole('progressbar', { name: 'Update download progress' }),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Retry update' }),
    ).toBeVisible({ timeout: 5_000 })

    await page.getByRole('button', { name: 'Retry update' }).click()
    await expect(
      page.getByRole('button', { name: 'Download update' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Download update' }).click()
    await expect(
      page.getByRole('button', { name: 'Restart to update' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Restart to update' }).click()
    await expect(modal).toContainText('4 active tasks')
    await page
      .getByRole('button', { name: 'Restart and stop 4 active tasks' })
      .click()
    await expect(modal).toContainText('Restart requested')

    const nestedInteractiveCount = await modal.evaluate(
      (element) =>
        element.querySelectorAll(
          'button button, button a, button [role="button"], a button, [role="button"] button, [role="button"] [role="button"]',
        ).length,
    )
    expect(nestedInteractiveCount).toBe(0)

    await modal.getByRole('button', { exact: true, name: 'Close' }).click()
    await page.reload()
    await expect(disclosureIndicator).not.toContainText('Review update privacy')
    await runPaletteCommand(page, 'Software update settings')
    await expect(
      page.getByRole('switch', {
        name: 'Share privacy-bounded update health reports',
      }),
    ).not.toBeChecked()
    await expect(
      page.getByRole('button', {
        name: 'Withdraw approval and disable health reporting',
      }),
    ).toBeVisible()
  })

  test('recovers first-run update hydration without opening or stealing focus', async () => {
    const launched = await launchAideApp({
      AIDE_FAKE_UPDATE_SERVICE: '1',
      AIDE_FAKE_UPDATE_SNAPSHOT_FAILURES: '1',
    })
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const diagnostics = page.getByRole('button', {
      name: /open diagnostics/i,
    })
    await diagnostics.focus()
    await expect(diagnostics).toBeFocused()

    await expect(page.getByTestId('update-indicator')).toContainText(
      'Review update privacy',
    )
    await expect(diagnostics).toBeFocused()
    await expect(page.getByRole('dialog')).not.toBeVisible()
  })

  test('shows an empty workspace after closing the last pane and keeps it empty after reload', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp({
      AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
    })
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await importProject(page)
    await addPane(page, /terminal/i)
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )

    await page.getByLabel(/close pane/i).click()
    await expect(page.getByText('Empty workspace')).toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText('')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await expect(page.getByText('Empty workspace')).toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText('')
  })
})
