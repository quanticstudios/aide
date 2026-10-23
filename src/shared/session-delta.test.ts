import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { ManagedSessionSnapshot } from './managed-session'
import {
  applyDelta,
  type SessionDelta,
  SessionDeltaResyncError,
  type SessionDeltaState,
} from './session-delta'

interface SessionDeltaFixture {
  deltas: SessionDelta[]
  snapshot: ManagedSessionSnapshot
}

const fixtureDirectory = new URL(
  '../../fixtures/session-deltas/',
  import.meta.url,
)
const fixtures = readdirSync(fixtureDirectory)
  .filter((name) => name.endsWith('.json'))
  .map((name) => ({
    name,
    ...(JSON.parse(
      readFileSync(new URL(name, fixtureDirectory), 'utf8'),
    ) as SessionDeltaFixture),
  }))

function reduce(deltas: readonly SessionDelta[]): SessionDeltaState | null {
  return deltas.reduce<SessionDeltaState | null>(applyDelta, null)
}

function resyncReason(run: () => unknown): string | undefined {
  try {
    run()
  } catch (error) {
    if (error instanceof SessionDeltaResyncError) return error.reason
    throw error
  }
  return undefined
}

describe('applyDelta', () => {
  it('has fixtures to replay', () => {
    expect(fixtures.length).toBeGreaterThan(0)
  })

  it.each(fixtures)('replays $name to the snapshot main sent', (fixture) => {
    expect(reduce(fixture.deltas)?.snapshot).toEqual(fixture.snapshot)
  })

  it('does not mutate the state it is given', () => {
    const [fixture] = fixtures
    const states: SessionDeltaState[] = []
    let state: SessionDeltaState | null = null
    for (const delta of fixture.deltas) {
      state = applyDelta(state, delta)
      states.push(structuredClone(state))
    }
    let replayed: SessionDeltaState | null = null
    for (const [index, delta] of fixture.deltas.entries()) {
      const before = replayed && structuredClone(replayed)
      replayed = applyDelta(replayed, delta)
      expect(replayed).toEqual(states[index])
      if (index > 0) expect(states[index - 1]).toEqual(before)
    }
  })

  it('detects a seq gap', () => {
    const [fixture] = fixtures
    const state = reduce(fixture.deltas.slice(0, 3))
    expect(resyncReason(() => applyDelta(state, fixture.deltas[4]))).toBe(
      'seq-gap',
    )
    expect(resyncReason(() => applyDelta(state, fixture.deltas[2]))).toBe(
      'seq-gap',
    )
  })

  it('asks for a resync without a base, across sessions, or on a new version', () => {
    const [fixture] = fixtures
    const state = reduce(fixture.deltas.slice(0, 1))
    const next = fixture.deltas[1]
    expect(resyncReason(() => applyDelta(null, next))).toBe('no-base')
    expect(
      resyncReason(() =>
        applyDelta(state, { ...next, sessionId: 'another-session' }),
      ),
    ).toBe('session')
    expect(
      resyncReason(() =>
        applyDelta(state, { ...next, version: 2 } as unknown as SessionDelta),
      ),
    ).toBe('version')
    expect(
      resyncReason(() =>
        applyDelta(state, {
          ...next,
          type: 'item.text.append',
          itemId: 'missing',
          text: 'x',
          itemUpdatedAt: next.updatedAt,
        }),
      ),
    ).toBe('item')
  })

  it('takes a snapshot delta as a fresh base at any seq', () => {
    const [fixture] = fixtures
    const state = reduce(fixture.deltas)
    const resync: SessionDelta = {
      ...fixture.deltas[0],
      seq: 100,
    }
    expect(applyDelta(state, resync).seq).toBe(100)
  })
})
