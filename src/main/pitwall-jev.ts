import { DAEMON_PROTOCOL, type PitwallEndpoint } from '../shared/ipc'
import type { JevGateOverrides } from '../shared/jev-gates'

/** What pitwall's daemon needs to apply Jev's gates to the chats aide starts. */
export interface PitwallJev {
  readonly apiKey: string | null
  readonly disabledRoots: readonly string[]
  readonly gates: {
    readonly global: JevGateOverrides
    readonly workspaces: Readonly<Record<string, JevGateOverrides>>
  }
}

export interface SyncPitwallJevOptions {
  readonly createSocket?: (url: string) => WebSocket
  readonly timeoutMs?: number
  readonly version: string
}

/**
 * Hands aide's TypeSafe key, consent list and Jev gate settings to pitwall's daemon with `setJev`.
 * @remarks The main process sends it on its own connection, so the key never reaches the renderer. The daemon keeps it in memory only, so aide sends it again before each renderer connection. A daemon without `setJev` is left as it is.
 */
export function syncPitwallJev(
  endpoint: PitwallEndpoint,
  jev: PitwallJev,
  options: SyncPitwallJevOptions,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = (options.createSocket ?? ((url) => new WebSocket(url)))(
      endpoint.url,
    )
    let done = false
    const finish = (error?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      ws.close()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(
      () => finish(new Error('pitwall did not take the Jev settings in time.')),
      options.timeoutMs ?? 5_000,
    )
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: DAEMON_PROTOCOL,
          token: endpoint.token,
          client: { name: 'aide', version: options.version },
        }),
      )
    }
    ws.onmessage = (event) => {
      let message: {
        capabilities?: unknown
        id?: unknown
        message?: unknown
        ok?: unknown
        type?: unknown
      }
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (message.type === 'welcome') {
        if (
          !Array.isArray(message.capabilities) ||
          !message.capabilities.includes('setJev')
        ) {
          finish()
          return
        }
        ws.send(
          JSON.stringify({
            type: 'setJev',
            id: 'jev',
            apiKey: jev.apiKey ?? '',
            disabledRoots: jev.disabledRoots,
            gates: jev.gates,
          }),
        )
      } else if (message.type === 'result' && message.id === 'jev') {
        finish(
          message.ok === true
            ? undefined
            : new Error(
                typeof message.message === 'string'
                  ? message.message
                  : 'pitwall refused the Jev settings.',
              ),
        )
      }
    }
    ws.onerror = () => finish(new Error('pitwall refused the connection.'))
    ws.onclose = () =>
      finish(new Error('pitwall closed the connection before it answered.'))
  })
}
