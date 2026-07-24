import { readFile } from 'node:fs/promises'

const STABLE_SEMVER = /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/
const DOWNLOAD_OUTCOMES = new Set(['downloaded', 'download-failed'])
const INSTALL_OUTCOMES = new Set(['install-failed', 'install-succeeded'])
const LIFECYCLES = new Set([
  'check-failed',
  'check-started',
  'downloaded',
  'download-failed',
  'download-started',
  'install-failed',
  'install-started',
  'install-succeeded',
])
const ERROR_CODES = new Set([
  '',
  'disk-space',
  'invalid-update',
  'network',
  'unknown',
])
const AGGREGATE_KEYS = [
  'arch',
  'cohort',
  'current_version',
  'duration_count',
  'duration_sum_ms',
  'error_code',
  'event_count',
  'lifecycle',
  'observed_day',
  'platform',
  'target_version',
]

function fail(message) {
  throw new Error(message)
}

function parseArgs(args) {
  const values = new Map()
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]
    const value = args[index + 1]
    if (!key?.startsWith('--') || value === undefined || values.has(key)) {
      fail(
        'Usage: --input FILE --version VERSION --rollout 10|50|100 --window-start ISO --window-end ISO --min-observations N --max-failure-rate 0..1',
      )
    }
    values.set(key, value)
  }
  return values
}

function number(value, label, minimum, maximum) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    fail(`Invalid ${label}.`)
  }
  return parsed
}

function count(value, label) {
  const parsed = number(value, label, 0, Number.MAX_SAFE_INTEGER)
  if (!Number.isInteger(parsed)) fail(`Invalid ${label}.`)
  return parsed
}

function timestamp(value, label) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    fail(`Invalid ${label}.`)
  }
  return parsed
}

function aggregateRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    fail('Invalid aggregate row.')
  }
  const record = row
  const keys = Object.keys(record).sort()
  if (
    keys.length !== AGGREGATE_KEYS.length ||
    keys.some((key, index) => key !== AGGREGATE_KEYS[index]) ||
    typeof record.current_version !== 'string' ||
    !STABLE_SEMVER.test(record.current_version) ||
    typeof record.target_version !== 'string' ||
    (record.target_version !== '' &&
      !STABLE_SEMVER.test(record.target_version)) ||
    (record.platform !== 'darwin' && record.platform !== 'linux') ||
    (record.arch !== 'arm64' && record.arch !== 'x64') ||
    !Number.isInteger(record.cohort) ||
    record.cohort < 0 ||
    record.cohort >= 100 ||
    typeof record.lifecycle !== 'string' ||
    !LIFECYCLES.has(record.lifecycle) ||
    typeof record.error_code !== 'string' ||
    !ERROR_CODES.has(record.error_code)
  ) {
    fail('Invalid aggregate row.')
  }
  return {
    ...record,
    duration_count: count(record.duration_count, 'aggregate duration count'),
    duration_sum_ms: count(record.duration_sum_ms, 'aggregate duration sum'),
    event_count: count(record.event_count, 'aggregate event count'),
    observedAt: timestamp(record.observed_day, 'aggregate observed day'),
  }
}

export function evaluateGate(input, args, now = new Date()) {
  const values = parseArgs(args)
  const version = values.get('--version')
  if (!STABLE_SEMVER.test(version)) fail('Invalid version.')
  const rollout = number(values.get('--rollout'), 'rollout', 10, 100)
  if (![10, 50, 100].includes(rollout)) fail('Invalid rollout.')
  const start = timestamp(values.get('--window-start'), 'window start')
  const end = timestamp(values.get('--window-end'), 'window end')
  if (
    !start.toISOString().endsWith('T00:00:00.000Z') ||
    !end.toISOString().endsWith('T00:00:00.000Z')
  ) {
    fail('Health window endpoints must align to UTC day boundaries.')
  }
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    fail('Invalid current time.')
  }
  if (end.getTime() - start.getTime() < 24 * 60 * 60 * 1_000) {
    fail('The health window must cover at least 24 hours.')
  }
  if (end > now) fail('The health window has not elapsed.')
  const minObservations = number(
    values.get('--min-observations'),
    'minimum observations',
    1,
    Number.MAX_SAFE_INTEGER,
  )
  const maxFailureRate = number(
    values.get('--max-failure-rate'),
    'maximum failure rate',
    0,
    1,
  )
  if (!Array.isArray(input)) fail('Aggregate input must be an array.')

  let downloadFailures = 0
  let downloadObservations = 0
  let installFailures = 0
  let installObservations = 0
  for (const row of input) {
    const record = aggregateRow(row)
    if (
      record.target_version === version &&
      record.cohort >= 0 &&
      record.cohort < rollout &&
      record.observedAt >= start &&
      record.observedAt < end
    ) {
      if (DOWNLOAD_OUTCOMES.has(record.lifecycle)) {
        downloadObservations += record.event_count
        if (record.lifecycle === 'download-failed') {
          downloadFailures += record.event_count
        }
      }
      if (INSTALL_OUTCOMES.has(record.lifecycle)) {
        installObservations += record.event_count
        if (record.lifecycle === 'install-failed') {
          installFailures += record.event_count
        }
      }
    }
  }
  const stage = (failures, observations) => {
    const failureRate = observations === 0 ? 1 : failures / observations
    return {
      failureRate,
      failures,
      observations,
      passed: observations >= minObservations && failureRate <= maxFailureRate,
    }
  }
  const download = stage(downloadFailures, downloadObservations)
  const install = stage(installFailures, installObservations)
  return {
    minObservations,
    passed: download.passed && install.passed,
    rollout,
    stages: { download, install },
    version,
    windowEnd: end.toISOString(),
    windowStart: start.toISOString(),
  }
}

async function main() {
  const values = parseArgs(process.argv.slice(2))
  const file = values.get('--input')
  if (!file) fail('Missing --input.')
  const input = JSON.parse(await readFile(file, 'utf8'))
  const result = evaluateGate(
    input,
    process.argv
      .slice(2)
      .filter((value) => value !== '--input' && value !== file),
  )
  process.stdout.write(`${JSON.stringify(result)}\n`)
  if (!result.passed) process.exitCode = 1
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : 'Invalid OTA health gate.'}\n`,
    )
    process.exitCode = 1
  })
}
