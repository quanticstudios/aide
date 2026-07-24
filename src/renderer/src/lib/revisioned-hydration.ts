export interface RevisionedHydrationOptions<Snapshot, Event> {
  readonly clearTimeout?: (timer: ReturnType<typeof setTimeout>) => void
  readonly fetchSnapshot: () => Promise<Snapshot>
  readonly onError: (error: unknown) => void
  readonly onSnapshot: (snapshot: Snapshot) => void
  readonly reconcile: (snapshot: Snapshot, events: readonly Event[]) => Snapshot
  readonly retryDelayMs?: (attempt: number) => number
  readonly setTimeout?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>
  readonly subscribe: (listener: (event: Event) => void) => () => void
}

/**
 * Owns the subscribe-before-fetch ordering shared by main-process revisioned
 * streams. Events received during the fetch are buffered and reconciled before
 * the first snapshot reaches React.
 */
export function hydrateRevisionedState<Snapshot, Event>({
  clearTimeout = globalThis.clearTimeout,
  fetchSnapshot,
  onError,
  onSnapshot,
  reconcile,
  retryDelayMs = (attempt) => Math.min(5_000, 250 * 2 ** (attempt - 1)),
  setTimeout = globalThis.setTimeout,
  subscribe,
}: RevisionedHydrationOptions<Snapshot, Event>): () => void {
  let active = true
  let hydrating = true
  let currentSnapshot: Snapshot | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const bufferedEvents: Event[] = []

  const unsubscribe = subscribe((event) => {
    if (!active) return
    if (hydrating) {
      bufferedEvents.push(event)
      return
    }
    if (!currentSnapshot) return

    const nextSnapshot = reconcile(currentSnapshot, [event])
    if (nextSnapshot === currentSnapshot) return

    currentSnapshot = nextSnapshot
    onSnapshot(nextSnapshot)
  })

  const fetchWithRetry = (attempt: number): void => {
    let fetchPromise: Promise<Snapshot>
    try {
      fetchPromise = fetchSnapshot()
    } catch (error) {
      fetchPromise = Promise.reject(error)
    }

    void fetchPromise
      .then((snapshot) => {
        if (!active) return

        currentSnapshot = reconcile(snapshot, bufferedEvents)
        bufferedEvents.length = 0
        hydrating = false
        onSnapshot(currentSnapshot)
      })
      .catch((error: unknown) => {
        if (!active) return

        onError(error)
        retryTimer = setTimeout(
          () => {
            retryTimer = null
            if (active) fetchWithRetry(attempt + 1)
          },
          Math.max(0, retryDelayMs(attempt)),
        )
      })
  }

  fetchWithRetry(1)

  return () => {
    if (!active) return
    active = false
    bufferedEvents.length = 0
    if (retryTimer !== null) clearTimeout(retryTimer)
    retryTimer = null
    unsubscribe()
  }
}
