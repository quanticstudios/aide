import type { TurnCheckpointPreview } from '../../../shared/checkpoints'
import type { PitwallEndpoint } from '../../../shared/ipc'
import type {
  ManagedSessionDecision,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import {
  applyDelta,
  SESSION_DELTA_VERSION,
  type SessionDelta,
  SessionDeltaResyncError,
  type SessionDeltaState,
} from '../../../shared/session-delta'
import type {
  SavedTask,
  TaskLibrarySnapshot,
} from '../../../shared/task-library'
import {
  type ManagedSessionUpdate,
  shareSnapshotContent,
} from './managed-session-events'
import type { SessionTransport } from './session-transport'

/** The `protocol` of pitwall's docs/web-protocol.md that this transport speaks. */
export const DAEMON_PROTOCOL = 1
export const DAEMON_RECONNECT_MIN_MS = 500
export const DAEMON_RECONNECT_MAX_MS = 10_000

export type DaemonConnection =
  | { readonly status: 'connecting' }
  | { readonly status: 'connected'; readonly server: string }
  | { readonly status: 'reconnecting'; readonly reason: string }
  | { readonly status: 'incompatible'; readonly message: string }

/** A `SessionTransport` over pitwall's web protocol, plus the connection state the banner shows. */
export interface DaemonTransport extends SessionTransport {
  getConnection: () => DaemonConnection
  subscribeConnection: (listener: () => void) => () => void
  dispose: () => void
}

export interface DaemonTransportOptions {
  readonly clientVersion: string
  readonly createSocket?: (url: string) => WebSocket
  /** Asks Electron main to read `web.json`; called before every connect, since a restarted daemon may listen on a new port. */
  readonly getEndpoint: () => Promise<PitwallEndpoint | null>
  /** aide's own notification settings, which the task library shows beside pitwall's chats. */
  readonly getNotificationSettings: () => Promise<
    Pick<
      TaskLibrarySnapshot,
      'notificationSoundsEnabled' | 'notificationsEnabled'
    >
  >
}

export function isDaemonTransport(
  transport: SessionTransport | null,
): transport is DaemonTransport {
  return transport !== null && 'getConnection' in transport
}

/** A command pitwall answered with `ok: false`, or one this transport cannot send. */
export class DaemonCommandError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'DaemonCommandError'
    this.code = code
  }
}

interface DaemonChat {
  id: string
  pending: number
  provider: string
  state: string
  title: string
  turns: number
  updatedAt: string
  workspaceId: string
}

interface DaemonProject {
  name: string
  workspaces: { branch: string; id: string; label: string }[]
}

interface DeltasPayload {
  deltas?: SessionDelta[]
  seq?: number
  snapshot?: ManagedSessionSnapshot
}

type ServerMessage =
  | {
      type: 'welcome'
      capabilities: string[]
      deltaVersion: number
      protocol: number
      server: { name: string; version: string }
    }
  | {
      type: 'result'
      code?: string
      data?: Record<string, unknown>
      id: string
      message?: string
      ok: boolean
    }
  | ({ type: 'deltas'; sessionId: string } & DeltasPayload)
  | { type: 'removed'; sessionId: string }
  | { type: 'sessions' | 'sessionsChanged' }

interface SessionEntry {
  readonly listeners: Set<(update: ManagedSessionUpdate) => void>
  /** Waiting for the snapshot a `subscribe` with `after: 0` brings; deltas before it are dropped. */
  resyncing: boolean
  state: SessionDeltaState | null
}

const DECISIONS: Record<ManagedSessionDecision, string> = {
  accept: 'allow',
  'accept-for-session': 'allow-session',
  deny: 'deny',
}

/** What to tell the user when pitwall speaks another `protocol` or `deltaVersion`: the older side updates. */
export function describeVersionMismatch(
  what: 'delta' | 'protocol',
  theirs: number,
): string {
  const ours = what === 'protocol' ? DAEMON_PROTOCOL : SESSION_DELTA_VERSION
  return theirs < ours
    ? `Update pitwall to a version that speaks web ${what} version ${ours}; this one speaks ${theirs}.`
    : `Update aide: pitwall speaks web ${what} version ${theirs} and this aide speaks ${ours}.`
}

/** Reads the protocol pitwall named in a 4002 close, such as "pitwall speaks protocol 1, client sent 2: update aide or pitwall". */
function describeRefusal(reason: string): string {
  const theirs = /pitwall speaks protocol (\d+)/.exec(reason)?.[1]
  return theirs
    ? describeVersionMismatch('protocol', Number(theirs))
    : `Update aide or pitwall: ${reason}`
}

