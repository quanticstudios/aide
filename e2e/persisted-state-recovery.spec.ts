import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test } from '@playwright/test'

const workspaceDir = path.resolve(import.meta.dirname, '..')

test('preserves corrupt saved data until an explicit reset', async () => {
  const profile = mkdtempSync(path.join(tmpdir(), 'aide-recovery-e2e-'))
  const databasePath = path.join(profile, 'aide.sqlite3')
  const damaged = 'synthetic damaged database'
  writeFileSync(databasePath, damaged)
  const app = await electron.launch({
    args: [workspaceDir, '--force-device-scale-factor=1'],
    executablePath: path.join(
      workspaceDir,
      'node_modules/electron/dist/electron',
    ),
    env: {
      ...process.env,
      AIDE_DATABASE_PATH: databasePath,
      AIDE_SOFTWARE_RENDERING: '1',
      WAYLAND_DISPLAY: '',
      HYPRLAND_INSTANCE_SIGNATURE: '',
      SWAYSOCK: '',
      XDG_SESSION_TYPE: 'x11',
      ELECTRON_OZONE_PLATFORM_HINT: 'x11',
      OZONE_PLATFORM: 'x11',
    },
  })
  try {
    const page = await app.firstWindow()
    await expect(page.getByTestId('persisted-state-recovery')).toBeVisible()
    expect(readFileSync(databasePath, 'utf8')).toBe(damaged)
    await expect(
      page.getByRole('button', { name: 'Restore latest known-good backup' }),
    ).toBeDisabled()
    await page.getByRole('button', { name: 'Reset saved data…' }).click()
    expect(readFileSync(databasePath, 'utf8')).toBe(damaged)
    await page.getByRole('button', { name: 'Cancel reset' }).click()
    expect(readFileSync(databasePath, 'utf8')).toBe(damaged)
    await page.getByRole('button', { name: 'Reset saved data…' }).click()
    await page
      .getByRole('button', { name: 'Reset and preserve damaged database' })
      .click()
    await expect(page.getByTestId('persisted-state-recovery')).not.toBeVisible()
    await expect(page.getByText('No project selected')).toBeVisible()
    const backups = readdirSync(path.join(profile, 'recovery')).filter((name) =>
      name.includes('.damaged-'),
    )
    expect(backups).toHaveLength(1)
    expect(
      readFileSync(path.join(profile, 'recovery', backups[0]), 'utf8'),
    ).toBe(damaged)
    const snapshot = await page.evaluate(() => window.aide.getStorageSnapshot())
    expect(snapshot.projects).toHaveLength(0)
  } finally {
    await app.close()
    rmSync(profile, { recursive: true, force: true })
  }
})
