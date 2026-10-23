import type { ManagedSessionIpcEvent } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import {
  applyDelta,
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
  syncing: boolean
}

interface Hub {
  readonly sessions: Map<string, SessionEntry>
  unsubscribe: (() => void) | null
}

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

function resync(
  source: ManagedSessionEventSource,
  hub: Hub,
  sessionId: string,
  entry: SessionEntry,
): void {
  if (entry.syncing) return
  entry.syncing = true
  void source
    .syncManagedSession(sessionId)
    .catch(() => null)
    .then((state) => {
      if (hub.sessions.get(sessionId) !== entry) return
      entry.syncing = false
      if (state && state.seq > (entry.state?.seq ?? 0)) {
        publish(entry, state, true)
      }
    })
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
    for (const listener of entry.listeners) listener({ type: 'removed' })
    return
  }

  let state = entry.state
  let replaced = false
  try {
    for (const delta of event.deltas) {
      if (state && delta.seq <= state.seq) continue
      state = applyDelta(state, delta)
      if (delta.type === 'snapshot') replaced = true
    }
  } catch (error) {
    if (!(error instanceof SessionDeltaResyncError)) throw error
    resync(source, hub, event.sessionId, entry)
    return
  }
  if (state && state !== entry.state) publish(entry, state, replaced)
}

/**
 * Subscribes `listener` to one session's snapshots, rebuilt from deltas over a single shared IPC subscription.
 * @remarks The first listener for a session fetches a snapshot from main; a seq gap fetches a fresh one.
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
    entry = { listeners: new Set(), state: null, syncing: false }
    hub.sessions.set(sessionId, entry)
    resync(source, hub, sessionId, entry)
  }
  const { listeners } = entry
  listeners.add(listener)

  return () => {
    if (!listeners.delete(listener)) return
    if (
      listeners.size === 0 &&
      hub.sessions.get(sessionId)?.listeners === listeners
    ) {
      hub.sessions.delete(sessionId)
    }
    if (hub.sessions.size === 0) {
      hub.unsubscribe?.()
      hub.unsubscribe = null
    }
  }
}
