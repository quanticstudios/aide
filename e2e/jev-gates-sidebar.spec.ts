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
  const repository = mkdtempSync(path.join(tmpdir(), 'aide-jev-gates-e2e-'))
  runGit(repository, ['init', '-b', 'main'])
  writeFileSync(path.join(repository, 'README.md'), 'before\n')
  runGit(repository, ['add', 'README.md'])
  runGit(repository, ['commit', '-m', 'Initial'])
  return repository
}

async function launch(
  dataDirectory: string,
  repository: string,
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
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.setViewportSize({ width: 1280, height: 900 })
  return { app, page }
}

async function openSidebarGates(page: Page): Promise<void> {
  const sidebar = page.getByTestId('sidebar-shell')
  const toggle = page
    .getByTestId('sidebar-jev-gates')
    .getByRole('button', { name: 'Jev gates' })
  // why: after a relaunch the saved sidebar state lands after first paint, so a one-shot read can see it collapsed and then lose the button.
  await expect(async () => {
    if ((await sidebar.getAttribute('data-expanded')) !== 'true') {
      await page
        .getByRole('button', { name: 'Open sidebar' })
        .click({ timeout: 1_000 })
    }
    if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
      await toggle.click({ timeout: 1_000 })
    }
    await expect(sidebar).toHaveAttribute('data-expanded', 'true', {
      timeout: 1_000,
    })
    await expect(toggle).toHaveAttribute('aria-expanded', 'true', {
      timeout: 1_000,
    })
  }).toPass()
}

async function openProject(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: /open project/i })
    .last()
    .click()
  await expect(page.getByTestId('active-workspace-name')).toHaveText('main')
}

test.describe('Jev gates in the sidebar', () => {
  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null
  let repository: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    if (repository) rmSync(repository, { force: true, recursive: true })
  })

  test('turns gates on per workspace and keeps the choice after a relaunch', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-jev-gates-data-'))
    const launched = await launch(dataDirectory, repository)
    app = launched.app
    const { page } = launched

    await openProject(page)

    await openSidebarGates(page)
    const gates = page.getByTestId('sidebar-jev-gates')
    const laneRouting = gates
      .getByTestId('sidebar-jev-gate-laneRouting')
      .locator('label')
    await expect(gates).toContainText('0/3 on')
    await expect(gates.getByText('inherits global')).toHaveCount(3)

    await laneRouting.click()
    await expect(gates).toContainText('1/3 on')
    await gates
      .getByTestId('sidebar-jev-gate-completionCheck')
      .locator('label')
      .click()
    await gates
      .getByTestId('sidebar-jev-gate-toolGate')
      .locator('label')
      .click()
    await expect(gates).toContainText('3/3 on')
    await expect(gates.getByText('inherits global')).toHaveCount(0)

    await app.close()
    app = null

    const relaunched = await launch(dataDirectory, repository)
    app = relaunched.app
    await openSidebarGates(relaunched.page)
    const relaunchedGates = relaunched.page.getByTestId('sidebar-jev-gates')
    await expect(relaunchedGates).toContainText('3/3 on')
    await expect(
      relaunchedGates.getByRole('switch', { name: 'Lane routing' }),
    ).toBeChecked()
  })

  test('edits the global gate layer in Settings and lets a workspace override win', async () => {
    repository = createRepository()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-jev-gates-data-'))
    const launched = await launch(dataDirectory, repository)
    app = launched.app
    const { page } = launched

    await openProject(page)
    await openSidebarGates(page)
    const gates = page.getByTestId('sidebar-jev-gates')
    const laneRow = gates.getByTestId('sidebar-jev-gate-laneRouting')
    await expect(gates).toContainText('0/3 on')

    await page
      .getByRole('button', { name: 'Open settings', exact: true })
      .click()
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
    await settings
      .getByRole('navigation', { name: 'Settings categories' })
      .getByRole('button', { name: 'Jev gates', exact: true })
      .click()
    const globalLaneRouting = settings
      .getByTestId('settings-jev-gate-laneRouting')
      .getByRole('switch', { name: 'Lane routing' })
    await expect(globalLaneRouting).not.toBeChecked()
    await globalLaneRouting.press('Space')
    await expect(globalLaneRouting).toBeChecked()
    await settings.getByRole('button', { name: 'Back to app' }).click()

    await expect(gates).toContainText('1/3 on')
    await expect(gates.getByText('inherits global')).toHaveCount(3)

    await laneRow.locator('label').click()
    await expect(gates).toContainText('0/3 on')
    await expect(gates.getByText('inherits global')).toHaveCount(2)

    await laneRow.getByRole('button', { name: /Lane routing/ }).click()
    await laneRow.getByRole('button', { name: 'Reset to global' }).click()
    await expect(gates).toContainText('1/3 on')
    await expect(gates.getByText('inherits global')).toHaveCount(3)

    await gates
      .getByTestId('sidebar-jev-gate-toolGate')
      .locator('label')
      .click()
    await expect(gates).toContainText('2/3 on')

    await app.close()
    app = null

    const relaunched = await launch(dataDirectory, repository)
    app = relaunched.app
    await openSidebarGates(relaunched.page)
    const relaunchedGates = relaunched.page.getByTestId('sidebar-jev-gates')
    await expect(relaunchedGates).toContainText('2/3 on')
    await expect(
      relaunchedGates.getByRole('switch', { name: 'Lane routing' }),
    ).toBeChecked()
    await expect(
      relaunchedGates.getByRole('switch', { name: 'Tool call gate' }),
    ).toBeChecked()
    await expect(relaunchedGates.getByText('inherits global')).toHaveCount(2)
  })
})
