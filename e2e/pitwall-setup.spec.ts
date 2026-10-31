import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  type ElectronApplication,
  _electron as electron,
  expect,
  test,
} from '@playwright/test'

const workspaceDirectory = path.resolve(import.meta.dirname, '..')

// shortcut: checks main's answer over IPC, not the card on screen, because no setting turns the daemon transport on yet; render the card here once ENG-2703 adds one.
test.describe('finding pitwall', () => {
  let app: ElectronApplication | null = null
  let root: string | null = null

  test.afterEach(async () => {
    await app?.close().catch(() => undefined)
    if (root) rmSync(root, { force: true, recursive: true })
  })

  /** Launches aide with a temp HOME, state and runtime folder, so the user's pitwall is never found or touched. */
  async function findPitwall(fakeVersion: string | null): Promise<unknown> {
    root = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-e2e-'))
    const bin = path.join(root, 'bin')
    mkdirSync(bin)
    if (fakeVersion) {
      const script = path.join(bin, 'pitwall')
      writeFileSync(script, `#!/bin/sh\necho "pitwall ${fakeVersion}"\n`)
      chmodSync(script, 0o755)
    }
    app = await electron.launch({
      args: [workspaceDirectory, '--force-device-scale-factor=1'],
      executablePath: path.join(
        workspaceDirectory,
        'node_modules/electron/dist/electron',
      ),
      env: {
        ...process.env,
        AIDE_DATABASE_PATH: path.join(root, 'aide.sqlite3'),
        AIDE_SOFTWARE_RENDERING: '1',
        ELECTRON_OZONE_PLATFORM_HINT: 'x11',
        HOME: root,
        HYPRLAND_INSTANCE_SIGNATURE: '',
        OZONE_PLATFORM: 'x11',
        PATH: `${bin}:/usr/bin:/bin`,
        SWAYSOCK: '',
        WAYLAND_DISPLAY: '',
        XDG_RUNTIME_DIR: path.join(root, 'run'),
        XDG_SESSION_TYPE: 'x11',
        XDG_STATE_HOME: path.join(root, 'state'),
      },
    })
    const page = await app.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    return page.evaluate(() => window.aide.getPitwallEndpoint())
  }

  test('reports a missing pitwall', async () => {
    expect(await findPitwall(null)).toEqual({
      status: 'missing',
      platform: process.platform,
    })
  })

  test('reports a pitwall too old for the web protocol', async () => {
    expect(await findPitwall('v0.1.6')).toEqual({
      status: 'outdated',
      required: '0.1.7',
      version: 'v0.1.6',
    })
  })
})
