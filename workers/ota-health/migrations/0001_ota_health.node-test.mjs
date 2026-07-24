import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'

const migration = await readFile(
  new URL('./0001_ota_health.sql', import.meta.url),
  'utf8',
)

test('the D1-compatible schema accepts nullable event details and rolls up each digest once', () => {
  const database = new DatabaseSync(':memory:')
  database.exec(migration)
  const insert = database.prepare(`
    INSERT OR IGNORE INTO ota_health_events (
      event_key, attempt_id, current_version, target_version, platform, arch,
      cohort, lifecycle, error_code, occurred_at, received_at, duration_ms
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const values = [
    'same-digest',
    'attempt-1',
    '0.1.0',
    null,
    'linux',
    'x64',
    7,
    'check-started',
    null,
    '2026-07-01T00:00:00.000Z',
    '2026-07-01T12:00:00.000Z',
    null,
  ]
  insert.run(...values)
  insert.run(...values)

  const aggregate = database
    .prepare(
      'SELECT event_count, target_version, error_code FROM ota_health_daily_aggregates',
    )
    .get()
  assert.equal(aggregate.event_count, 1)
  assert.equal(aggregate.target_version, '')
  assert.equal(aggregate.error_code, '')

  database
    .prepare('DELETE FROM ota_health_events WHERE received_at < ?')
    .run('2026-08-01T00:00:00.000Z')
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM ota_health_events').get()
      .count,
    0,
  )
  database.close()
})
