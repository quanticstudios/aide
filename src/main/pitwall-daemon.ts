import { execFile, spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
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
 * Finds pitwall's daemon, starting it when none publishes a live endpoint.
 * @remarks Starts `pitwall daemon` detached, as pitwall's own window does, only when no daemon holds the socket lock, and never stops one.
 */
export async function findPitwall(
  options: FindPitwallOptions,
): Promise<PitwallStatus> {
  const file = path.join(
    getPitwallStateDir(options.env, options.platform, options.home),
    'web.json',
  )
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
  const daemon = spawn(bin, ['daemon'], {
    detached: true,
    env: options.env,
    stdio: 'ignore',
    windowsHide: true,
  })
  daemon.on('error', () => undefined)
  daemon.unref()
  const deadline = Date.now() + (options.timeoutMs ?? 5000)
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const endpoint = await readPitwallEndpoint(file)
    if (endpoint) return { status: 'ready', endpoint }
  }
  return { status: 'noEndpoint' }
}
