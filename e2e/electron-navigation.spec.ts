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
      AIDE_USE_NAVIGATION_POC: '1',
      ...envOverrides,
      LIBGL_ALWAYS_SOFTWARE: '1',
      MESA_LOADER_DRIVER_OVERRIDE: 'llvmpipe',
    },
  })

  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  if (options.expectActivePane !== false) {
    await expect(page.getByTestId('active-pane-name')).toBeVisible()
  }

  return { app, page, tempDirectory }
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

  test('can reach pane 4 and 5 in Electron', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await page.getByRole('button', { name: /editor inspect/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Editor inspect',
    )

    await page.getByRole('button', { name: /preview target/i }).click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Preview target',
    )
  })

  test('moves panes horizontally with Alt+Left and Alt+Right', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Chat task thread',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

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
  })

  test('moves workspaces vertically with Alt+j and Alt+k', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('j')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'agent-review',
    )

    await page.keyboard.down('Alt')
    await page.keyboard.press('k')
    await page.keyboard.up('Alt')

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )
  })

  test('opens overview with Ctrl+Tab and jumps to another workspace', async () => {
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const overview = page.locator(
      '[data-testid="workspace-switcher-overlay"][data-mode="overview"]',
    )

    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'navigation-poc',
    )

    await page.keyboard.down('Control')
    await page.keyboard.press('Tab')
    await page.keyboard.up('Control')

    await expect(overview).toBeVisible()
    await expect(overview.getByText('Overview')).toBeVisible()
    await expect(overview.getByText('Current')).toBeVisible()
    const checkoutWorkspace = overview.getByRole('option', {
      name: /checkout-redesign/i,
    })
    await expect(checkoutWorkspace).toBeVisible()
    await expect(checkoutWorkspace.getByText('storefront')).toBeVisible()

    await checkoutWorkspace.click()

    await expect(overview).not.toBeVisible()
    await expect(page.getByTestId('active-workspace-name')).toHaveText(
      'checkout-redesign',
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

    await page.getByLabel('aide').focus()
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.getByRole('button', { name: /pin sidebar open/i }).click()
    await page.mouse.move(1400, 120)
    await page.waitForTimeout(180)
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')

    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    await expect(workspaceTree).toHaveAttribute('data-expanded', 'true')
  })

  test('can open a git project from the empty state', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp(
      {
        AIDE_USE_NAVIGATION_POC: '0',
        AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
      },
      { expectActivePane: false },
    )
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await expect(page.getByText('No project selected')).toBeVisible()
    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()

    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await expect(
      page.locator('[data-testid^="project-rail-button-"]'),
    ).toHaveCount(1)
  })

  test('renders a real git pane and updates the review surface on file selection', async () => {
    const chosenProjectRoot = createGitRepository()
    const readmePath = path.join(chosenProjectRoot, 'README.md')
    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}staged\n`)
    runGit(chosenProjectRoot, ['add', 'README.md'])
    writeFileSync(readmePath, `${readFileSync(readmePath, 'utf8')}unstaged\n`)
    writeFileSync(path.join(chosenProjectRoot, 'notes.txt'), 'local notes\n')

    const launched = await launchAideApp(
      {
        AIDE_USE_NAVIGATION_POC: '0',
        AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
      },
      { expectActivePane: false },
    )
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()

    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /git/i }).click()

    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expect(page.getByTestId('git-pane')).toBeVisible()
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'README.md',
    )
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'notes.txt',
    )
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'Staged: Modified',
    )
    await expect(page.getByTestId('git-pane-file-list')).toContainText(
      'Unstaged: Untracked',
    )

    await page.getByTestId('git-pane-file-README.md').click()
    await expect(page.getByTestId('git-pane-selected-file')).toHaveText(
      'README.md',
    )
    await expect(page.getByTestId('git-pane-diff-staged')).toContainText(
      '+++ b/README.md',
    )
    await expect(page.getByTestId('git-pane-diff-unstaged')).toContainText(
      '+++ b/README.md',
    )

    await page.getByTestId('git-pane-file-notes.txt').click()
    await expect(page.getByTestId('git-pane-selected-file')).toHaveText(
      'notes.txt',
    )
    await expect(page.getByTestId('git-pane-diff-untracked')).toContainText(
      '+++ b/notes.txt',
    )
  })

  test('stores multiple preview targets per workspace and switches the active target', async () => {
    const chosenProjectRoot = createGitRepository()
    const launched = await launchAideApp(
      {
        AIDE_USE_NAVIGATION_POC: '0',
        AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
      },
      { expectActivePane: false },
    )
    app = launched.app
    importedRepoRoot = chosenProjectRoot
    tempDirectory = launched.tempDirectory

    const { page } = launched

    await page
      .getByRole('button', { name: /open project/i })
      .last()
      .click()

    await page.getByRole('button', { name: /add pane/i }).click()
    await page.getByRole('button', { name: /preview/i }).click()

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
    const launched = await launchAideApp(
      {
        AIDE_USE_NAVIGATION_POC: '0',
        AIDE_TEST_PROJECT_PICK_PATH: chosenProjectRoot,
      },
      { expectActivePane: false },
    )
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
    const launched = await launchAideApp()
    app = launched.app
    tempDirectory = launched.tempDirectory

    const { page } = launched
    const terminalPaneButton = page.getByRole('button', {
      name: /workspace terminal/i,
    })
    const gitPaneButton = page.getByRole('button', { name: /git review/i })

    await terminalPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await expect(
      page.locator('.terminal-pane .xterm-helper-textarea'),
    ).toBeFocused()

    await gitPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')

    await terminalPaneButton.click()
    await expect(page.getByTestId('active-pane-name')).toHaveText(
      'Workspace terminal',
    )
    await expect(
      page.locator('.terminal-pane .xterm-helper-textarea'),
    ).toBeFocused()
  })
})
