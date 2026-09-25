import type {
  ManagedSessionContentItem,
  ManagedSessionEvent,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import { isEqualValue } from './deep-equal'

export type ManagedSessionUpdate =
  | { readonly snapshot: ManagedSessionSnapshot; readonly type: 'snapshot' }
  | { readonly type: 'removed' }

type Listener = (update: ManagedSessionUpdate) => void

interface ManagedSessionEventSource {
  onManagedSessionEvent: (
    callback: (event: ManagedSessionEvent) => void,
  ) => () => void
}

interface Hub {
  readonly lastSnapshots: Map<string, ManagedSessionSnapshot>
  readonly listeners: Map<string, Set<Listener>>
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
    hub = { lastSnapshots: new Map(), listeners: new Map(), unsubscribe: null }
    hubs.set(source, hub)
  }
  return hub
}

function dispatch(hub: Hub, event: ManagedSessionEvent): void {
  if (event.type === 'removed') {
    hub.lastSnapshots.delete(event.sessionId)
    for (const listener of hub.listeners.get(event.sessionId) ?? []) {
      listener({ type: 'removed' })
    }
    return
  }

  const { sessionId } = event.snapshot
  const snapshot = shareSnapshotContent(
    hub.lastSnapshots.get(sessionId),
    event.snapshot,
  )
  hub.lastSnapshots.set(sessionId, snapshot)
  for (const listener of hub.listeners.get(sessionId) ?? []) {
    listener({ snapshot, type: 'snapshot' })
  }
}

/**
 * Subscribes `listener` to one session's events through a single shared IPC subscription.
 * @remarks Each IPC callback deep-copies its payload across the context bridge, so one subscription per window keeps a snapshot to one copy.
 */
export function subscribeManagedSession(
  source: ManagedSessionEventSource,
  sessionId: string,
  listener: Listener,
): () => void {
  const hub = getHub(source)
  let listeners = hub.listeners.get(sessionId)
  if (!listeners) {
    listeners = new Set()
    hub.listeners.set(sessionId, listeners)
  }
  listeners.add(listener)
  hub.unsubscribe ??= source.onManagedSessionEvent((event) =>
    dispatch(hub, event),
  )

  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) hub.listeners.delete(sessionId)
    if (hub.listeners.size === 0) {
      hub.unsubscribe?.()
      hub.unsubscribe = null
      hub.lastSnapshots.clear()
    }
  }
}
