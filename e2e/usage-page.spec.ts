import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
const pitwall = process.env.AIDE_E2E_PITWALL
const pitwallHome = process.env.AIDE_E2E_PITWALL_HOME
const pitwallConfig = path.join(
  process.env.AIDE_E2E_PITWALL_CONFIG ?? '',
  'pitwall',
  'config.toml',
)

/** Two Claude sessions and a statusline limit report, dated from now, where the e2e daemon reads them. */
function writeUsageFixture(): void {
  const now = Date.now()
  const at = (ms: number) => new Date(now - ms).toISOString()
  const call = (id: string, ms: number, input: number, output: number) =>
    JSON.stringify({
      message: {
        id,
        model: 'claude-opus-5-5',
        usage: { input_tokens: input, output_tokens: output },
      },
      requestId: `req_${id}`,
      timestamp: at(ms),
      type: 'assistant',
    })
  const project = path.join(
    pitwallHome as string,
    '.claude',
    'projects',
    '-tmp-usage',
  )
  mkdirSync(project, { recursive: true })
  // Opus 5.5 at $4 in and $20 out per million: $14 and $4.
  writeFileSync(
    path.join(project, 'aaaa1111-session.jsonl'),
    `${call('m1', 60_000, 1_000_000, 500_000)}\n`,
  )
  writeFileSync(
    path.join(project, 'bbbb2222-session.jsonl'),
    `${call('m2', 3 * 86_400_000, 0, 200_000)}\n`,
  )
  writeFileSync(
    path.join(
      process.env.XDG_STATE_HOME as string,
      'pitwall',
      'claude-limits.json',
    ),
    JSON.stringify({
      provider: 'claude',
      seen: at(60_000),
      windows: [
        { minutes: 300, used: 42, resets: at(-2 * 3_600_000) },
        { minutes: 10_080, used: 85, resets: at(-3 * 86_400_000) },
      ],
    }),
  )
}

async function openUsage(page: Page) {
  const openSidebar = page.getByRole('button', { name: 'Open sidebar' })
  if (await openSidebar.isVisible()) await openSidebar.click()
  await page.getByRole('button', { name: 'Open settings', exact: true }).click()
  const settings = page.getByRole('dialog', { name: 'Settings', exact: true })
  await settings.getByRole('button', { name: 'Usage', exact: true }).click()
  return settings.locator('#usage-settings')
}

// The daemon-backend CI job sets AIDE_E2E_PITWALL; e2e/pitwall-daemon.ts starts the daemon this spec reads usage from.
test.describe('usage page', () => {
  test.skip(
    !pitwall || !pitwallHome,
    'needs AIDE_E2E_PITWALL, a pitwall binary',
  )

  let app: ElectronApplication | null = null
  let dataDirectory: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (dataDirectory) rmSync(dataDirectory, { force: true, recursive: true })
    writeFileSync(pitwallConfig, '[web]\nenabled = true\n')
  })

  test("shows pitwall's limits, daily tokens and top sessions, with cost only when show_cost is on", async () => {
    writeUsageFixture()
    dataDirectory = mkdtempSync(path.join(tmpdir(), 'aide-usage-e2e-data-'))
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
        AIDE_SESSION_BACKEND: 'pitwall',
        AIDE_SOFTWARE_RENDERING: '1',
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        SWAYSOCK: '',
        WAYLAND_DISPLAY: '',
        XDG_SESSION_TYPE: 'x11',
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')

    let usage = await openUsage(page)
    const limit = usage.getByTestId('usage-limit')
    await expect(limit).toContainText('Claude Code')
    await expect(limit).toContainText('5-hour window')
    await expect(limit).toContainText('42%')
    await expect(limit).toContainText('Weekly window')
    await expect(limit).toContainText('85%')
    await expect(
      usage.getByRole('meter', { name: 'Claude Code, 5-hour window' }),
    ).toHaveAttribute('aria-valuenow', '42')
    await expect(limit).toContainText(/Resets in 1h 59m|Resets in 2h 0m/)
    await expect(usage.getByTestId('usage-day')).toHaveCount(30)
    await expect(usage.getByTestId('usage-total')).toHaveText(
      '1.7M tokens in 2 sessions',
    )
    const sessions = usage.getByTestId('usage-session')
    await expect(sessions).toHaveCount(2)
    await expect(sessions.first()).toContainText('aaaa1111')
    await expect(sessions.first()).toContainText('1.5M')
    await expect(usage).not.toContainText('$')

    writeFileSync(
      pitwallConfig,
      '[web]\nenabled = true\n\n[usage]\nshow_cost = true\n',
    )
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('button', { name: 'Back to app' })
      .click()
    usage = await openUsage(page)
    await expect(usage.getByTestId('usage-total')).toContainText(
      "1.7M tokens in 2 sessions · $18.00 estimated at the API's list prices of",
    )
    await expect(sessions.first()).toContainText('$14.00')
    await expect(usage.getByTestId('usage-day').last()).toHaveAttribute(
      'aria-label',
      /: 1\.5M tokens · \$14\.00$/,
    )
  })
})
