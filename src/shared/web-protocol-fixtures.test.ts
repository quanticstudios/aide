import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { ManagedSessionSnapshot } from './managed-session'
import {
  applyDelta,
  type SessionDelta,
  type SessionDeltaState,
} from './session-delta'

interface WebProtocolFixture {
  scenario: string
  deltas: SessionDelta[]
  snapshot: ManagedSessionSnapshot
}

// why: pitwall owns these; scripts/vendor-web-protocol.mjs copies them from its testdata/web-protocol.
const fixtureDirectory = new URL(
  '../../fixtures/web-protocol/',
  import.meta.url,
)
const sums = readFileSync(new URL('SHA256SUMS', fixtureDirectory), 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => {
    const [hex, name] = line.split('  ')
    return { hex, name }
  })
const fixtures = sums.map(({ name }) => ({
  name,
  ...(JSON.parse(
    readFileSync(new URL(name, fixtureDirectory), 'utf8'),
  ) as WebProtocolFixture),
}))

describe('pitwall web protocol fixtures', () => {
  it('lists every vendored file in SHA256SUMS with its checksum', () => {
    expect(
      readdirSync(fixtureDirectory)
        .filter((name) => name.endsWith('.json'))
        .sort(),
    ).toEqual(sums.map(({ name }) => name).sort())
    for (const { hex, name } of sums) {
      const bytes = readFileSync(new URL(name, fixtureDirectory))
      expect(createHash('sha256').update(bytes).digest('hex'), name).toBe(hex)
    }
  })

  it.each(
    fixtures,
  )('applies $name to the snapshot pitwall ends on', (fixture) => {
    const state = fixture.deltas.reduce<SessionDeltaState | null>(
      applyDelta,
      null,
    )
    expect(state?.seq).toBe(fixture.deltas.length)
    expect(state?.snapshot).toEqual(fixture.snapshot)
  })
})
