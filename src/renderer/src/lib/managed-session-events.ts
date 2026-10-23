import type { ManagedSessionIpcEvent } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import {
  applyDelta,
  type SessionDelta,
  SessionDeltaResyncError,
  type SessionDeltaState,
} from '../../../shared/session-delta'
import { isEqualValue } from './deep-equal'

export type ManagedSessionUpdate =
  | { readonly snapshot: ManagedSessionSnapshot; readonly type: 'snapshot' }
  | { readonly type: 'removed' }

type Listener = (update: ManagedSessionUpdate) => void

interface ManagedSessionEventSource {
  onManagedSessionEvent: (
    callback: (event: ManagedSessionIpcEvent) => void,
  ) => () => void
  syncManagedSession: (sessionId: string) => Promise<SessionDeltaState | null>
}

interface SessionEntry {
  readonly listeners: Set<Listener>
  state: SessionDeltaState | null
  /** The outstanding snapshot request and the deltas that arrived while it was in flight. */
  sync: {
    readonly buffered: SessionDelta[]
    readonly timer: ReturnType<typeof setTimeout>
  } | null
}

interface Hub {
  readonly sessions: Map<string, SessionEntry>
  unsubscribe: (() => void) | null
}

/** How long a snapshot request may stay unanswered before the hub asks again. */
export const MANAGED_SESSION_SYNC_TIMEOUT_MS = 5_000
/** How many deltas the hub holds for an unanswered snapshot request before it asks again. */
export const MANAGED_SESSION_SYNC_BUFFER_LIMIT = 2_000

const hubs = new WeakMap<ManagedSessionEventSource, Hub>()

/** Returns `next` with every content item that equals one in `previous` replaced by the previous object. */
export function shareSnapshotContent(
  previous: ManagedSessionSnapshot | undefined,
  next: ManagedSessionSnapshot,
): ManagedSessionSnapshot {
  if (!previous) return next
  const previousItems = new Map<string, ManagedSessionContentItem>()
  for (const item of previous.content) previousItems.set(item.id, item)

  let reusedAll = previous.content.length === next.content.length
  const content = next.content.map((item, index) => {
    const previousItem = previousItems.get(item.id)
    const shared =
      previousItem && isEqualValue(previousItem, item) ? previousItem : item
    if (shared !== previous.content[index]) reusedAll = false
    return shared
  })

  return { ...next, content: reusedAll ? previous.content : content }
}

function getHub(source: ManagedSessionEventSource): Hub {
  let hub = hubs.get(source)
  if (!hub) {
    hub = { sessions: new Map(), unsubscribe: null }
    hubs.set(source, hub)
  }
  return hub
}

function publish(
  entry: SessionEntry,
  state: SessionDeltaState,
  replaced: boolean,
): void {
  const snapshot = replaced
    ? shareSnapshotContent(entry.state?.snapshot, state.snapshot)
    : state.snapshot
  entry.state = { seq: state.seq, snapshot }
  for (const listener of entry.listeners) {
    listener({ snapshot, type: 'snapshot' })
  }
}

function apply(
  source: ManagedSessionEventSource,
  hub: Hub,
  sessionId: string,
  entry: SessionEntry,
  base: SessionDeltaState | null,
  deltas: readonly SessionDelta[],
  replacedBase: boolean,
): void {
  let state = base
  let replaced = replacedBase
  try {
    for (const delta of deltas) {
      if (state && delta.seq <= state.seq) continue
      state = applyDelta(state, delta)
      if (delta.type === 'snapshot') replaced = true
    }
  } catch (error) {
    if (!(error instanceof SessionDeltaResyncError)) throw error
    resync(source, hub, sessionId, entry)
    return
  }
  if (state && state !== entry.state) publish(entry, state, replaced)
}

function resync(
  source: ManagedSessionEventSource,
  hub: Hub,
  sessionId: string,
  entry: SessionEntry,
): void {
  if (entry.sync) return
  const sync = {
    buffered: [] as SessionDelta[],
    timer: setTimeout(() => {
      if (hub.sessions.get(sessionId) !== entry || entry.sync !== sync) return
      restartSync(source, hub, sessionId, entry)
    }, MANAGED_SESSION_SYNC_TIMEOUT_MS),
  }
  entry.sync = sync
  void source
    .syncManagedSession(sessionId)
    .catch(() => null)
    .then((reply) => {
      if (hub.sessions.get(sessionId) !== entry || entry.sync !== sync) return
      clearTimeout(sync.timer)
      entry.sync = null
      const fresher = reply !== null && reply.seq > (entry.state?.seq ?? 0)
      apply(
        source,
        hub,
        sessionId,
        entry,
        fresher ? reply : entry.state,
        sync.buffered,
        fresher,
      )
    })
}

/** Abandons the outstanding snapshot request and its buffered deltas, then asks again. */
function restartSync(
  source: ManagedSessionEventSource,
  hub: Hub,
  sessionId: string,
  entry: SessionEntry,
): void {
  cancelSync(entry)
  resync(source, hub, sessionId, entry)
}

function cancelSync(entry: SessionEntry): void {
  if (entry.sync) clearTimeout(entry.sync.timer)
  entry.sync = null
}

function dispatch(
  source: ManagedSessionEventSource,
  hub: Hub,
  event: ManagedSessionIpcEvent,
): void {
  const entry = hub.sessions.get(event.sessionId)
  if (!entry) return
  if (event.type === 'removed') {
    entry.state = null
    cancelSync(entry)
    for (const listener of entry.listeners) listener({ type: 'removed' })
    return
  }
  if (entry.sync) {
    if (
      entry.sync.buffered.length + event.deltas.length >
      MANAGED_SESSION_SYNC_BUFFER_LIMIT
    ) {
      restartSync(source, hub, event.sessionId, entry)
    } else {
      entry.sync.buffered.push(...event.deltas)
    }
    return
  }
  apply(source, hub, event.sessionId, entry, entry.state, event.deltas, false)
}

/**
 * Subscribes `listener` to one session's snapshots, rebuilt from deltas over a single shared IPC subscription.
 * @remarks The first listener for a session fetches a snapshot from main, and a seq gap fetches a fresh one; deltas that arrive meanwhile apply on top of it.
 */
export function subscribeManagedSession(
  source: ManagedSessionEventSource,
  sessionId: string,
  listener: Listener,
): () => void {
  const hub = getHub(source)
  hub.unsubscribe ??= source.onManagedSessionEvent((event) =>
    dispatch(source, hub, event),
  )
  let entry = hub.sessions.get(sessionId)
  if (!entry) {
    entry = { listeners: new Set(), state: null, sync: null }
    hub.sessions.set(sessionId, entry)
    resync(source, hub, sessionId, entry)
  }
  const { listeners } = entry
  listeners.add(listener)

  return () => {
    if (!listeners.delete(listener)) return
    const current = hub.sessions.get(sessionId)
    if (listeners.size === 0 && current?.listeners === listeners) {
      cancelSync(current)
      hub.sessions.delete(sessionId)
    }
    if (hub.sessions.size === 0) {
      hub.unsubscribe?.()
      hub.unsubscribe = null
    }
  }
}
