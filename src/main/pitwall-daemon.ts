import { execFile, type StdioOptions, spawn } from 'node:child_process'
import { closeSync, fstatSync, openSync, readdirSync } from 'node:fs'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import TOML from '@iarna/toml'
import type { PitwallStatus } from '../shared/ipc'
import { resolveExecutablePath } from './executable-resolution'
import {
  getPitwallStateDir,
  isRunning,
  readPitwallEndpoint,
} from './pitwall-endpoint'

const execFileAsync = promisify(execFile)

/** The first pitwall release with the web protocol aide speaks; v0.1.6 is the last one without it. */
export const PITWALL_MIN_VERSION = '0.1.7'

export interface FindPitwallOptions {
  readonly env: NodeJS.ProcessEnv
  readonly platform: NodeJS.Platform
  readonly home: string
  /** Where pitwall's installers put it, for an aide started outside a shell that has them on PATH. */
  readonly installPaths?: readonly string[]
  readonly timeoutMs?: number
}

/** Where pitwall's install script, Homebrew and Scoop put the binary. */
export function getPitwallInstallPaths(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string[] {
  if (platform === 'win32') {
    return [
      ...(env.LOCALAPPDATA
        ? [path.join(env.LOCALAPPDATA, 'pitwall', 'bin', 'pitwall.exe')]
        : []),
      path.join(home, 'scoop', 'shims', 'pitwall.exe'),
    ]
  }
  return [
    path.join(home, '.local', 'bin', 'pitwall'),
    '/opt/homebrew/bin/pitwall',
    '/usr/local/bin/pitwall',
    '/home/linuxbrew/.linuxbrew/bin/pitwall',
  ]
}

/** Whether `pitwall --version` names a release before the web protocol; a build it cannot read, such as `dev`, passes and the handshake decides. */
export function isPitwallTooOld(versionOutput: string): boolean {
  const match = /\bv?(\d+)\.(\d+)\.(\d+)(-\d+-g[0-9a-f]+)?/.exec(versionOutput)
  if (!match) return false
  const found = [Number(match[1]), Number(match[2]), Number(match[3])]
  const needed = PITWALL_MIN_VERSION.split('.').map(Number)
  // A `git describe` build past a tag (v0.1.6-3-gabc) is newer than that tag.
  if (match[4]) found[2] += 1
  for (let index = 0; index < 3; index += 1) {
    if (found[index] !== needed[index]) return found[index] < needed[index]
  }
  return false
}

async function resolvePitwall(
  options: FindPitwallOptions,
): Promise<string | null> {
  const installPaths =
    options.installPaths ??
    getPitwallInstallPaths(options.env, options.platform, options.home)
  for (const candidate of ['pitwall', ...installPaths]) {
    try {
      return await resolveExecutablePath(candidate, { env: options.env })
    } catch {}
  }
  return null
}

/** Whether a daemon holds pitwall's socket lock, which names its pid; the folder is `proto.SocketPath`'s. */
async function isDaemonRunning(options: FindPitwallOptions): Promise<boolean> {
  const { env, home, platform } = options
  const dir = env.XDG_RUNTIME_DIR
    ? path.join(env.XDG_RUNTIME_DIR, 'pitwall')
    : platform === 'win32'
      ? path.join(
          env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local'),
          'pitwall',
        )
      : `/tmp/pitwall-${process.getuid?.()}`
  try {
    const pid = await readFile(path.join(dir, 'pitwall.sock.lock'), 'utf8')
    return isRunning(Number(pid))
  } catch {
    return false
  }
}

/**
 * The daemon's stdio: its output to `log`, and /dev/null over every other descriptor aide has open.
 * @remarks Electron leaves some descriptors without close-on-exec, DevTools' port and Chromium's locks among them, and a detached daemon would keep them after aide quits. Windows passes only the handles it is given.
 */
function daemonStdio(log: number): {
  devNull: number | null
  stdio: StdioOptions
} {
  const stdio: (number | 'ignore')[] = ['ignore', log, log]
  if (process.platform === 'win32') return { devNull: null, stdio }
  let open: number[] = []
  for (const dir of ['/proc/self/fd', '/dev/fd']) {
    try {
      open = readdirSync(dir).map(Number)
      break
    } catch {}
  }
  const devNull = openSync('/dev/null', 'r+')
  for (const fd of open) if (fd > 2) stdio[fd] = devNull
  return { devNull, stdio: Array.from(stdio, (entry) => entry ?? 'ignore') }
}

/**
 * Starts `pitwall daemon` detached, its output in pitwall's crash.log as pitwall's own window does it.
 * @returns A promise of the reason the daemon gave if it fails within its first seconds; it never settles otherwise.
 */
async function startDaemon(
  bin: string,
  env: NodeJS.ProcessEnv,
  stateDir: string,
): Promise<string> {
  const log = path.join(stateDir, 'crash.log')
  await mkdir(stateDir, { recursive: true })
  const logFd = openSync(log, 'a')
  const start = fstatSync(logFd).size
  const { devNull, stdio } = daemonStdio(logFd)
  let failed: (reason: string) => void = () => undefined
  const failure = new Promise<string>((resolve) => {
    failed = resolve
  })
  try {
    const daemon = spawn(bin, ['daemon'], {
      detached: true,
      env,
      stdio,
      windowsHide: true,
    })
    daemon.on('error', (error) => failed(error.message))
    // why: an exit 0 is a daemon that lost the socket lock to another starting one, which publishes the endpoint.
    daemon.on('exit', async (code, signal) => {
      if (code === 0) return
      const output = await readFile(log, 'utf8').catch(() => '')
      const reason = output
        .slice(start)
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .at(-1)
      failed(
        reason?.replace(/^pitwall:\s*/, '') ??
          `pitwall daemon exited with ${signal ?? `code ${code}`}`,
      )
    })
    daemon.unref()
  } finally {
    closeSync(logFd)
    if (devNull !== null) closeSync(devNull)
  }
  return failure
}

/** Polls `web.json` until it names a live daemon, or for `timeoutMs`. */
async function waitForEndpoint(file: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const endpoint = await readPitwallEndpoint(file)
    if (endpoint) return endpoint
  }
  return null
}

