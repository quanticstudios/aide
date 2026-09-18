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

function runGit(repository: string, arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd: repository,
    encoding: 'utf8',
    env: gitEnvironment,
  }).trim()
}

function createGitRepository(): string {
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-navigation-repo-'))

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

async function launchAideApp(repository: string): Promise<{
  app: ElectronApplication
  dataDirectory: string
  page: Page
}> {
  const dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-navigation-'))
  const app = await electron.launch({
    args: [workspaceDirectory, '--force-device-scale-factor=1'],
    executablePath: path.join(
      workspaceDirectory,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      AIDE_DATABASE_PATH: path.join(dataDirectory, 'aide.sqlite3'),
      AIDE_SOFTWARE_RENDERING: '1',
      AIDE_TEST_PROJECT_PICK_PATH: repository,
    },
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')

  return { app, dataDirectory, page }
}

async function importProject(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
}

async function addPane(page: Page, paneName: RegExp): Promise<void> {
  await page.getByRole('button', { name: /add pane/i }).click()
  await page
    .getByRole('dialog', { name: 'Add pane' })
    .getByRole('button', { name: paneName })
    .click()
}

async function createWorkspace(
  page: Page,
  name: string,
  branchName: string,
): Promise<void> {
  if (
    (await page.getByTestId('sidebar-shell').getAttribute('data-expanded')) !==
    'true'
  ) {
    await page
      .getByRole('button', { name: 'Open sidebar', exact: true })
      .click()
  }
  await page
    .getByRole('button', { name: /new workspace/i })
    .last()
    .click()
  await page.getByLabel('Workspace name').fill(name)
  await page.getByLabel('Branch name').fill(branchName)
  await page
    .getByRole('button', { name: /create workspace/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText(name)
}

async function expectPaneOrder(page: Page, labels: string[]): Promise<void> {
  await expect
    .poll(async () => {
      const paneLabels = await page
        .locator('.workspace-strip .workspace-strip-item')
        .allTextContents()
      return paneLabels.map((label) => label.replace(/^\d+/, ''))
    })
    .toEqual(labels)
}

async function waitForWorkspaceSurfaces(
  page: Page,
  workspaceName: string,
  surfaceCount: number,
): Promise<void> {
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ name }) => {
          const snapshot = await window.aide.getStorageSnapshot()
          const workspace = snapshot.workspaces.find(
            (candidate) => candidate.name === name,
          )
          return workspace
            ? (snapshot.workspaceSurfaces[workspace.id]?.length ?? 0)
            : 0
        },
        { name: workspaceName },
      ),
    )
    .toBe(surfaceCount)
}

async function getRememberedSurfaceTitles(
  page: Page,
): Promise<Record<string, string | null>> {
  return page.evaluate(async () => {
    const snapshot = await window.aide.getStorageSnapshot()
    return Object.fromEntries(
      snapshot.workspaces.map((workspace) => {
        const surfaceId = snapshot.lastActiveSurfaceIdsByWorkspace[workspace.id]
        const surface = (snapshot.workspaceSurfaces[workspace.id] ?? []).find(
          (candidate) => candidate.id === surfaceId,
        )
        return [workspace.name, surface?.title ?? null]
      }),
    )
  })
}

test('keeps workspace rows and pane positions stable through interrupted Alt navigation', async () => {
  const repository = createGitRepository()
  const launched = await launchAideApp(repository)

  try {
    const { page } = launched
    await importProject(page)
    await addPane(page, /terminal/i)
    await addPane(page, /git/i)
    await waitForWorkspaceSurfaces(page, 'main', 2)
    await expectPaneOrder(page, ['Workspace terminal', 'Git review'])
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expect
      .poll(() => getRememberedSurfaceTitles(page))
      .toEqual({
        main: 'Git review',
      })

    await createWorkspace(page, 'Workspace 2', 'workspace-2')
    await addPane(page, /terminal/i)
    await addPane(page, /git/i)
    await waitForWorkspaceSurfaces(page, 'Workspace 2', 2)
    await expectPaneOrder(page, ['Workspace terminal', 'Git review'])
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expect
      .poll(() => getRememberedSurfaceTitles(page))
      .toEqual({
        main: 'Git review',
        'Workspace 2': 'Git review',
      })

    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expectPaneOrder(page, ['Workspace terminal', 'Git review'])

    await page.keyboard.press('Alt+ArrowDown')
    await page.keyboard.press('Alt+ArrowUp')
    await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
    await expect(page.getByTestId('active-pane-name')).toHaveText('Git review')
    await expectPaneOrder(page, ['Workspace terminal', 'Git review'])

    const transitions = await page
      .locator('.workspace-slider, .surface-slider')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          className: element.className,
          transitionProperty: getComputedStyle(element).transitionProperty,
        })),
      )
    expect(transitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          className: expect.stringContaining('ease-[var(--ease-out-strong)]'),
          transitionProperty: expect.stringContaining('transform'),
        }),
      ]),
    )
    const dotMotion = await page
      .locator('[data-testid^="workspace-stack-dot-"]')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          height: (element as HTMLElement).style.height,
          transitionProperty: getComputedStyle(element).transitionProperty,
          width: (element as HTMLElement).style.width,
        })),
      )
    expect(dotMotion).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          height: '',
          transitionProperty: expect.stringContaining('transform'),
          width: '',
        }),
      ]),
    )
  } finally {
    await launched.app.close().catch(() => {})
    rmSync(launched.dataDirectory, { force: true, recursive: true })
    rmSync(repository, { force: true, recursive: true })
  }
})