function toTaskStatus(chat: DaemonChat): SavedTask['status'] {
  if (chat.pending > 0 || chat.state === 'waiting') return 'approval'
  if (chat.state === 'running' || chat.state === 'connecting') return 'running'
  if (chat.state === 'error') return 'failed'
  if (chat.state === 'stopped') return 'interrupted'
  return chat.turns > 0 ? 'completed' : 'idle'
}

function unsupported(name: string): Promise<never> {
  return Promise.reject(
    new DaemonCommandError(
      'unsupported',
      `pitwall's web protocol has no ${name} yet.`,
    ),
  )
}

/**
 * Connects to pitwall's daemon, sends `hello`, and keeps every subscription alive across reconnects.
 * @remarks Reconnects with backoff and resubscribes each session from the last `seq` it applied. Commands fail while it is not connected, which makes aide read-only until pitwall is back.
 */
export function createDaemonTransport(
  options: DaemonTransportOptions,
): DaemonTransport {
  const createSocket = options.createSocket ?? ((url) => new WebSocket(url))
  const connectionListeners = new Set<() => void>()
  const listListeners = new Set<() => void>()
  const sessions = new Map<string, SessionEntry>()
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (data: Record<string, unknown>) => void
    }
  >()
  const previews = new Map<
    string,
    { checkpointId: string; prompt: string; sessionId: string; turnId: string }
  >()
  let connection: DaemonConnection = { status: 'connecting' }
  let socket: WebSocket | null = null
  let capabilities = new Set<string>()
  let attempt = 0
  let nextId = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  function setConnection(next: DaemonConnection): void {
    connection = next
    for (const listener of connectionListeners) listener()
  }

  async function connect(): Promise<void> {
    timer = null
    const endpoint = await options.getEndpoint().catch(() => null)
    if (disposed) return
    if (!endpoint) {
      retry('pitwall is not running')
      return
    }
    let ws: WebSocket
    try {
      ws = createSocket(endpoint.url)
    } catch {
      retry('pitwall refused the connection')
      return
    }
    socket = ws
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: DAEMON_PROTOCOL,
          token: endpoint.token,
          client: { name: 'aide', version: options.clientVersion },
        }),
      )
    }
    ws.onmessage = (event) => {
      if (socket === ws) receive(ws, event.data)
    }
    ws.onclose = (event) => {
      if (socket === ws) closed(event.code, event.reason)
    }
  }

  function retry(reason: string): void {
    if (disposed) return
    setConnection({ status: 'reconnecting', reason })
    const delay = Math.min(
      DAEMON_RECONNECT_MAX_MS,
      DAEMON_RECONNECT_MIN_MS * 2 ** attempt,
    )
    attempt += 1
    timer = setTimeout(() => void connect(), delay)
  }

  function closed(code: number, reason: string): void {
    socket = null
    capabilities = new Set()
    for (const request of pending.values()) {
      request.reject(new Error('The connection to pitwall closed.'))
    }
    pending.clear()
    if (disposed || connection.status === 'incompatible') return
    if (code === 4002) {
      setConnection({
        status: 'incompatible',
        message: describeRefusal(reason),
      })
      return
    }
    retry(reason || 'the connection to pitwall closed')
  }

  function incompatible(ws: WebSocket, message: string): void {
    setConnection({ status: 'incompatible', message })
    ws.close(1000)
  }

  function receive(ws: WebSocket, data: unknown): void {
    let message: ServerMessage
    try {
      message = JSON.parse(String(data))
    } catch {
      return
    }
    switch (message?.type) {
      case 'welcome': {
        if (message.protocol !== DAEMON_PROTOCOL) {
          incompatible(
            ws,
            describeVersionMismatch('protocol', message.protocol),
          )
          return
        }
        if (message.deltaVersion !== SESSION_DELTA_VERSION) {
          incompatible(
            ws,
            describeVersionMismatch('delta', message.deltaVersion),
          )
          return
        }
        attempt = 0
        capabilities = new Set(message.capabilities)
        setConnection({
          status: 'connected',
          server: `${message.server.name} ${message.server.version}`,
        })
        if (listListeners.size) void quietly('subscribeSessions')
        for (const [sessionId, entry] of sessions) {
          subscribe(sessionId, entry.state?.seq ?? 0)
        }
        return
      }
      case 'result': {
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (message.ok) request.resolve(message.data ?? {})
        else {
          request.reject(
            new DaemonCommandError(
              message.code ?? 'unknown',
              message.message ??
                `pitwall refused the command (${message.code}).`,
            ),
          )
        }
        return
      }
      case 'deltas':
        receiveDeltas(ws, message.sessionId, message)
        return
      case 'removed':
        removed(message.sessionId)
        return
      case 'sessions':
      case 'sessionsChanged':
        for (const listener of listListeners) listener()
        return
    }
  }

  function command<T = Record<string, unknown>>(
    type: string,
    fields: Record<string, unknown> = {},
  ): Promise<T> {
    if (connection.status !== 'connected' || !socket) {
      return Promise.reject(
        new DaemonCommandError(
          'disconnected',
          connection.status === 'incompatible'
            ? connection.message
            : 'aide is read-only while it reconnects to pitwall.',
        ),
      )
    }
    if (!capabilities.has(type)) {
      return Promise.reject(
        new DaemonCommandError(
          'unsupported',
          `This pitwall does not support ${type} yet.`,
        ),
      )
    }
    const id = String(++nextId)
    const ws = socket
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve: (data) => resolve(data as T) })
      ws.send(JSON.stringify({ ...fields, type, id }))
    })
  }

  /** Sends a command whose failure leaves nothing to do; a reconnect sends it again. */
  function quietly(type: string, fields?: Record<string, unknown>) {
    return command(type, fields).catch(() => undefined)
  }

  function subscribe(sessionId: string, after: number): void {
    const entry = sessions.get(sessionId)
    if (entry) entry.resyncing = after === 0
    command('subscribe', { sessionId, after }).catch((error) => {
      if (error instanceof DaemonCommandError && error.code === 'not-found') {
        removed(sessionId)
      }
    })
  }

  function receiveDeltas(
    ws: WebSocket,
    sessionId: string,
    payload: DeltasPayload,
  ): void {
    const entry = sessions.get(sessionId)
    if (!entry || (entry.resyncing && !payload.snapshot)) return
    const deltas = payload.deltas ?? []
    const foreign = deltas.find(
      (delta) => delta.version !== SESSION_DELTA_VERSION,
    )
    if (foreign) {
      incompatible(ws, describeVersionMismatch('delta', foreign.version))
      return
    }
    entry.resyncing = false
    let state: SessionDeltaState | null = payload.snapshot
      ? { seq: payload.seq ?? 0, snapshot: payload.snapshot }
      : entry.state
    let replaced = Boolean(payload.snapshot)
    try {
      for (const delta of deltas) {
        if (state && delta.seq <= state.seq) continue
        state = applyDelta(state, delta)
        if (delta.type === 'snapshot') replaced = true
      }
    } catch (error) {
      if (!(error instanceof SessionDeltaResyncError)) throw error
      subscribe(sessionId, 0)
      return
    }
    if (!state || state === entry.state) return
    const snapshot = replaced
      ? shareSnapshotContent(entry.state?.snapshot, state.snapshot)
      : state.snapshot
    entry.state = { seq: state.seq, snapshot }
    for (const listener of entry.listeners) {
      listener({ snapshot, type: 'snapshot' })
    }
  }

  function removed(sessionId: string): void {
    const entry = sessions.get(sessionId)
    if (!entry) return
    entry.state = null
    for (const listener of entry.listeners) listener({ type: 'removed' })
  }

  async function read(sessionId: string): Promise<SessionDeltaState | null> {
    let data: DeltasPayload
    try {
      data = await command<DeltasPayload>('read', { sessionId, after: 0 })
    } catch (error) {
      if (error instanceof DaemonCommandError && error.code === 'not-found') {
        return null
      }
      throw error
    }
    let state: SessionDeltaState | null = data.snapshot
      ? { seq: data.seq ?? 0, snapshot: data.snapshot }
      : null
    for (const delta of data.deltas ?? []) state = applyDelta(state, delta)
    return state
  }

  async function readSnapshot(
    sessionId: string,
  ): Promise<ManagedSessionSnapshot> {
    const state = await read(sessionId)
    if (!state) {
      throw new DaemonCommandError(
        'not-found',
        `No chat ${sessionId} in pitwall.`,
      )
    }
    return state.snapshot
  }

  /** The snapshot this transport holds for a subscribed chat, else a fresh `read`. */
  async function currentSnapshot(
    sessionId: string,
  ): Promise<ManagedSessionSnapshot> {
    return sessions.get(sessionId)?.state?.snapshot ?? readSnapshot(sessionId)
  }

  async function listSessions(query?: string): Promise<TaskLibrarySnapshot> {
    const [live, archived, projects, settings] = await Promise.all([
      command<{ chats: DaemonChat[] }>('listSessions'),
      command<{ chats: DaemonChat[] }>('listSessions', { archived: true }),
      command<{ projects: DaemonProject[] }>('listProjects').catch(() => ({
        projects: [],
      })),
      options.getNotificationSettings(),
    ])
    const workspaces = new Map<
      string,
      { branch: string; label: string; project: string }
    >()
    for (const project of projects.projects) {
      for (const workspace of project.workspaces) {
        workspaces.set(workspace.id, { ...workspace, project: project.name })
      }
    }
    const tasks = new Map<string, SavedTask>()
    for (const [chats, isArchived] of [
      [live.chats, false],
      [archived.chats, true],
    ] as const) {
      for (const chat of chats) {
        const workspace = workspaces.get(chat.workspaceId)
        tasks.set(chat.id, {
          sessionId: chat.id,
          paneId: chat.id,
          workspaceId: chat.workspaceId,
          projectName: workspace?.project ?? '',
          workspaceName: workspace?.label ?? '',
          branchName: workspace?.branch ?? '',
          title: chat.title,
          updatedAt: chat.updatedAt,
          provider: chat.provider,
          status: toTaskStatus(chat),
          activityKey: null,
          unread: false,
          excerpt: '',
          pinned: false,
          archived: isArchived,
          readActivityKey: null,
        })
      }
    }
    const needle = query?.trim().toLowerCase()
    return {
      ...settings,
      tasks: [...tasks.values()]
        .filter((task) => !needle || task.title.toLowerCase().includes(needle))
        .sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.sessionId.localeCompare(right.sessionId),
        ),
    }
  }

  async function set(
    sessionId: string,
    fields: Record<string, unknown>,
  ): Promise<ManagedSessionSnapshot> {
    await command('set', { sessionId, ...fields })
    return readSnapshot(sessionId)
  }

  void connect()

  return {
    getConnection: () => connection,
    subscribeConnection: (listener) => {
      connectionListeners.add(listener)
      return () => connectionListeners.delete(listener)
    },
    dispose: () => {
      disposed = true
      if (timer) clearTimeout(timer)
      socket?.close(1000)
    },

    listSessions,
    subscribeSessionList: (listener) => {
      listListeners.add(listener)
      if (listListeners.size === 1) void quietly('subscribeSessions')
      return () => {
        if (listListeners.delete(listener) && listListeners.size === 0) {
          void quietly('unsubscribeSessions')
        }
      }
    },
    updateSession: async (sessionId, input) => {
      // shortcut: title, pinned and readActivityKey have no web command in v1 (web-protocol.md, Left open 2); they are dropped until pitwall adds them.
      if (input.archived !== undefined) {
        await command(input.archived ? 'archive' : 'unarchive', { sessionId })
      }
      return listSessions()
    },
    subscribeSession: (sessionId, listener) => {
      let entry = sessions.get(sessionId)
      if (!entry) {
        entry = { listeners: new Set(), resyncing: false, state: null }
        sessions.set(sessionId, entry)
        if (connection.status === 'connected') subscribe(sessionId, 0)
      } else if (entry.state) {
        listener({ snapshot: entry.state.snapshot, type: 'snapshot' })
      }
      const { listeners } = entry
      listeners.add(listener)
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        if (sessions.get(sessionId)?.listeners !== listeners) return
        sessions.delete(sessionId)
        void quietly('unsubscribe', { sessionId })
      }
    },
    getSessions: async () => {
      const { chats } = await command<{ chats: DaemonChat[] }>('listSessions')
      const states = await Promise.all(chats.map((chat) => read(chat.id)))
      const snapshots: Record<string, ManagedSessionSnapshot> = {}
      for (const state of states) {
        if (state) snapshots[state.snapshot.sessionId] = state.snapshot
      }
      return snapshots
    },
    getSavedSession: async (sessionId) =>
      (await read(sessionId))?.snapshot ?? null,
    start: async (config) => {
      // pitwall picks the chat's sessionId and workspaceId (web-protocol.md, aide's SessionTransport).
      const { sessionId } = await command<{ sessionId: string }>('start', {
        dir: config.cwd,
        provider: config.mode,
        model: config.model,
        effort: config.effort,
        permissionMode:
          config.interactionMode === 'plan' ? 'plan' : config.permissionMode,
      })
      return readSnapshot(sessionId)
    },
    send: async (sessionId, text, _recipients, attachments) => {
      // aide's send steers a running turn; pitwall's default would queue it.
      const running = sessions.get(sessionId)?.state?.snapshot.running
      await command('send', {
        sessionId,
        text,
        attachments,
        how: running ? 'steer' : undefined,
      })
    },
    queue: async (sessionId, text, _recipients, attachments) => {
      await command('send', { sessionId, text, attachments, how: 'queue' })
    },
    updateQueue: () => unsupported('queue editing'),
    interrupt: async (sessionId) => {
      await command('interrupt', { sessionId })
    },
    resolveApproval: async (sessionId, requestId, decision, reason) => {
      await command('resolveApproval', {
        sessionId,
        requestId,
        decision: DECISIONS[decision],
        reason,
      })
    },
    resolveInput: async (sessionId, requestId, answers) => {
      await command('resolveInput', {
        sessionId,
        requestId,
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, answer]) => [
            id,
            typeof answer === 'string' ? [answer] : answer,
          ]),
        ),
      })
    },
    setModel: async (sessionId, selection) => {
      const snapshot = await currentSnapshot(sessionId)
      if (snapshot.provider !== selection.mode) {
        return unsupported('switching a chat to another provider')
      }
      return set(sessionId, {
        model: selection.model,
        effort: selection.effort,
      })
    },
    setMode: (sessionId, interactionMode) =>
      set(sessionId, {
        permissionMode: interactionMode === 'plan' ? 'plan' : 'default',
      }),
    setPermissionMode: (sessionId, permissionMode) =>
      set(sessionId, { permissionMode }),
    setAgents: () => unsupported('multi-agent routing'),
    fork: async (sessionId, responseContentItemId) => {
      const snapshot = await currentSnapshot(sessionId)
      const turnId = snapshot.content.find(
        (item) => item.id === responseContentItemId,
      )?.turnId
      if (!turnId) {
        throw new DaemonCommandError(
          'not-found',
          `No turn holds ${responseContentItemId}.`,
        )
      }
      await command('fork', { sessionId, turnId })
    },
    implementPlanInNewThread: () =>
      unsupported('implementing a plan in a new chat'),
    getCheckpointDiff: () => unsupported('checkpoint diffs'),
    previewRewind: async (sessionId, checkpointId) => {
      const snapshot = await currentSnapshot(sessionId)
      const turn =
        snapshot.turns.find(
          (candidate) => candidate.checkpointId === checkpointId,
        ) ?? snapshot.turns.find((candidate) => candidate.id === checkpointId)
      if (!turn) {
        throw new DaemonCommandError(
          'not-found',
          `No turn for ${checkpointId}.`,
        )
      }
      // pitwall rewinds in one step, so the preview names the turn and lists no changes.
      const previewId = `rewind-${++nextId}`
      previews.set(previewId, {
        checkpointId,
        prompt: turn.requestText ?? '',
        sessionId,
        turnId: turn.id,
      })
      const now = new Date().toISOString()
      return {
        changes: [],
        checkpoint: {
          capturedAt: turn.startedAt,
          checkpointId,
          sessionId,
          workspaceId: snapshot.workspaceId,
        },
        createdAt: now,
        expiresAt: now,
        previewId,
        restorePatch: '',
        sessionRevision: snapshot.revision,
        turnChanges: null,
        turnPatch: null,
      } satisfies TurnCheckpointPreview
    },
    rewind: async (previewId, mode) => {
      const preview = previews.get(previewId)
      if (!preview) {
        throw new DaemonCommandError(
          'not-found',
          'This rewind preview expired.',
        )
      }
      if (mode !== 'code-and-conversation') {
        return unsupported('rewinding the conversation without the code')
      }
      await command('rewind', {
        sessionId: preview.sessionId,
        turnId: preview.turnId,
      })
      previews.delete(previewId)
      return {
        checkpointId: preview.checkpointId,
        editedPrompt: preview.prompt,
        mode,
        sessionId: preview.sessionId,
        sourceSessionId: preview.sessionId,
      }
    },
    close: async (sessionId) => {
      await command('archive', { sessionId })
    },
    acceptFleetNode: () => unsupported('fleet nodes'),
  }
}
