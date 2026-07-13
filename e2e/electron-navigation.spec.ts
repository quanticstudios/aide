import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  type Page,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

const workspaceDir = '/home/pho7on/Work/aide'
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
  } = {},
): Promise<{
  app: ElectronApplication
  page: Page
  tempDirectory: string
}> {
  const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-electron-'))
  const app = await electron.launch({
    args: [workspaceDir],
    executablePath: path.join(
      workspaceDir,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      AIDE_DATABASE_PATH: path.join(tempDirectory, 'aide.sqlite3'),
      ...envOverrides,
      WAYLAND_DISPLAY: '',
      HYPRLAND_INSTANCE_SIGNATURE: '',
      SWAYSOCK: '',
      XDG_SESSION_TYPE: 'x11',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      OZONE_PLATFORM: 'x11',
      LIBGL_ALWAYS_SOFTWARE: '1',
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
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

async function addPane(page: Page, paneName: RegExp): Promise<void> {
  await page.getByRole('button', { name: /add pane/i }).click()
  await page.getByRole('button', { name: paneName }).click()
}

async function expandSidebar(page: Page): Promise<void> {
  await page.getByTestId('sidebar-shell').hover()
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
  await page.getByRole('button', { name: /new workspace/i }).click()
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

test.describe('electron spatial navigation', () => {
  let app: ElectronApplication | null = null
  let importedRepoRoot: string | null = null
  let tempDirectory: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    if (importedRepoRoot) {
      rmSync(importedRepoRoot, { force: true, recursive: true })
    }
    if (tempDirectory) {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
    app = null
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

    await importProject(page)

    await expect(
      page.locator('[data-testid^="project-rail-button-"]'),
    ).toHaveCount(1)
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
    const workspaceSidebarRow = page
      .getByTestId('workspace-tree-panel')
      .getByRole('button', { name: /main/i })

    const promptInput = page.getByRole('textbox', { name: /claude prompt/i })
    await promptInput.fill('input')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(
      page.getByRole('button', { name: /submit answer/i }),
    ).toBeVisible()
    await expect(workspaceSidebarRow.getByText('Agent Input')).toBeVisible()
    await page.getByRole('button', { name: /Continue the task/i }).click()
    await page.getByRole('button', { name: /submit answer/i }).click()
    await expect(
      page.getByRole('button', { name: /submit answer/i }),
    ).not.toBeVisible()

    await promptInput.fill('approval')
    await page.getByRole('button', { name: /send prompt/i }).click()
    await expect(workspaceSidebarRow.getByText('Agent Approval')).toBeVisible()
    await page.getByRole('button', { name: /allow once/i }).click()

    await promptInput.fill('ship it')
    await page.getByRole('button', { name: /send prompt/i }).click()
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

  test('stores multiple preview targets per workspace and switches the active target', async () => {
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
    await page.getByRole('button', { name: /load preview/i }).click()

    await expect(page.getByTestId('preview-active-target')).toHaveText(
      'http://localhost:3000',
    )
    await expect(
      page.getByTestId('preview-target-preview:http://127.0.0.1:4173'),
    ).toBeVisible()
    await expect(
      page.getByTestId('preview-target-preview:http://localhost:3000'),
    ).toBeVisible()

    await page
      .getByTestId('preview-target-preview:http://127.0.0.1:4173')
      .click()
    await expect(page.getByTestId('preview-active-target')).toHaveText(
      'http://127.0.0.1:4173',
    )
  })

  test('shows an inline error when the chosen folder is not a git repo', async () => {
    const chosenProjectRoot = mkdtempSync(path.join(tmpdir(), 'aide-non-git-'))
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

    await expect(
      page.getByText('Selected folder is not inside a Git repository.'),
    ).toBeVisible()
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

  test('keeps a terminal pane after shell exit and can restart it', async () => {
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
      page.getByRole('button', { name: /restart terminal/i }),
    ).toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )

    await page.getByRole('button', { name: /restart terminal/i }).click()
    await expect(
      page.getByRole('button', { name: /restart terminal/i }),
    ).not.toBeVisible()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
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
