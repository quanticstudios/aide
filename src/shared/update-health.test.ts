import { describe, expect, it } from 'vitest'

import {
  bucketUpdateHealthDuration,
  coarsenUpdateHealthTimestamp,
  parseUpdateHealthBatch,
  UPDATE_HEALTH_BATCH_SCHEMA_VERSION,
} from './update-health'

const event = {
  arch: 'x64',
  attemptId: 'attempt-1',
  cohort: 7,
  createdAt: '2026-07-24T12:00:00.000Z',
  currentVersion: '0.1.0',
  durationMs: 1_000,
  errorCode: null,
  lifecycle: 'downloaded',
  platform: 'linux',
  targetVersion: '0.2.1',
}

describe('parseUpdateHealthBatch', () => {
  it('accepts only the documented fixed event schema', () => {
    expect(
      parseUpdateHealthBatch(
        { events: [event], schemaVersion: UPDATE_HEALTH_BATCH_SCHEMA_VERSION },
        new Date('2026-07-24T12:01:00.000Z'),
      ),
    ).toEqual({ events: [event], schemaVersion: 1 })
  })

  it.each([
    {},
    { events: [], schemaVersion: 1 },
    { events: [event], schemaVersion: 2 },
    { events: [{ ...event, path: '/private/repo' }], schemaVersion: 1 },
    { events: [{ ...event, durationMs: 12 }], schemaVersion: 1 },
    { events: [{ ...event, durationMs: 604_800_001 }], schemaVersion: 1 },
    {
      events: [{ ...event, createdAt: '2026-07-24T12:00:01.000Z' }],
      schemaVersion: 1,
    },
    {
      events: [{ ...event, createdAt: '2026-07-24T12:06:00.000Z' }],
      schemaVersion: 1,
    },
    { events: Array.from({ length: 21 }, () => event), schemaVersion: 1 },
  ])('rejects malformed or identifying payload %#', (value) => {
    expect(() =>
      parseUpdateHealthBatch(value, new Date('2026-07-24T12:01:00.000Z')),
    ).toThrow('Invalid update health batch.')
  })

  it('removes timestamp and duration precision before enqueue', () => {
    expect(coarsenUpdateHealthTimestamp('2026-07-24T12:34:56.789Z')).toBe(
      '2026-07-24T12:34:00.000Z',
    )
    expect(bucketUpdateHealthDuration(0)).toBe(1_000)
    expect(bucketUpdateHealthDuration(1_001)).toBe(5_000)
    expect(bucketUpdateHealthDuration(10 * 24 * 60 * 60_000)).toBe(
      7 * 24 * 60 * 60_000,
    )
  })
})
