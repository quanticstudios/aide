import type { TurnCheckpointPreview } from '../../../shared/checkpoints'
import { DAEMON_PROTOCOL, type PitwallStatus } from '../../../shared/ipc'
import {
  type ManagedSessionDecision,
  type ManagedSessionSnapshot,
  readPlanText,
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
import type { PlanUsage } from './plan-usage'
import type { SessionTransport } from './session-transport'

export { DAEMON_PROTOCOL }
export const DAEMON_RECONNECT_MIN_MS = 500
export const DAEMON_RECONNECT_MAX_MS = 10_000

export type DaemonConnection =
  | { readonly status: 'connecting' }
  | { readonly status: 'connected'; readonly server: string }
  | { readonly status: 'reconnecting'; readonly reason: string }
  | { readonly status: 'incompatible'; readonly message: string }
  /** Main found no pitwall, one too old, or one with no web endpoint; the transport keeps checking. */
  | {
      readonly status: 'unavailable'
      readonly pitwall: Exclude<PitwallStatus, { status: 'ready' }>
    }

/** A `SessionTransport` over pitwall's web protocol, plus the connection state the banner shows. */
export interface DaemonTransport extends SessionTransport {
  getConnection: () => DaemonConnection
  subscribeConnection: (listener: () => void) => () => void
  /** Looks for pitwall now instead of at the next retry. */
  checkAgain: () => void
  dispose: () => void
  /** The pull request of the session's tab as pitwall's poll last saw it, null for none; current while `subscribeSessionList` has a listener. */
  getPullRequest: (sessionId: string) => DaemonPullRequest | null
  /** The unresolved review threads and standing change requests of the session's pull request. */
  reviewThreads: (sessionId: string) => Promise<DaemonReviewThreads>
  /** pitwall's capped message asking the agent to fix the failed checks or address the review; empty when there is nothing to send. */
  pullRequestPrompt: (
    sessionId: string,
    what: 'failures' | 'review',
  ) => Promise<string>
  /** Merges the session's pull request by pitwall's `[git] merge_method`. */
  mergePullRequest: (sessionId: string) => Promise<void>
  /** pitwall's plan limits and token use over the `days` days ending today, 30 when left out. */
  readUsage: (days?: number) => Promise<PlanUsage>
  /** The repos pitwall has tabs in, for starting a chat in one. */
  listProjects: () => Promise<DaemonProject[]>
}

/** pitwall's `pr` on a chat's list entry (web-protocol.md, Pull requests). */
export interface DaemonPullRequest {
  readonly checks: readonly {
    readonly name: string
    readonly state: '' | 'fail' | 'pass' | 'pending' | 'skip'
  }[]
  readonly conflicts: boolean
  readonly detail: string
  readonly draft: boolean
  readonly head: string
  readonly number: number
  readonly reason: string
  readonly review: '' | 'approved' | 'changes' | 'required'
  readonly state: 'closed' | 'merged' | 'open'
  readonly url: string
}

export interface DaemonReviewComment {
  readonly author: string
  readonly body: string
}

export interface DaemonReviewThread {
  readonly comments: readonly DaemonReviewComment[]
  /** The line on the branch's version of the file; 0 for a comment on the whole file. */
  readonly line: number
  readonly more: number
  readonly path: string
}

export interface DaemonReviewThreads {
  readonly changeRequests: readonly DaemonReviewComment[]
  readonly threads: readonly DaemonReviewThread[]
}

export interface DaemonTransportOptions {
  /** Keeps the chat id pitwall picked for each session aide started, so a pane finds its chat after a restart. */
  readonly chatIds?: {
    load: () => Record<string, string>
    save: (chatIds: Record<string, string>) => void
  }
  /** The hello name; pitwall gates the chats an `aide` client starts with the Jev settings aide's main process hands over. */
  readonly clientName?: string
  readonly clientVersion: string
  readonly createSocket?: (url: string) => WebSocket
  /** Asks Electron main to find pitwall and its daemon, starting one if none runs; called before every connect, since a restarted daemon may listen on a new port. */
  readonly getEndpoint: () => Promise<PitwallStatus>
  /** aide's workspaces and their folders; a chat is this aide's when its pitwall workspace has the same folder. */
  readonly getWorkspaces: () => Promise<readonly { id: string; path: string }[]>
  /** Opens aide's session in its pane, as main's `taskOpen` does after it starts one. */
  readonly openTask: (sessionId: string) => Promise<void>
  /** aide's own task library: its notification settings, and the attention and read state of every chat reported to it. */
  readonly aideTasks: Pick<SessionTransport, 'listSessions' | 'updateSession'>
  /** Hands Electron main each snapshot of a chat in one of aide's panes under aide's ids, or null once it is gone, so the sidebar, notifications and badge cover it. */
  readonly reportSession?: (
    sessionId: string,
    snapshot: ManagedSessionSnapshot | null,
  ) => void
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
  recentPrompt?: string
  id: string
  pending: number
  pr?: DaemonPullRequest
  provider: string
  state: string
  title: string
  turns: number
  updatedAt: string
  workspaceId: string
}

/** A repo with tabs in pitwall (web-protocol.md, listProjects). */
export interface DaemonProject {
  name: string
  root: string
  workspaces: { branch: string; id: string; label: string; path: string }[]
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
  | { type: 'sessions'; chats: DaemonChat[] }
  | { type: 'sessionsChanged'; changed: DaemonChat[]; removed: string[] }

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
  /** The session list as pitwall last pushed it, by chat id. */
  const chats = new Map<string, DaemonChat>()
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
  // shortcut: entries are never dropped; prune archived chats once pitwall lists them.
  const chatIds = new Map(Object.entries(options.chatIds?.load() ?? {}))

  /** pitwall's id for a session: the chat it started for aide's id, else the id itself. */
  function chatId(sessionId: string): string {
    return chatIds.get(sessionId) ?? sessionId
  }

  function setConnection(next: DaemonConnection): void {
    connection = next
    for (const listener of connectionListeners) listener()
  }

  async function connect(): Promise<void> {
    timer = null
    const found = await options.getEndpoint().catch(() => null)
    if (disposed) return
    if (!found) {
      retry('pitwall is not running')
      return
    }
    if (found.status !== 'ready') {
      setConnection({ status: 'unavailable', pitwall: found })
      schedule()
      return
    }
    const { endpoint } = found
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
          client: {
            name: options.clientName ?? 'aide',
            version: options.clientVersion,
          },
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
    schedule()
  }

  function schedule(): void {
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
        if (message.type === 'sessions') chats.clear()
        for (const chat of message.type === 'sessions'
          ? message.chats
          : message.changed) {
          chats.set(chat.id, chat)
        }
        if (message.type === 'sessionsChanged') {
          for (const id of message.removed) chats.delete(id)
        }
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
    const message: Record<string, unknown> = { ...fields, type, id }
    if (typeof fields.sessionId === 'string') {
      message.sessionId = chatId(fields.sessionId)
    }
    return new Promise((resolve, reject) => {
      pending.set(id, { reject, resolve: (data) => resolve(data as T) })
      ws.send(JSON.stringify(message))
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
    report(sessionId, snapshot)
  }

  function removed(sessionId: string): void {
    const entry = sessions.get(sessionId)
    if (!entry) return
    entry.state = null
    for (const listener of entry.listeners) listener({ type: 'removed' })
    report(sessionId, null)
  }

  /** Reports a chat to main under the `<workspace id>:<pane id>` session id of its aide pane; a chat with no pane yet is not reported. */
  function report(chat: string, snapshot: ManagedSessionSnapshot | null) {
    const id = paneIds().get(chat)
    const colon = id?.indexOf(':') ?? -1
    if (!id || colon < 0) return
    options.reportSession?.(
      id,
      snapshot && {
        ...snapshot,
        // why: main reads only the first prompt, for the thread's name; the whole transcript would cross IPC on every delta.
        content: snapshot.content
          .filter((item) => item.kind === 'user-prompt')
          .slice(0, 1),
        sessionId: id,
        workspaceId: id.slice(0, colon),
        paneId: id.slice(colon + 1),
      },
    )
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
    return (
      sessions.get(chatId(sessionId))?.state?.snapshot ??
      readSnapshot(sessionId)
    )
  }

  /**
   * pitwall's workspace id to aide's, for every pitwall workspace whose folder is one of aide's.
   * @remarks shortcut: compares the paths as both report them; normalize them if a symlinked or trailing-slash path ever misses.
   */
  function workspaceIds(
    projects: DaemonProject[],
    aide: readonly { id: string; path: string }[],
  ): Map<string, string> {
    const byPath = new Map(
      aide.map((workspace) => [workspace.path, workspace.id]),
    )
    const ids = new Map<string, string>()
    for (const project of projects) {
      for (const workspace of project.workspaces) {
        const id = byPath.get(workspace.path)
        if (id) ids.set(workspace.id, id)
      }
    }
    return ids
  }

  /** aide's id for a chat: the pane it was started for, else the chat id. */
  function paneIds(): Map<string, string> {
    return new Map([...chatIds].map(([sessionId, chat]) => [chat, sessionId]))
  }

  /** The pane of aide's session id, which aide builds as `<workspace id>:<pane id>`. */
  function paneOf(sessionId: string, workspaceId: string): string {
    const prefix = `${workspaceId}:`
    return sessionId.startsWith(prefix)
      ? sessionId.slice(prefix.length)
      : sessionId
  }

  async function listSessions(query?: string): Promise<TaskLibrarySnapshot> {
    const [live, archived, projects, aideLibrary, aideWorkspaces] =
      await Promise.all([
        command<{ chats: DaemonChat[] }>('listSessions'),
        // why: pitwall answers `unsupported` for archived chats until it lists them (CHANGELOG, web clients).
        command<{ chats: DaemonChat[] }>('listSessions', {
          archived: true,
        }).catch((error) => {
          if (
            error instanceof DaemonCommandError &&
            error.code === 'unsupported'
          )
            return { chats: [] }
          throw error
        }),
        command<{ projects: DaemonProject[] }>('listProjects').catch(() => ({
          projects: [],
        })),
        options.aideTasks.listSessions(),
        options.getWorkspaces(),
      ])
    const aideIds = workspaceIds(projects.projects, aideWorkspaces)
    const aideTasks = new Map(
      aideLibrary.tasks.map((task) => [task.sessionId, task]),
    )
    const panes = paneIds()
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
        const aideWorkspaceId = aideIds.get(chat.workspaceId)
        let id = panes.get(chat.id)
        if (!id && aideWorkspaceId) {
          // why: a chat started outside aide gets an Agent pane of its own, so opening it shows the chat instead of starting one.
          id = `${aideWorkspaceId}:agent::copy-pitwall-${chat.id}`
          chatIds.set(id, chat.id)
          options.chatIds?.save(Object.fromEntries(chatIds))
        }
        id ??= chat.id
        const workspaceId = aideWorkspaceId ?? chat.workspaceId
        const own = aideTasks.get(id)
        // why: aide opens a task in its own workspace and pane, so pitwall's ids would not find either.
        tasks.set(chat.id, {
          sessionId: id,
          paneId: paneOf(id, workspaceId),
          workspaceId,
          projectName: workspace?.project ?? '',
          workspaceName: workspace?.label ?? '',
          branchName: workspace?.branch ?? '',
          title: chat.title,
          updatedAt: chat.updatedAt,
          provider: chat.provider,
          status: own?.status ?? toTaskStatus(chat),
          activityKey: own?.activityKey ?? null,
          unread: own?.unread ?? false,
          excerpt: chat.recentPrompt ?? '',
          recentPrompt: chat.recentPrompt,
          pinned: false,
          archived: isArchived,
          readActivityKey: own?.readActivityKey ?? null,
        })
      }
    }
    const needle = query?.trim().toLowerCase()
    return {
      notificationsEnabled: aideLibrary.notificationsEnabled,
      notificationSoundsEnabled: aideLibrary.notificationSoundsEnabled,
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
    checkAgain: () => {
      // No timer means a connect is under way.
      if (disposed || !timer) return
      clearTimeout(timer)
      attempt = 0
      setConnection({ status: 'connecting' })
      void connect()
    },
    dispose: () => {
      disposed = true
      for (const chat of sessions.keys()) report(chat, null)
      if (timer) clearTimeout(timer)
      socket?.close(1000)
    },
    readUsage: async (days) =>
      (
        await command<{ usage: PlanUsage }>(
          'readUsage',
          days === undefined ? {} : { days },
        )
      ).usage,

    getPullRequest: (sessionId) => chats.get(chatId(sessionId))?.pr ?? null,
    reviewThreads: (sessionId) =>
      command<DaemonReviewThreads>('reviewThreads', { sessionId }),
    pullRequestPrompt: async (sessionId, what) =>
      (await command<{ text: string }>('prPrompt', { sessionId, what })).text,
    mergePullRequest: async (sessionId) => {
      await command('mergePR', { sessionId })
    },

    listProjects: async () =>
      (await command<{ projects: DaemonProject[] }>('listProjects')).projects,
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
      // shortcut: title and pinned have no web command in v1 (web-protocol.md, Left open 2); they are dropped until pitwall adds them.
      if (input.archived !== undefined) {
        await command(input.archived ? 'archive' : 'unarchive', { sessionId })
      }
      // Read state is aide's: main keeps it for the chats reported to it, which are the only ones with an activity key.
      if (input.readActivityKey) {
        await options.aideTasks.updateSession(sessionId, {
          readActivityKey: input.readActivityKey,
        })
      }
      return listSessions()
    },
    subscribeSession: (sessionId, listener) => {
      const key = chatId(sessionId)
      let entry = sessions.get(key)
      if (!entry) {
        entry = { listeners: new Set(), resyncing: false, state: null }
        sessions.set(key, entry)
        if (connection.status === 'connected') subscribe(key, 0)
      } else if (entry.state) {
        listener({ snapshot: entry.state.snapshot, type: 'snapshot' })
      }
      const { listeners } = entry
      listeners.add(listener)
      return () => {
        if (!listeners.delete(listener) || listeners.size > 0) return
        // why: start may have moved the entry to the chat pitwall picked.
        const current = chatId(sessionId)
        if (sessions.get(current)?.listeners !== listeners) return
        sessions.delete(current)
        report(current, null)
        void quietly('unsubscribe', { sessionId: current })
      }
    },
    getSessions: async () => {
      const [{ chats }, { projects }, aideWorkspaces] = await Promise.all([
        command<{ chats: DaemonChat[] }>('listSessions'),
        command<{ projects: DaemonProject[] }>('listProjects'),
        options.getWorkspaces(),
      ])
      // why: the built-in backend returns only aide's own sessions; a daemon also runs chats in folders aide never opened.
      const aideIds = workspaceIds(projects, aideWorkspaces)
      const panes = paneIds()
      const snapshots: Record<string, ManagedSessionSnapshot> = {}
      await Promise.all(
        chats.map(async (chat) => {
          const workspaceId = aideIds.get(chat.workspaceId)
          const snapshot = workspaceId && (await read(chat.id))?.snapshot
          if (!snapshot) return
          const id = panes.get(chat.id) ?? chat.id
          snapshots[id] = {
            ...snapshot,
            paneId: paneOf(id, workspaceId),
            workspaceId,
          }
        }),
      )
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
      if (sessionId !== config.sessionId) {
        chatIds.set(config.sessionId, sessionId)
        options.chatIds?.save(Object.fromEntries(chatIds))
        // The pane subscribed under its own id before the chat existed.
        const entry = sessions.get(config.sessionId)
        if (entry && !sessions.has(sessionId)) {
          sessions.delete(config.sessionId)
          sessions.set(sessionId, entry)
          subscribe(sessionId, 0)
        }
      }
      return readSnapshot(sessionId)
    },
    send: async (sessionId, text, _recipients, attachments) => {
      // aide's send steers a running turn; pitwall's default would queue it.
      const running = sessions.get(chatId(sessionId))?.state?.snapshot.running
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
    updateQueue: async (sessionId, action) => {
      await command('updateQueue', {
        sessionId,
        action: action.type,
        messageId: 'id' in action ? action.id : undefined,
        text: 'text' in action ? action.text : undefined,
        index: 'index' in action ? action.index : undefined,
      })
    },
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
    implementPlanInNewThread: async (sessionId, requestId) => {
      const source = await currentSnapshot(sessionId)
      const approval = source.pendingApprovals.find(
        (request) => request.id === requestId,
      )
      const plan =
        approval?.requestType === 'plan-approval'
          ? readPlanText(approval)
          : null
      if (!plan) {
        throw new DaemonCommandError(
          'not-found',
          'The plan is no longer pending.',
        )
      }
      const [{ projects }, aideWorkspaces] = await Promise.all([
        command<{ projects: DaemonProject[] }>('listProjects'),
        options.getWorkspaces(),
      ])
      const dir = projects
        .flatMap((project) => project.workspaces)
        .find((workspace) => workspace.id === source.workspaceId)?.path
      const workspaceId = aideWorkspaces.find(
        (workspace) => workspace.path === dir,
      )?.id
      if (!dir || !workspaceId) {
        throw new DaemonCommandError(
          'not-found',
          "The plan's workspace is not open in aide.",
        )
      }
      // Same ids as aide's built-in backend, so the new chat lists under its own pane.
      const paneId = `agent::copy-plan-${crypto.randomUUID()}`
      const { sessionId: chat } = await command<{ sessionId: string }>(
        'start',
        {
          dir,
          provider: source.provider,
          model: source.model ?? undefined,
          effort: source.effort ?? undefined,
          permissionMode: 'default',
        },
      )
      const newId = `${workspaceId}:${paneId}`
      chatIds.set(newId, chat)
      options.chatIds?.save(Object.fromEntries(chatIds))
      await command('send', {
        sessionId: chat,
        text: `Implement this plan:\n\n${plan}`,
      })
      await command('resolveApproval', {
        sessionId,
        requestId,
        decision: DECISIONS.deny,
        reason:
          'The user is implementing this plan in a new thread. Stop here.',
      })
      await options.openTask(newId)
    },
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
      try {
        await command('archive', { sessionId })
      } catch (error) {
        // why: aide closes every pane through here, terminals too, and most have no chat.
        if (
          !(error instanceof DaemonCommandError && error.code === 'not-found')
        )
          throw error
      }
    },
    acceptFleetNode: () => unsupported('fleet nodes'),
  }
}
