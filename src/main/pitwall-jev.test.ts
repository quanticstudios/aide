import { describe, expect, it } from 'vitest'
import { type PitwallJev, syncPitwallJev } from './pitwall-jev'

const ENDPOINT = { token: '9f'.repeat(32), url: 'ws://127.0.0.1:1/ws' }
const JEV: PitwallJev = {
  apiKey: 'secret-token',
  disabledRoots: ['/private'],
  gates: { global: { toolGate: { enabled: true } }, workspaces: {} },
}

/** A daemon socket that answers hello with capabilities and setJev with reply. */
function fakeSocket(capabilities: string[], reply: object | null) {
  const sent: Record<string, unknown>[] = []
  let closed = false
  const ws = {
    close: () => {
      closed = true
    },
    send(data: string) {
      const message = JSON.parse(data)
      sent.push(message)
      queueMicrotask(() => {
        if (message.type === 'hello')
          ws.onmessage?.({
            data: JSON.stringify({
              type: 'welcome',
              protocol: 1,
              capabilities,
            }),
          })
        else if (message.type === 'setJev' && reply)
          ws.onmessage?.({
            data: JSON.stringify({ type: 'result', id: message.id, ...reply }),
          })
      })
    },
    onclose: null as (() => void) | null,
    onerror: null as (() => void) | null,
    onmessage: null as ((event: { data: string }) => void) | null,
    onopen: null as (() => void) | null,
  }
  queueMicrotask(() => ws.onopen?.())
  return {
    createSocket: () => ws as unknown as WebSocket,
    sent,
    isClosed: () => closed,
  }
}

describe('syncPitwallJev', () => {
  it('says hello as aide and hands over the key, consent list and gates', async () => {
    const socket = fakeSocket(['setJev'], { ok: true })
    await syncPitwallJev(ENDPOINT, JEV, {
      createSocket: socket.createSocket,
      version: '1.2.3',
    })
    expect(socket.sent).toEqual([
      {
        type: 'hello',
        protocol: 1,
        token: ENDPOINT.token,
        client: { name: 'aide', version: '1.2.3' },
      },
      {
        type: 'setJev',
        id: 'jev',
        apiKey: 'secret-token',
        disabledRoots: ['/private'],
        gates: JEV.gates,
      },
    ])
    expect(socket.isClosed()).toBe(true)
  })

  it('sends no key as an empty one, and leaves a daemon without setJev alone', async () => {
    const socket = fakeSocket(['setJev'], { ok: true })
    await syncPitwallJev(
      ENDPOINT,
      { ...JEV, apiKey: null },
      { createSocket: socket.createSocket, version: '1' },
    )
    expect(socket.sent[1]).toMatchObject({ apiKey: '' })
    const old = fakeSocket([], null)
    await syncPitwallJev(ENDPOINT, JEV, {
      createSocket: old.createSocket,
      version: '1',
    })
    expect(old.sent.map((message) => message.type)).toEqual(['hello'])
  })

  it('rejects with the daemon refusal or a timeout', async () => {
    const refused = fakeSocket(['setJev'], {
      ok: false,
      code: 'invalid',
      message: 'setJev: bad key',
    })
    await expect(
      syncPitwallJev(ENDPOINT, JEV, {
        createSocket: refused.createSocket,
        version: '1',
      }),
    ).rejects.toThrow('setJev: bad key')
    const silent = fakeSocket(['setJev'], null)
    await expect(
      syncPitwallJev(ENDPOINT, JEV, {
        createSocket: silent.createSocket,
        timeoutMs: 10,
        version: '1',
      }),
    ).rejects.toThrow('in time')
  })
})
