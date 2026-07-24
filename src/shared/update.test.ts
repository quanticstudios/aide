import { describe, expect, it } from 'vitest'

import {
  type UpdateEvent,
  type UpdateSnapshot,
  reconcileUpdateSnapshot,
} from './update'

function snapshot(
  revision: number,
  phase: UpdateSnapshot['phase'],
): UpdateSnapshot {
  return {
    capability: 'supported',
    currentVersion: '0.1.0',
    errorCode: null,
    lastCheckedAt: null,
    phase,
    progress: null,
    revision,
    schemaVersion: 1,
    targetVersion: phase === 'available' ? '0.1.1' : null,
  }
}

function event(revision: number, phase: UpdateSnapshot['phase']): UpdateEvent {
  return { revision, snapshot: snapshot(revision, phase) }
}

describe('reconcileUpdateSnapshot', () => {
  it('replays buffered events newer than the fetched snapshot after subscribing first', () => {
    const fetched = snapshot(3, 'idle')
    const buffered = [event(4, 'checking'), event(5, 'available')]

    expect(reconcileUpdateSnapshot(fetched, buffered)).toEqual(
      snapshot(5, 'available'),
    )
  })

  it('discards stale, duplicate, malformed, and out-of-order snapshots', () => {
    const malformed: UpdateEvent = {
      revision: 8,
      snapshot: snapshot(7, 'failed'),
    }

    expect(
      reconcileUpdateSnapshot(snapshot(3, 'idle'), [
        event(5, 'available'),
        event(4, 'checking'),
        event(5, 'available'),
        malformed,
      ]),
    ).toEqual(snapshot(5, 'available'))
  })
})
