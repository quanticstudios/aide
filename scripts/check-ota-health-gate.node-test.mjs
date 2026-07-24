import assert from 'node:assert/strict'
import test from 'node:test'

import { evaluateGate } from './check-ota-health-gate.mjs'

const args = [
  '--version',
  '0.2.1',
  '--rollout',
  '10',
  '--window-start',
  '2026-07-01T00:00:00.000Z',
  '--window-end',
  '2026-07-02T00:00:00.000Z',
  '--min-observations',
  '10',
  '--max-failure-rate',
  '0.1',
]

function replaceArg(source, key, value) {
  const next = [...source]
  next[next.indexOf(key) + 1] = value
  return next
}

function aggregate(overrides = {}) {
  return {
    arch: 'x64',
    cohort: 7,
    current_version: '0.2.0',
    duration_count: 0,
    duration_sum_ms: 0,
    error_code: '',
    event_count: 10,
    lifecycle: 'downloaded',
    observed_day: '2026-07-01T00:00:00.000Z',
    platform: 'linux',
    target_version: '0.2.1',
    ...overrides,
  }
}

test('manual gate requires 24 healthy hours at the requested cohort', () => {
  const rows = [aggregate(), aggregate({ lifecycle: 'install-succeeded' })]
  assert.equal(evaluateGate(rows, args).passed, true)
  assert.equal(
    evaluateGate(
      [...rows, aggregate({ event_count: 2, lifecycle: 'install-failed' })],
      args,
    ).passed,
    false,
  )
})

test('manual gate excludes started events and rejects malformed aggregates', () => {
  const result = evaluateGate(
    [
      aggregate({ lifecycle: 'check-started' }),
      aggregate(),
      aggregate({ lifecycle: 'install-succeeded' }),
    ],
    args,
  )
  assert.equal(result.stages.download.observations, 10)
  assert.equal(result.stages.install.observations, 10)
  assert.throws(() => evaluateGate([{}], args))
})

test('manual gate never treats a short window as promotable', () => {
  assert.throws(() =>
    evaluateGate(
      [],
      replaceArg(args, '--window-end', '2026-07-01T12:00:00.000Z'),
    ),
  )
})

test('manual gate rejects a future observation window', () => {
  assert.throws(
    () =>
      evaluateGate(
        [],
        replaceArg(
          replaceArg(args, '--window-start', '2026-08-01T00:00:00.000Z'),
          '--window-end',
          '2026-08-02T00:00:00.000Z',
        ),
        new Date('2026-07-24T00:00:00.000Z'),
      ),
    /has not elapsed/,
  )
})

test('manual gate uses a half-open UTC-day-aligned window', () => {
  const result = evaluateGate(
    [
      aggregate(),
      aggregate({ lifecycle: 'install-succeeded' }),
      aggregate({
        error_code: 'unknown',
        event_count: 100,
        lifecycle: 'download-failed',
        observed_day: '2026-07-02T00:00:00.000Z',
      }),
      aggregate({
        error_code: 'unknown',
        event_count: 100,
        lifecycle: 'install-failed',
        observed_day: '2026-07-02T00:00:00.000Z',
      }),
    ],
    args,
  )

  assert.equal(result.passed, true)
  assert.equal(result.stages.download.observations, 10)
  assert.equal(result.stages.install.observations, 10)
  assert.throws(
    () =>
      evaluateGate(
        [],
        replaceArg(args, '--window-start', '2026-07-01T01:00:00.000Z'),
      ),
    /UTC day boundaries/,
  )
  assert.throws(
    () =>
      evaluateGate(
        [],
        replaceArg(args, '--window-end', '2026-07-02T01:00:00.000Z'),
      ),
    /UTC day boundaries/,
  )
})

test('manual gate evaluates download and install failure rates independently', () => {
  const stageArgs = replaceArg(args, '--min-observations', '1')
  const result = evaluateGate(
    [
      aggregate({ event_count: 8 }),
      aggregate({ event_count: 8, lifecycle: 'install-succeeded' }),
      aggregate({
        error_code: 'unknown',
        event_count: 1,
        lifecycle: 'install-failed',
      }),
    ],
    stageArgs,
  )

  assert.equal(result.stages.download.failureRate, 0)
  assert.equal(result.stages.install.failureRate, 1 / 9)
  assert.equal(result.passed, false)
})
