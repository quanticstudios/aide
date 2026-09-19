import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditDependencies,
  backoffDelayMs,
  classifyAuditOutcome,
  exitCodeForOutcome,
  MAX_ATTEMPTS,
} from './audit-dependencies.mjs'

const REGISTRY_503 = {
  exitCode: 1,
  output:
    'bun audit v1.4.2 (744846f84)\n\nerror: POST https://registry.npmjs.org/-/npm/v1/security/advisories/bulk - 503\n',
}
const HIGH_ADVISORY = {
  exitCode: 1,
  output: '1 vulnerability (1 high)\nhono  <4.12.25  high\n',
}

function recordingSleep(delays) {
  return async (ms) => {
    delays.push(ms)
  }
}

test('classifies a zero exit as clean and a reported advisory as blocking', () => {
  assert.equal(
    classifyAuditOutcome({ exitCode: 0, output: 'no vulnerabilities' }),
    'clean',
  )
  assert.equal(classifyAuditOutcome(HIGH_ADVISORY), 'advisories')
})

test('classifies registry transport failures as an outage, not an advisory', () => {
  assert.equal(classifyAuditOutcome(REGISTRY_503), 'registry-unavailable')
  assert.equal(
    classifyAuditOutcome({
      exitCode: 1,
      output: 'bun audit v1.3.0\nerror: audit request failed (status 503)\n',
    }),
    'registry-unavailable',
  )
  assert.equal(
    classifyAuditOutcome({ exitCode: 1, output: 'error: fetch failed' }),
    'registry-unavailable',
  )
})

test('an advisory fails the job and an outage does not', () => {
  assert.equal(exitCodeForOutcome('advisories'), 1)
  assert.equal(exitCodeForOutcome('registry-unavailable'), 0)
  assert.equal(exitCodeForOutcome('clean'), 0)
})

test('retries a persistent outage five times with exponential backoff', async () => {
  const delays = []
  let calls = 0

  const result = await auditDependencies({
    runAudit: () => {
      calls += 1
      return REGISTRY_503
    },
    sleep: recordingSleep(delays),
  })

  assert.equal(calls, MAX_ATTEMPTS)
  assert.deepEqual(delays, [1000, 2000, 4000, 8000])
  assert.equal(result.outcome, 'registry-unavailable')
  assert.equal(exitCodeForOutcome(result.outcome), 0)
})

test('stops retrying once the registry answers', async () => {
  let calls = 0

  const result = await auditDependencies({
    runAudit: () => {
      calls += 1
      return calls < 3
        ? REGISTRY_503
        : { exitCode: 0, output: 'no vulnerabilities' }
    },
    sleep: recordingSleep([]),
  })

  assert.equal(calls, 3)
  assert.equal(result.outcome, 'clean')
})

test('fails immediately on a real advisory without retrying', async () => {
  let calls = 0

  const result = await auditDependencies({
    runAudit: () => {
      calls += 1
      return HIGH_ADVISORY
    },
    sleep: recordingSleep([]),
  })

  assert.equal(calls, 1)
  assert.equal(result.outcome, 'advisories')
  assert.equal(exitCodeForOutcome(result.outcome), 1)
})

test('backs off 1s, 2s, 4s, 8s', () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffDelayMs), [1000, 2000, 4000, 8000])
})
