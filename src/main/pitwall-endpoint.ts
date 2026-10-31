import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Session } from 'electron'
import type { PitwallEndpoint } from '../shared/ipc'

const ENDPOINT_URL = /^ws:\/\/(127\.0\.0\.1|localhost):\d{1,5}\/ws$/
const TOKEN = /^[0-9a-f]{64}$/

/** pitwall's state folder, as its `config.StateDir` picks it. */
export function getPitwallStateDir(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  home: string,
): string {
  if (env.XDG_STATE_HOME) return path.join(env.XDG_STATE_HOME, 'pitwall')
  if (platform === 'win32' && env.LOCALAPPDATA) {
    return path.join(env.LOCALAPPDATA, 'pitwall')
  }
  return path.join(home, '.local', 'state', 'pitwall')
}

/** Whether a process with this pid runs; EPERM means it does, as another user's. */
export function isRunning(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/** Reads the `web.json` pitwall's daemon writes; null when it is missing, damaged, names anything but a loopback WebSocket, or outlived its daemon. */
export async function readPitwallEndpoint(
  file: string,
): Promise<PitwallEndpoint | null> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(file, 'utf8'))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { pid, token, url } = parsed as Record<string, unknown>
  if (typeof url !== 'string' || !ENDPOINT_URL.test(url)) return null
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  // The file stays after the daemon exits, so it keeps the token.
  if (!isRunning(pid)) return null
  return { token, url }
}

/**
 * Drops `Origin` from the renderer's upgrade request to the daemon's WebSocket.
 * @remarks pitwall refuses an `Origin` other than its own, and the renderer's is `file://` or the dev server's. Only the URL `getUrl` returns loses it; the token in `hello` still guards the socket.
 */
export function allowPitwallOrigin(
  session: Pick<Session, 'webRequest'>,
  getUrl: () => string | null,
): void {
  session.webRequest.onBeforeSendHeaders(
    { urls: ['ws://127.0.0.1/*', 'ws://localhost/*'] },
    (details, callback) => {
      if (details.url !== getUrl()) {
        callback({})
        return
      }
      const requestHeaders = { ...details.requestHeaders }
      for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'origin') delete requestHeaders[name]
      }
      callback({ requestHeaders })
    },
  )
}
