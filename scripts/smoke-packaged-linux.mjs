import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron } from '@playwright/test'
assert.ok(process.argv[2], 'Pass the packaged Linux executable path.')
const executablePath = path.resolve(process.argv[2])
const profile = mkdtempSync(path.join(tmpdir(), 'aide-packaged-smoke-'))
const repo = path.join(profile, 'repo')
execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
writeFileSync(path.join(repo, 'README.md'), '# Packaged smoke\n')
execFileSync('git', ['-C', repo, 'add', '.'])
execFileSync(
  'git',
  [
    '-C',
    repo,
    '-c',
    'user.name=Aide Smoke',
    '-c',
    'user.email=aide@example.test',
    'commit',
    '-m',
    'fixture',
  ],
  { stdio: 'ignore' },
)
const databasePath = path.join(profile, 'aide.sqlite3')
const env = {
  ...process.env,
  AIDE_DATABASE_PATH: databasePath,
  AIDE_SOFTWARE_RENDERING: '1',
  WAYLAND_DISPLAY: '',
  HYPRLAND_INSTANCE_SIGNATURE: '',
  SWAYSOCK: '',
  XDG_SESSION_TYPE: 'x11',
  ELECTRON_OZONE_PLATFORM_HINT: 'x11',
  OZONE_PLATFORM: 'x11',
}
delete env.TYPESAFE_API_KEY
delete env.AIDE_FAKE_MANAGED_PROVIDERS
delete env.AIDE_FAKE_UPDATE_SERVICE
let app
const launch = async () => {
  app = await electron.launch({ executablePath, args: [], env, timeout: 30000 })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => Boolean(window.aide))
  return page
}
const close = async () => {
  await app.close()
  app = null
}
const evidence = {
  executablePath,
  profile,
  packaged: false,
  offlineRenderer: false,
  projectRestart: false,
  singleInstance: false,
  nativePty: false,
  corruptionPreserved: false,
  restoredProject: false,
}
try {
  let page = await launch()
  evidence.packaged = await app.evaluate(({ app }) => app.isPackaged)
  assert.equal(evidence.packaged, true)
  const remoteRequests = []
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url())
  })
  await page.reload()
  await page.waitForFunction(() => Boolean(window.aide))
  await page.getByText('No project selected').waitFor()
  assert.deepEqual(remoteRequests, [])
  evidence.offlineRenderer = true
  await page.evaluate((repo) => window.aide.importProject(repo), repo)
  const before = await page.evaluate(() => window.aide.getStorageSnapshot())
  assert.equal(before.projects.length, 1)
  const workspace = before.workspaces[0]
  assert.ok(workspace)
  await page.evaluate(async (workspace) => {
    const sessionId = 'packaged-native-smoke'
    const done = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('No native PTY output')),
        10000,
      )
      const off = window.aide.onTerminalEvent((event) => {
        if (
          event.sessionId === sessionId &&
          event.type === 'data' &&
          event.data.includes('native-pty-ok')
        ) {
          clearTimeout(timeout)
          off()
          resolve()
        }
      })
    })
    await window.aide.createTerminalSession({
      sessionId,
      workspaceId: workspace.id,
      paneId: 'smoke',
      cwd: workspace.worktreePath,
      cols: 80,
      rows: 24,
      mode: 'shell',
    })
    await window.aide.writeTerminalInput(
      sessionId,
      "printf 'native-%s\\n' 'pty-ok'\n",
    )
    await done
    await window.aide.killTerminalSession(sessionId)
  }, workspace)
  evidence.nativePty = true
  await new Promise((resolve, reject) => {
    const second = spawn(executablePath, [], { env, stdio: 'ignore' })
    const timeout = setTimeout(() => {
      second.kill('SIGKILL')
      reject(new Error('Second app instance did not exit'))
    }, 10000)
    second.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    second.once('exit', (code) => {
      clearTimeout(timeout)
      code === 0
        ? resolve()
        : reject(new Error(`Second app instance exited ${code}`))
    })
  })
  assert.equal(page.isClosed(), false)
  evidence.singleInstance = true
  await close()
  page = await launch()
  const after = await page.evaluate(() => window.aide.getStorageSnapshot())
  assert.equal(after.projects[0].id, before.projects[0].id)
  assert.equal(after.workspaces[0].id, workspace.id)
  evidence.projectRestart = true
  await close()
  writeFileSync(databasePath, 'synthetic damaged database')
  page = await launch()
  await page.getByTestId('persisted-state-recovery').waitFor()
  assert.equal(readFileSync(databasePath, 'utf8'), 'synthetic damaged database')
  evidence.corruptionPreserved = true
  await page
    .getByRole('button', { name: 'Restore latest known-good backup' })
    .click()
  await page
    .getByTestId('persisted-state-recovery')
    .waitFor({ state: 'hidden' })
  const restored = await page.evaluate(() => window.aide.getStorageSnapshot())
  assert.equal(restored.projects[0].id, before.projects[0].id)
  evidence.restoredProject = true
  const backups = readdirSync(path.join(profile, 'recovery')).filter((name) =>
    name.includes('.damaged-'),
  )
  assert.ok(
    backups.some(
      (name) =>
        readFileSync(path.join(profile, 'recovery', name), 'utf8') ===
        'synthetic damaged database',
    ),
  )
  await page.screenshot({ path: path.join(profile, 'after-recovery.png') })
  console.log(JSON.stringify(evidence))
  writeFileSync(
    path.join(profile, 'verification.json'),
    `${JSON.stringify(evidence, null, 2)}\n`,
  )
} finally {
  if (app) await close()
}