/**
 * Finds pitwall's daemon, starting it when none publishes a live endpoint.
 * @remarks Starts `pitwall daemon` detached, as pitwall's own window does, only when no daemon holds the socket lock, and never stops one.
 */
export async function findPitwall(
  options: FindPitwallOptions,
): Promise<PitwallStatus> {
  const stateDir = getPitwallStateDir(
    options.env,
    options.platform,
    options.home,
  )
  const file = path.join(stateDir, 'web.json')
  const running = await readPitwallEndpoint(file)
  if (running) return { status: 'ready', endpoint: running }

  const bin = await resolvePitwall(options)
  if (!bin) return { status: 'missing', platform: options.platform }
  const { stdout } = await execFileAsync(bin, ['--version'], {
    env: options.env,
    timeout: 5000,
  }).catch(() => ({ stdout: '' }))
  if (isPitwallTooOld(stdout)) {
    return {
      status: 'outdated',
      required: PITWALL_MIN_VERSION,
      version: stdout.trim().replace(/^pitwall\s+/, ''),
    }
  }

  if (await isDaemonRunning(options)) return { status: 'noEndpoint' }
  const found = await Promise.race([
    startDaemon(bin, options.env, stateDir).then((reason) => ({ reason })),
    waitForEndpoint(file, options.timeoutMs ?? 5000).then((endpoint) => ({
      endpoint,
    })),
  ])
  if ('reason' in found) {
    return {
      status: 'failed',
      log: path.join(stateDir, 'crash.log'),
      reason: found.reason,
    }
  }
  return found.endpoint
    ? { status: 'ready', endpoint: found.endpoint }
    : { status: 'noEndpoint' }
}

/**
 * Turns pitwall's web listener on in its config.toml, which the daemon rereads every 2 seconds, then finds the daemon again.
 * @remarks The user asks for it on the setup card. It writes only a missing config.toml or one that parses with no `web` key; a `[web]` the user wrote stays theirs, and the error says what to set in it.
 */
export async function enablePitwallWeb(
  options: FindPitwallOptions,
): Promise<PitwallStatus> {
  const bin = await resolvePitwall(options)
  if (!bin) return { status: 'missing', platform: options.platform }
  const { stdout } = await execFileAsync(bin, ['config', 'path'], {
    env: options.env,
    timeout: 5000,
  })
  const config = stdout.trim()
  const old = await readFile(config, 'utf8').catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''
    throw error
  })
  let parsed: Record<string, unknown>
  try {
    parsed = TOML.parse(old)
  } catch (error) {
    throw new Error(
      `${config} is not valid TOML (${(error as Error).message.split('\n')[0]}). Add the lines yourself.`,
    )
  }
  if ('web' in parsed) {
    throw new Error(
      `${config} already has a [web] table. Set enabled = true in it.`,
    )
  }
  await mkdir(path.dirname(config), { recursive: true })
  await appendFile(
    config,
    `${old && !old.endsWith('\n') ? '\n' : ''}${old ? '\n' : ''}[web]\nenabled = true\n`,
  )
  const deadline = Date.now() + (options.timeoutMs ?? 5000)
  let status = await findPitwall(options)
  while (status.status === 'noEndpoint' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250))
    status = await findPitwall(options)
  }
  return status
}
