// v2 adds required signed-release urgency to renderer snapshots.
export const UPDATE_SCHEMA_VERSION = 2

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
  urgency: 'critical' | 'normal' | null
}

export interface UpdateEvent {
  revision: number
  snapshot: UpdateSnapshot
}

/** The only durable OTA preferences the renderer may read or mutate. */
export interface UpdatePreferencesSnapshot {
  automaticDownloads: boolean
  healthDisclosureAcknowledged: boolean
  healthReportingEnabled: boolean
  revision: number
  snoozedUntil: string | null
}

export interface UpdatePreferencesInput {
  automaticDownloads?: boolean
  healthDisclosureAcknowledged?: boolean
  healthReportingEnabled?: boolean
  snoozedUntil?: string | null
}

export interface UpdatePreferencesEvent {
  revision: number
  snapshot: UpdatePreferencesSnapshot
}

/**
 * Reconciles preference events buffered while a renderer fetches its initial
 * snapshot. This follows the same subscribe-before-hydrate protocol as update
 * status, so duplicate, stale, and out-of-order IPC deliveries cannot roll a
 * renderer back to an older durable preference revision.
 */
export function reconcileUpdatePreferencesSnapshot(
  fetchedSnapshot: UpdatePreferencesSnapshot,
  bufferedEvents: readonly UpdatePreferencesEvent[],
): UpdatePreferencesSnapshot {
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

/** Durable, privacy-bounded preferences owned exclusively by the main process. */
export interface UpdateState {
  automaticDownloads: boolean
  healthDisclosureAcknowledged: boolean
  healthReportingEnabled: boolean
  installationId: string
  lastCheckedAt: string | null
  pendingAttemptId: string | null
  pendingTargetVersion: string | null
  snoozedUntil: string | null
}

export type UpdateHealthLifecycle =
  | 'check-failed'
  | 'check-started'
  | 'downloaded'
  | 'download-failed'
  | 'download-started'
  | 'install-failed'
  | 'install-started'
  | 'install-succeeded'

export interface UpdateHealthEvent {
  arch: 'arm64' | 'x64'
  attemptId: string
  cohort: number
  createdAt: string
  currentVersion: string
  durationMs: number | null
  errorCode: UpdateErrorCode | null
  lifecycle: UpdateHealthLifecycle
  platform: 'darwin' | 'linux'
  targetVersion: string | null
}

export interface UpdateRestartStatus {
  activeTerminalSessions: number
  activeWorkspaceSetups: number
  confirmationRequired: boolean
  restarting: boolean
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
