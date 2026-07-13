export const DIAGNOSTICS_SCHEMA_VERSION = 1

export const DIAGNOSTIC_EVENT_TYPES = [
  'main-uncaught-exception',
  'main-unhandled-rejection',
  'renderer-crashed',
  'renderer-exception',
  'renderer-unhandled-rejection',
] as const

export type DiagnosticEventType = (typeof DIAGNOSTIC_EVENT_TYPES)[number]

export interface DiagnosticEvent {
  readonly occurredAt: string
  readonly type: DiagnosticEventType
}

export interface DiagnosticsRuntime {
  readonly appName: string
  readonly appVersion: string
  readonly arch: string
  readonly chromeVersion: string
  readonly electronVersion: string
  readonly nodeVersion: string
  readonly platform: string
}

export interface DiagnosticsSnapshot {
  readonly generatedAt: string
  readonly recentEvents: readonly DiagnosticEvent[]
  readonly revision: number
  readonly runtime: DiagnosticsRuntime
  readonly version: typeof DIAGNOSTICS_SCHEMA_VERSION
}

export interface SupportBundleFile {
  readonly contents: string
  readonly name: 'diagnostics.json' | 'events.jsonl'
}

export interface SupportBundleExportResult {
  readonly status: 'cancelled' | 'exported'
}

const PLATFORM_VALUES = new Set([
  'aix',
  'android',
  'darwin',
  'freebsd',
  'haiku',
  'linux',
  'openbsd',
  'sunos',
  'win32',
  'cygwin',
  'netbsd',
])
const ARCH_VALUES = new Set([
  'arm',
  'arm64',
  'ia32',
  'loong64',
  'mips',
  'mipsel',
  'ppc',
  'ppc64',
  'riscv64',
  's390',
  's390x',
  'x64',
])
const EVENT_TYPES = new Set<string>(DIAGNOSTIC_EVENT_TYPES)
const VERSION_PATTERN = /^\d+(?:\.\d+){0,3}(?:[-+][0-9A-Za-z.-]+)?$/
const APP_NAME_PATTERN = /^[A-Za-z0-9 ._-]{1,80}$/

export function isDiagnosticEventType(
  value: unknown,
): value is DiagnosticEventType {
  return typeof value === 'string' && EVENT_TYPES.has(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return null
  }

  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value
    ? null
    : value
}

function safeVersion(value: unknown): string | null {
  return typeof value === 'string' && VERSION_PATTERN.test(value) ? value : null
}

function safeAppName(value: unknown): string | null {
  return typeof value === 'string' && APP_NAME_PATTERN.test(value)
    ? value
    : null
}

function sanitizeEvent(value: unknown): DiagnosticEvent | null {
  if (!isRecord(value)) {
    return null
  }

  const occurredAt = safeIsoTimestamp(value.occurredAt)
  const type = value.type

  if (!occurredAt || !isDiagnosticEventType(type)) {
    return null
  }

  return { occurredAt, type }
}

function sanitizeRuntime(value: unknown): DiagnosticsRuntime {
  const runtime = isRecord(value) ? value : {}
  const platform = runtime.platform
  const arch = runtime.arch

  return {
    appName: safeAppName(runtime.appName) ?? 'aide',
    appVersion: safeVersion(runtime.appVersion) ?? 'unknown',
    arch: typeof arch === 'string' && ARCH_VALUES.has(arch) ? arch : 'unknown',
    chromeVersion: safeVersion(runtime.chromeVersion) ?? 'unknown',
    electronVersion: safeVersion(runtime.electronVersion) ?? 'unknown',
    nodeVersion: safeVersion(runtime.nodeVersion) ?? 'unknown',
    platform:
      typeof platform === 'string' && PLATFORM_VALUES.has(platform)
        ? platform
        : 'unknown',
  }
}

/**
 * Converts an unknown value to the only diagnostics representation that may be
 * persisted or exported. Values not listed in this schema are discarded.
 */
export function sanitizeDiagnosticsSnapshot(
  value: unknown,
): DiagnosticsSnapshot {
  const snapshot = isRecord(value) ? value : {}
  const recentEvents = Array.isArray(snapshot.recentEvents)
    ? snapshot.recentEvents
        .map(sanitizeEvent)
        .filter((event): event is DiagnosticEvent => event !== null)
        .slice(-25)
    : []
  const revision = snapshot.revision

  return {
    generatedAt:
      safeIsoTimestamp(snapshot.generatedAt) ?? new Date(0).toISOString(),
    recentEvents,
    revision:
      typeof revision === 'number' &&
      Number.isSafeInteger(revision) &&
      revision >= 0
        ? revision
        : 0,
    runtime: sanitizeRuntime(snapshot.runtime),
    version: DIAGNOSTICS_SCHEMA_VERSION,
  }
}

/**
 * Defines every byte that can enter a support bundle. In particular, this does
 * not accept log files, error objects, renderer payloads, or process state.
 */
export function createSupportBundleFiles(
  input: unknown,
): readonly SupportBundleFile[] {
  const snapshot = sanitizeDiagnosticsSnapshot(input)

  return [
    {
      contents: `${JSON.stringify(snapshot, null, 2)}\n`,
      name: 'diagnostics.json',
    },
    {
      contents:
        snapshot.recentEvents.length === 0
          ? ''
          : `${snapshot.recentEvents.map((event) => JSON.stringify(event)).join('\n')}\n`,
      name: 'events.jsonl',
    },
  ]
}
