import type { PitwallStatus } from '../../../shared/ipc'

/** Where the daemon that served this page answers its session's bootstrap (pitwall docs/remote.md, Web client). */
export const BOOTSTRAP_PATH = '/_pitwall/bootstrap'

/**
 * Asks the daemon that served this page for its WebSocket and `hello` token, with the session cookie.
 * @remarks The token stays in memory. A browser with no session gets `noEndpoint`, which the connection banner shows until a reload after `pitwall web open`.
 */
export async function readBootstrap(
  fetchJson: (path: string) => Promise<Response> = (path) =>
    fetch(path, { cache: 'no-store', credentials: 'same-origin' }),
  base: string = window.location.href,
): Promise<PitwallStatus> {
  const response = await fetchJson(BOOTSTRAP_PATH)
  if (!response.ok) return { status: 'noEndpoint' }
  const { token, url } = (await response.json()) as {
    token: string
    url: string
  }
  // why: pitwall answers a relative url ("/ws") so it stays right behind tailscale serve.
  const socket = new URL(url, base)
  socket.protocol = socket.protocol === 'https:' ? 'wss:' : 'ws:'
  return { status: 'ready', endpoint: { token, url: socket.href } }
}
