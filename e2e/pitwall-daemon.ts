import { type ChildProcess, spawn } from 'node:child_process'
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
 * @remarks The daemon gets fresh config, state and runtime folders, `PITWALL_FAKE_PROVIDERS=1` and a fake `gh`, so it never meets the user's daemon, runs an agent or calls GitHub. Without the variable the suite runs on the built-in backend as before.
 */
export default async function globalSetup(): Promise<
  (() => Promise<void>) | undefined
> {
  const binary = process.env.AIDE_E2E_PITWALL
  if (!binary) return undefined
  // why: os.tmpdir() keeps the socket path under the 108-byte limit of a Unix socket.
  const root = mkdtempSync(path.join(tmpdir(), 'aide-pitwall-'))
  const folders = {
    XDG_CONFIG_HOME: path.join(root, 'config'),
    XDG_RUNTIME_DIR: path.join(root, 'run'),
    XDG_STATE_HOME: path.join(root, 'state'),
  }
  mkdirSync(path.join(folders.XDG_CONFIG_HOME, 'pitwall'), { recursive: true })
  mkdirSync(folders.XDG_RUNTIME_DIR, { mode: 0o700 })
  mkdirSync(folders.XDG_STATE_HOME)
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
    env: {
      ...process.env,
      ...folders,
      // why: e2e/fake-gh/gh answers the daemon's PR poll from a spec's fixtures instead of GitHub.
      PATH: `${path.join(import.meta.dirname, 'fake-gh')}${path.delimiter}${process.env.PATH}`,
      PITWALL_FAKE_PROVIDERS: '1',
    },
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
  process.env.PITWALL_SOCKET = path.join(
    folders.XDG_RUNTIME_DIR,
    'pitwall',
    'pitwall.sock',
  )
  return async () => {
    // why: the daemon saves its state as it exits, so removing its folder before then fails with ENOTEMPTY.
    const exited = new Promise((resolve) => daemon.once('exit', resolve))
    daemon.kill()
    if (daemon.exitCode === null) await exited
    rmSync(root, { force: true, recursive: true })
  }
}
