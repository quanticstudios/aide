import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * Starts a pitwall daemon of its own when `AIDE_E2E_PITWALL` names a pitwall binary, and points every spec's aide at it.
 * @remarks The daemon gets fresh config, state, runtime and home folders and `PITWALL_FAKE_PROVIDERS=1`, so it never meets the user's daemon, runs an agent or reads the user's session files. Without the variable the suite runs on the built-in backend as before.
 */
export default async function globalSetup(): Promise<(() => void) | undefined> {
  const binary = process.env.AIDE_E2E_PITWALL
  if (!binary) return undefined
  // why: os.tmpdir() keeps the socket path under the 108-byte limit of a Unix socket.
  const root = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-'))
  const folders = {
    HOME: path.join(root, 'home'),
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_RUNTIME_DIR: path.join(root, 'run'),
    XDG_STATE_HOME: path.join(root, 'state'),
  }
  mkdirSync(path.join(folders.XDG_CONFIG_HOME, 'pitwall'), { recursive: true })
  mkdirSync(folders.XDG_RUNTIME_DIR, { mode: 0o700 })
  mkdirSync(folders.XDG_STATE_HOME)
  mkdirSync(folders.HOME)
  writeFileSync(
    path.join(folders.XDG_CONFIG_HOME, 'pitwall', 'config.toml'),
    '[web]\nenabled = true\n',
  )
  // why: a pitwall pane's PITWALL_SOCKET would send the CLI to the user's daemon.
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('PITWALL_')) delete process.env[name]
  }
  const log = openSync(path.join(root, 'daemon.log'), 'a')
  const daemon: ChildProcess = spawn(path.resolve(binary), ['daemon'], {
    env: { ...process.env, ...folders, PITWALL_FAKE_PROVIDERS: '1' },
    stdio: ['ignore', log, log],
  })
  const webFile = path.join(folders.XDG_STATE_HOME, 'pitwall', 'web.json')
  const deadline = Date.now() + 15_000
  while (!existsSync(webFile)) {
    if (daemon.exitCode !== null || Date.now() > deadline) {
      daemon.kill()
      throw new Error(
        `pitwall daemon did not write ${webFile}; see ${root}/daemon.log`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  // Specs spread process.env into Electron's env, so these reach every aide they launch.
  process.env.AIDE_SESSION_BACKEND = 'pitwall'
  process.env.XDG_STATE_HOME = folders.XDG_STATE_HOME
  // Where e2e/usage-page.spec.ts writes the session files and config the daemon's readUsage reads.
  process.env.AIDE_E2E_PITWALL_HOME = folders.HOME
  process.env.AIDE_E2E_PITWALL_CONFIG = folders.XDG_CONFIG_HOME
  process.env.PITWALL_SOCKET = path.join(
    folders.XDG_RUNTIME_DIR,
    'pitwall',
    'pitwall.sock',
  )
  return async () => {
    // why: the daemon writes its state as it exits, which races a removal started before then.
    const exited = once(daemon, 'exit')
    daemon.kill()
    if (daemon.exitCode === null && daemon.signalCode === null) await exited
    rmSync(root, { force: true, recursive: true })
  }
}
