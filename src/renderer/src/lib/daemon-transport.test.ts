import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PitwallStatus } from '../../../shared/ipc'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import {
  applyDelta,
  type SessionDelta,
  type SessionDeltaState,
} from '../../../shared/session-delta'
import {
  createDaemonTransport,
  DAEMON_RECONNECT_MAX_MS,
  DAEMON_RECONNECT_MIN_MS,
  type DaemonTransport,
  type DaemonTransportOptions,
} from './daemon-transport'
import type { ManagedSessionUpdate } from './managed-session-events'

const fixture = JSON.parse(
  readFileSync(
    new URL(
      '../../../../fixtures/session-deltas/tool-calls.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as { deltas: SessionDelta[]; snapshot: ManagedSessionSnapshot }
const SESSION_ID = fixture.deltas[0].sessionId
const TOKEN = 'ab'.repeat(32)

type Frame = Record<string, unknown> & { type: string }

/** A WebSocket the test drives from the server's side. */
class FakeSocket {
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onopen: (() => void) | null = null
  readonly sent: Frame[] = []
  closed = false

  constructor(
    readonly url: string,
    private readonly daemon: MockDaemon,
  ) {}

  send(data: string): void {
    const frame = JSON.parse(data) as Frame
    this.sent.push(frame)
    this.daemon.handle(this, frame)
  }

  close(code = 1000, reason = ''): void {
    if (this.closed) return
    this.closed = true
    this.onclose?.({ code, reason })
  }

  push(message: Frame): void {
    this.onmessage?.({ data: JSON.stringify(message) })
  }
}

/** pitwall's daemon for one chat, with the resync rules of web-protocol.md and a log of the deltas it streamed. */
class MockDaemon {
  readonly sockets: FakeSocket[] = []
  readonly log: SessionDelta[] = []
  capabilities = [
    'subscribeSessions',
    'listSessions',
    'subscribe',
    'unsubscribe',
    'read',
    'send',
    'interrupt',
    'resolveApproval',
    'resolveInput',
    'set',
    'archive',
    'start',
  ]
  protocol = 1
  deltaVersion = 1
  /** A protocol that refuses `hello` with 4002, as a pitwall at another protocol does. */
  refuseProtocol: number | null = null
  port = 4100
  running = true
  readonly subscribed = new Set<FakeSocket>()
  readonly commands: Frame[] = []
  /** Command types the daemon takes but never answers. */
  readonly silent = new Set<string>()

  /** What main reports: pitwall `missing`, or a daemon that is not running and could not be started. */
  missing = false

  endpoint() {
    return this.running
      ? { url: `ws://127.0.0.1:${this.port}/ws`, token: TOKEN }
      : null
  }

  status(): PitwallStatus {
    if (this.missing) return { status: 'missing', platform: 'linux' }
    const endpoint = this.endpoint()
    return endpoint ? { status: 'ready', endpoint } : { status: 'noEndpoint' }
  }

  open(url: string): FakeSocket {
    const socket = new FakeSocket(url, this)
    this.sockets.push(socket)
    queueMicrotask(() => {
      if (this.running && url === this.endpoint()?.url) socket.onopen?.()
      else socket.close(1006)
    })
    return socket
  }

  get latest(): FakeSocket {
    const socket = this.sockets.at(-1)
    if (!socket) throw new Error('no socket yet')
    return socket
  }

  handle(socket: FakeSocket, frame: Frame): void {
    if (frame.type === 'hello') {
      if (frame.token !== TOKEN) socket.close(4001, 'bad token')
      else if (this.refuseProtocol !== null) {
        socket.close(
          4002,
          `pitwall speaks protocol ${this.refuseProtocol}, client sent ${frame.protocol}: update aide or pitwall`,
        )
      } else {
        socket.push({
          type: 'welcome',
          protocol: this.protocol,
          deltaVersion: this.deltaVersion,
          server: { name: 'pitwall', version: '0.2.0' },
          capabilities: this.capabilities,
        })
      }
      return
    }
    this.commands.push(frame)
    if (this.silent.has(frame.type)) return
    const state = this.state()
    const fail = (code: string, message: string) =>
      socket.push({ type: 'result', id: frame.id, ok: false, code, message })
    const ok = (data?: unknown) =>
      socket.push({ type: 'result', id: frame.id, ok: true, data })
    if (frame.type === 'read') {
      if (state) ok({ seq: state.seq, snapshot: state.snapshot, deltas: [] })
      else fail('not-found', 'no chat')
    } else if (frame.type === 'listSessions') {
      if (frame.archived) {
        fail('unsupported', 'pitwall does not list archived chats yet')
      } else {
        ok({ chats: state ? [{ id: SESSION_ID, title: 'Chat' }] : [] })
      }
    } else if (frame.type === 'archive' && frame.sessionId !== SESSION_ID) {
      fail('not-found', `no chat ${frame.sessionId}`)
    } else if (frame.type === 'start') {
      ok({ sessionId: SESSION_ID, workspaceId: 'workspace-1' })
    } else if (frame.type === 'resolveApproval') {
      fail('conflict', 'toolu_01 was answered from cli')
    } else ok()
    if (frame.type !== 'subscribe') return

    this.subscribed.add(socket)
    const after = Number(frame.after)
    const latest = this.log.at(-1)?.seq ?? 0
    if (after > 0 && after < latest) {
      socket.push({
        type: 'deltas',
        sessionId: SESSION_ID,
        deltas: this.log.filter((delta) => delta.seq > after),
      })
    } else if (state && after !== latest) {
      socket.push({
        type: 'deltas',
        sessionId: SESSION_ID,
        seq: state.seq,
        snapshot: state.snapshot,
        deltas: [],
      })
    }
  }

  state(): SessionDeltaState | null {
    return this.log.reduce<SessionDeltaState | null>(applyDelta, null)
  }

  emit(delta: SessionDelta): void {
    this.log.push(delta)
    for (const socket of this.subscribed) {
      if (!socket.closed)
        socket.push({ type: 'deltas', sessionId: SESSION_ID, deltas: [delta] })
    }
  }

  kill(): void {
    this.running = false
    for (const socket of this.sockets) socket.close(1001, 'daemon exiting')
    this.subscribed.clear()
  }

  restart(): void {
    this.running = true
    this.port += 1
  }
}

let daemon: MockDaemon
let transport: DaemonTransport

async function settle(ms = 0): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

function start(
  overrides: Partial<DaemonTransportOptions> = {},
): DaemonTransport {
  transport = createDaemonTransport({
    clientVersion: '0.0.3',
    createSocket: (url) => daemon.open(url) as unknown as WebSocket,
    getEndpoint: async () => daemon.status(),
    getNotificationSettings: async () => ({
      notificationsEnabled: true,
      notificationSoundsEnabled: false,
    }),
    ...overrides,
  })
  return transport
}

function watch(sessionId = SESSION_ID): ManagedSessionUpdate[] {
  const updates: ManagedSessionUpdate[] = []
  transport.subscribeSession(sessionId, (update) => updates.push(update))
  return updates
}

function lastSnapshot(
  updates: ManagedSessionUpdate[],
): ManagedSessionSnapshot | undefined {
  const last = updates.at(-1)
  return last?.type === 'snapshot' ? last.snapshot : undefined
}

beforeEach(() => {
  vi.useFakeTimers()
  daemon = new MockDaemon()
})

afterEach(() => {
  transport?.dispose()
  vi.useRealTimers()
})

describe('DaemonTransport', () => {
  it('sends hello with the token from main, then subscribes', async () => {
    start()
    watch()
    await settle()
    expect(daemon.latest.sent[0]).toEqual({
      type: 'hello',
      protocol: 1,
      token: TOKEN,
      client: { name: 'aide', version: '0.0.3' },
    })
    expect(daemon.latest.sent[1]).toMatchObject({
      type: 'subscribe',
      sessionId: SESSION_ID,
      after: 0,
    })
    expect(transport.getConnection()).toEqual({
      status: 'connected',
      server: 'pitwall 0.2.0',
    })
  })

  it('matches a run without a restart when the daemon is killed and restarted mid-stream', async () => {
    const [first, ...rest] = fixture.deltas
    daemon.emit(first)
    start()
    const updates = watch()
    await settle()
    const half = Math.floor(rest.length / 2)
    for (const delta of rest.slice(0, half)) daemon.emit(delta)
    const seqBeforeKill = daemon.log.at(-1)?.seq

    daemon.kill()
    expect(transport.getConnection()).toEqual({
      status: 'reconnecting',
      reason: 'daemon exiting',
    })
    // Deltas the chat loop produced while aide was away.
    daemon.log.push(...rest.slice(half, half + 2))
    await settle(DAEMON_RECONNECT_MIN_MS)
    expect(transport.getConnection()).toEqual({
      status: 'unavailable',
      pitwall: { status: 'noEndpoint' },
    })

    daemon.restart()
    await settle(DAEMON_RECONNECT_MIN_MS * 2)
    expect(transport.getConnection().status).toBe('connected')
    expect(daemon.latest.url).toBe('ws://127.0.0.1:4101/ws')
    expect(daemon.latest.sent[1]).toMatchObject({
      type: 'subscribe',
      after: seqBeforeKill,
    })
    for (const delta of rest.slice(half + 2)) daemon.emit(delta)

    expect(lastSnapshot(updates)).toEqual(fixture.snapshot)
  })

  it('says pitwall is missing, keeps checking, and checks again at once when asked', async () => {
    daemon.missing = true
    start()
    await settle()
    expect(transport.getConnection()).toEqual({
      status: 'unavailable',
      pitwall: { status: 'missing', platform: 'linux' },
    })
    expect(daemon.sockets).toHaveLength(0)

    daemon.missing = false
    transport.checkAgain()
    expect(transport.getConnection().status).toBe('connecting')
    await settle()
    expect(transport.getConnection().status).toBe('connected')
  })

  it('connects once pitwall turns up, without a click', async () => {
    daemon.missing = true
    start()
    await settle()
    daemon.missing = false
    await settle(DAEMON_RECONNECT_MIN_MS)
    expect(transport.getConnection().status).toBe('connected')
  })

  it('resyncs from a fresh snapshot when a delta skips a seq', async () => {
    daemon.emit(fixture.deltas[0])
    start()
    const updates = watch()
    await settle()
    for (const delta of fixture.deltas.slice(1, 4)) daemon.emit(delta)
    daemon.log.push(fixture.deltas[4])
    daemon.emit(fixture.deltas[5])
    expect(daemon.latest.sent.at(-1)).toMatchObject({
      type: 'subscribe',
      after: 0,
    })
    for (const delta of fixture.deltas.slice(6)) daemon.emit(delta)
    expect(lastSnapshot(updates)).toEqual(fixture.snapshot)
  })

  it('backs off between attempts while pitwall is down, up to the cap', async () => {
    daemon.running = false
    start()
    await settle()
    const attempts: number[] = []
    let calls = 0
    const original = daemon.endpoint.bind(daemon)
    daemon.endpoint = () => {
      calls += 1
      attempts.push(Date.now())
      return original()
    }
    await settle(DAEMON_RECONNECT_MAX_MS * 4)
    const gaps = attempts.slice(1).map((at, index) => at - attempts[index])
    expect(gaps.slice(0, 4)).toEqual([1000, 2000, 4000, 8000])
    expect(Math.max(...gaps)).toBe(DAEMON_RECONNECT_MAX_MS)
    expect(calls).toBeGreaterThan(3)
  })

  it('is read-only while disconnected', async () => {
    daemon.running = false
    start()
    await settle()
    await expect(transport.interrupt(SESSION_ID)).rejects.toThrow(
      'read-only while it reconnects',
    )
    expect(daemon.commands).toEqual([])
  })

  it('rejects commands in flight when the connection drops', async () => {
    start()
    await settle()
    daemon.silent.add('interrupt')
    const pending = transport.interrupt(SESSION_ID)
    daemon.latest.close(1006)
    await expect(pending).rejects.toThrow('The connection to pitwall closed.')
  })

  it.each([
    [
      2,
      'Update pitwall to a version that speaks web protocol version 1; this one speaks 0.',
      { protocol: 0 },
    ],
    [
      3,
      'Update aide: pitwall speaks web protocol version 2 and this aide speaks 1.',
      { protocol: 2 },
    ],
    [
      4,
      'Update aide: pitwall speaks web delta version 2 and this aide speaks 1.',
      { deltaVersion: 2 },
    ],
  ] as const)('shows a version mismatch from welcome (%#)', async (_case, message, welcome) => {
    Object.assign(daemon, welcome)
    start()
    await settle()
    expect(transport.getConnection()).toEqual({
      status: 'incompatible',
      message,
    })
    await settle(DAEMON_RECONNECT_MAX_MS * 2)
    expect(daemon.sockets).toHaveLength(1)
    await expect(transport.interrupt(SESSION_ID)).rejects.toThrow(message)
  })

  it.each([
    [
      0,
      'Update pitwall to a version that speaks web protocol version 1; this one speaks 0.',
    ],
    [
      2,
      'Update aide: pitwall speaks web protocol version 2 and this aide speaks 1.',
    ],
  ] as const)('reads the version from a 4002 close (pitwall at %i) and does not retry', async (theirs, message) => {
    daemon.refuseProtocol = theirs
    start()
    await settle(DAEMON_RECONNECT_MAX_MS * 2)
    expect(transport.getConnection()).toEqual({
      status: 'incompatible',
      message,
    })
    expect(daemon.sockets).toHaveLength(1)
  })

  it('stops at a delta of another version instead of resyncing in a loop', async () => {
    daemon.emit(fixture.deltas[0])
    start()
    watch()
    await settle()
    daemon.emit({ ...fixture.deltas[1], version: 2 } as unknown as SessionDelta)
    expect(transport.getConnection()).toMatchObject({
      status: 'incompatible',
      message:
        'Update aide: pitwall speaks web delta version 2 and this aide speaks 1.',
    })
    expect(daemon.latest.closed).toBe(true)
  })

  it('maps commands to the protocol', async () => {
    daemon.emit(fixture.deltas[0])
    start()
    await settle()
    await transport.queue(SESSION_ID, 'later')
    await transport.resolveInput(SESSION_ID, 'question-1', {
      branch: 'main',
      tags: ['a', 'b'],
    })
    await transport.setMode(SESSION_ID, 'build')
    await transport.close(SESSION_ID)
    await expect(
      transport.resolveApproval(SESSION_ID, 'toolu_01', 'accept-for-session'),
    ).rejects.toThrow('toolu_01 was answered from cli')
    expect(daemon.commands.map(({ id: _id, ...frame }) => frame)).toEqual([
      { type: 'send', sessionId: SESSION_ID, text: 'later', how: 'queue' },
      {
        type: 'resolveInput',
        sessionId: SESSION_ID,
        requestId: 'question-1',
        answers: { branch: ['main'], tags: ['a', 'b'] },
      },
      { type: 'set', sessionId: SESSION_ID, permissionMode: 'default' },
      { type: 'read', sessionId: SESSION_ID, after: 0 },
      { type: 'archive', sessionId: SESSION_ID },
      {
        type: 'resolveApproval',
        sessionId: SESSION_ID,
        requestId: 'toolu_01',
        decision: 'allow-session',
      },
    ])
  })

  it('refuses a command the server did not list, or the protocol lacks', async () => {
    daemon.capabilities = daemon.capabilities.filter(
      (type) => type !== 'interrupt',
    )
    start()
    await settle()
    await expect(transport.interrupt(SESSION_ID)).rejects.toThrow(
      'This pitwall does not support interrupt yet.',
    )
    await expect(
      transport.getCheckpointDiff(SESSION_ID, 'c'),
    ).rejects.toMatchObject({ code: 'unsupported' })
    expect(daemon.commands).toEqual([])
  })

  it('resubscribes the session list after a reconnect', async () => {
    start()
    const listener = vi.fn()
    transport.subscribeSessionList(listener)
    await settle()
    daemon.latest.push({ type: 'sessionsChanged', changed: [], removed: [] })
    expect(listener).toHaveBeenCalledTimes(1)
    daemon.kill()
    daemon.restart()
    await settle(DAEMON_RECONNECT_MIN_MS)
    expect(daemon.latest.sent.map((frame) => frame.type)).toEqual([
      'hello',
      'subscribeSessions',
    ])
  })

  it('lists live chats while pitwall refuses to list archived ones', async () => {
    daemon.emit(fixture.deltas[0])
    start()
    await settle()
    const library = await transport.listSessions()
    expect(library.tasks.map((task) => task.sessionId)).toEqual([SESSION_ID])
  })

  it('binds the session id aide started with to the chat pitwall picked', async () => {
    daemon.emit(fixture.deltas[0])
    const saved: Record<string, string>[] = []
    start({ chatIds: { load: () => ({}), save: (ids) => saved.push(ids) } })
    await settle()
    const updates = watch('pane-1')
    await settle()
    await transport.start({
      cwd: '/repo',
      mode: 'claude',
      sessionId: 'pane-1',
    } as Parameters<DaemonTransport['start']>[0])
    await settle()
    daemon.emit(fixture.deltas[1])
    expect(lastSnapshot(updates)).toEqual(daemon.state()?.snapshot)
    await transport.interrupt('pane-1')
    expect(daemon.commands.at(-1)).toMatchObject({
      type: 'interrupt',
      sessionId: SESSION_ID,
    })
    expect(Object.keys(await transport.getSessions())).toEqual([
      SESSION_ID,
      'pane-1',
    ])
    expect(saved).toEqual([{ 'pane-1': SESSION_ID }])

    transport.dispose()
    start({ chatIds: { load: () => saved[0], save: () => undefined } })
    await settle()
    await transport.interrupt('pane-1')
    expect(daemon.commands.at(-1)).toMatchObject({ sessionId: SESSION_ID })
  })

  it('closes a pane that has no chat without an error', async () => {
    start()
    await settle()
    await expect(transport.close('workspace-1:terminal-1')).resolves.toBe(
      undefined,
    )
  })
})
