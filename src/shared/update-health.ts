import type {
  UpdateErrorCode,
  UpdateHealthEvent,
  UpdateHealthLifecycle,
} from './update'

export const UPDATE_HEALTH_BATCH_SCHEMA_VERSION = 1
export const MAX_UPDATE_HEALTH_BATCH_EVENTS = 20
export const MAX_UPDATE_HEALTH_BATCH_BYTES = 32 * 1024
export const MAX_UPDATE_HEALTH_DURATION_MS = 7 * 24 * 60 * 60 * 1_000
export const UPDATE_HEALTH_DURATION_BUCKETS_MS = Object.freeze([
  1_000,
  5_000,
  15_000,
  30_000,
  60_000,
  5 * 60_000,
  15 * 60_000,
  60 * 60_000,
  6 * 60 * 60_000,
  24 * 60 * 60_000,
  3 * 24 * 60 * 60_000,
  MAX_UPDATE_HEALTH_DURATION_MS,
])

export interface UpdateHealthBatch {
  events: readonly UpdateHealthEvent[]
  schemaVersion: typeof UPDATE_HEALTH_BATCH_SCHEMA_VERSION
}

const stableSemver = /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/
const coarseIsoTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/
const durationBuckets = new Set<number>(UPDATE_HEALTH_DURATION_BUCKETS_MS)
const lifecycles = new Set<UpdateHealthLifecycle>([
  'check-failed',
  'check-started',
  'downloaded',
  'download-failed',
  'download-started',
  'install-failed',
  'install-started',
  'install-succeeded',
])
const errorCodes = new Set<UpdateErrorCode | null>([
  'disk-space',
  'invalid-update',
  'network',
  'unknown',
  null,
])

function invalid(): never {
  throw new Error('Invalid update health batch.')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  return (
    actual.length === expected.length &&
    actual.every((key, index) => key === expected[index])
  )
}

function parseEvent(value: unknown, now: Date): UpdateHealthEvent {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      'arch',
      'attemptId',
      'cohort',
      'createdAt',
      'currentVersion',
      'durationMs',
      'errorCode',
      'lifecycle',
      'platform',
      'targetVersion',
    ]) ||
    typeof value.attemptId !== 'string' ||
    !/^[a-zA-Z0-9._-]{1,128}$/.test(value.attemptId) ||
    typeof value.currentVersion !== 'string' ||
    !stableSemver.test(value.currentVersion) ||
    (value.targetVersion !== null &&
      (typeof value.targetVersion !== 'string' ||
        !stableSemver.test(value.targetVersion))) ||
    (value.platform !== 'darwin' && value.platform !== 'linux') ||
    (value.arch !== 'arm64' && value.arch !== 'x64') ||
    typeof value.cohort !== 'number' ||
    !Number.isInteger(value.cohort) ||
    value.cohort < 0 ||
    value.cohort >= 100 ||
    typeof value.createdAt !== 'string' ||
    !coarseIsoTimestamp.test(value.createdAt) ||
    new Date(value.createdAt).toISOString() !== value.createdAt ||
    new Date(value.createdAt).getTime() >= now.getTime() + 5 * 60 * 1_000 ||
    !lifecycles.has(value.lifecycle as UpdateHealthLifecycle) ||
    !errorCodes.has(value.errorCode as UpdateErrorCode | null) ||
    (value.durationMs !== null &&
      (typeof value.durationMs !== 'number' ||
        !Number.isSafeInteger(value.durationMs) ||
        !durationBuckets.has(value.durationMs)))
  ) {
    invalid()
  }

  return {
    arch: value.arch,
    attemptId: value.attemptId,
    cohort: value.cohort,
    createdAt: value.createdAt,
    currentVersion: value.currentVersion,
    durationMs: value.durationMs,
    errorCode: value.errorCode as UpdateErrorCode | null,
    lifecycle: value.lifecycle as UpdateHealthLifecycle,
    platform: value.platform,
    targetVersion: value.targetVersion as string | null,
  }
}

export function coarsenUpdateHealthTimestamp(value: string): string {
  const timestamp = new Date(value)
  if (Number.isNaN(timestamp.getTime())) invalid()
  timestamp.setUTCSeconds(0, 0)
  return timestamp.toISOString()
}

export function bucketUpdateHealthDuration(
  value: number | null,
): number | null {
  if (value === null) return null
  if (!Number.isFinite(value) || value < 0) invalid()
  return (
    UPDATE_HEALTH_DURATION_BUCKETS_MS.find((boundary) => value <= boundary) ??
    MAX_UPDATE_HEALTH_DURATION_MS
  )
}

export function parseUpdateHealthBatch(
  value: unknown,
  now = new Date(),
): UpdateHealthBatch {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ['events', 'schemaVersion']) ||
    value.schemaVersion !== UPDATE_HEALTH_BATCH_SCHEMA_VERSION ||
    !Array.isArray(value.events) ||
    value.events.length === 0 ||
    value.events.length > MAX_UPDATE_HEALTH_BATCH_EVENTS
  ) {
    invalid()
  }

  return {
    events: value.events.map((event) => parseEvent(event, now)),
    schemaVersion: UPDATE_HEALTH_BATCH_SCHEMA_VERSION,
  }
}
