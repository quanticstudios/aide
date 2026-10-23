import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type {
  ManagedSessionProvider,
  ManagedSessionSnapshot,
} from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import { ManagedSessionManager } from './managed-session-manager'

interface SessionDeltaFixture {
  mode: ManagedSessionProvider
  prompt: string
  runtimeEvents: Omit<ManagedProviderRuntimeEvent, 'provider'>[]
  snapshot: ManagedSessionSnapshot
}

const NOW = '2026-10-23T12:00:00.000Z'
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
// why: longer than the manager's 50ms stream throttle, so each runtime event publishes its own snapshot as the fixture recorded.
const EVENT_SPACING_MS = 70

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

/** Renumbers random ids in order of first appearance, matching the fixtures. */
function normalizeIds(
  snapshot: ManagedSessionSnapshot,
): ManagedSessionSnapshot {
  const ids = new Map<string, string>()
  return JSON.parse(
    JSON.stringify(snapshot).replace(UUID, (id) => {
      if (!ids.has(id)) {
        ids.set(
          id,
          `00000000-0000-4000-8000-${String(ids.size + 1).padStart(12, '0')}`,
        )
      }
      return ids.get(id) as string
    }),
  )
}

describe('session delta fixtures', () => {
  it.each(
    fixtures,
  )('$name ends on the snapshot main publishes for its runtime events', async (fixture) => {
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          for (const event of fixture.runtimeEvents) {
            emit({
              ...event,
              provider: config.mode,
            } as ManagedProviderRuntimeEvent)
            await new Promise((resolve) =>
              setTimeout(resolve, EVENT_SPACING_MS),
            )
          }
        },
        start: async () => {
          emit({
            createdAt: NOW,
            provider: config.mode,
            state: 'ready',
            type: 'session.state.changed',
          })
        },
      }),
      getNow: () => NOW,
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const { sessionId } = fixture.snapshot
    await manager.createSession({
      cwd: '/tmp/workspace-1',
      mode: fixture.mode,
      paneId: fixture.snapshot.paneId,
      sessionId,
      workspaceId: fixture.snapshot.workspaceId,
    })
    await manager.sendInput(sessionId, fixture.prompt)
    const published = manager.getSnapshots()[sessionId]
    await manager.closeAll()

    expect(published && normalizeIds(published)).toEqual(fixture.snapshot)
  })
})
