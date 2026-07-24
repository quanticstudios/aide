export const UPDATE_SCHEMA_VERSION = 1

export type UpdateCapability =
  | 'supported'
  | 'development'
  | 'manual-only'
  | 'unsupported-platform'

export type UpdatePhase =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'failed'

export type UpdateErrorCode =
  | 'disk-space'
  | 'invalid-update'
  | 'network'
  | 'unknown'

export interface UpdateProgress {
  percent: number
  total: number
  transferred: number
}

export interface UpdateSnapshot {
  capability: UpdateCapability
  currentVersion: string
  errorCode: UpdateErrorCode | null
  lastCheckedAt: string | null
  phase: UpdatePhase
  progress: UpdateProgress | null
  revision: number
  schemaVersion: typeof UPDATE_SCHEMA_VERSION
  targetVersion: string | null
}

export interface UpdateEvent {
  revision: number
  snapshot: UpdateSnapshot
}

/**
 * Reconciles a subscribe-before-hydrate sequence without mutating either input.
 * Events are already ordered by arrival; a later revision wins and duplicate,
 * stale, or internally inconsistent events are ignored.
 */
export function reconcileUpdateSnapshot(
  fetchedSnapshot: UpdateSnapshot,
  bufferedEvents: readonly UpdateEvent[],
): UpdateSnapshot {
  let reconciledSnapshot = fetchedSnapshot

  for (const event of bufferedEvents) {
    if (
      event.revision <= reconciledSnapshot.revision ||
      event.snapshot.revision !== event.revision
    ) {
      continue
    }
    reconciledSnapshot = event.snapshot
  }

  return reconciledSnapshot
}
