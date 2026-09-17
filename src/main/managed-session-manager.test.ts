import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ManagedSessionEvent,
  PersistedManagedSession,
} from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import {
  ManagedSessionManager,
  type ManagedSessionPersistenceStore,
} from './managed-session-manager'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

function createDeferred(): Deferred {
  let resolve: (() => void) | undefined
  const promise = new Promise<void>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve: () => resolve?.(),
  }
}

function createConfig(mode: 'claude' | 'codex' = 'claude') {
  return {
    cwd: '/tmp/workspace-1',
    mode,
    paneId: `workspace-1:${mode}-pane`,
    sessionId: `workspace-1:${mode}-session`,
    workspaceId: 'workspace-1',
  } as const
}

function createMemoryStore(): ManagedSessionPersistenceStore {
  const persisted = new Map<string, PersistedManagedSession>()
  return {
    listManagedSessions: () => [...persisted.values()],
    reconcileInterruptedManagedSessions: (now) =>
      [...persisted.values()].map((entry) => {
        const turns = entry.snapshot.turns.map((turn) =>
          turn.state === 'running'
            ? { ...turn, completedAt: now, state: 'interrupted' as const }
            : turn,
        )
        const next = { ...entry, snapshot: { ...entry.snapshot, turns } }
        persisted.set(entry.config.sessionId, next)
        return next
      }),
    saveManagedSession: (entry) => {
      persisted.set(entry.config.sessionId, structuredClone(entry))
      return entry
    },
  }
}

describe('ManagedSessionManager', () => {
  const runtimeEvents: ManagedProviderRuntimeEvent[] = []
  const uiEvents: ManagedSessionEvent[] = []

  beforeEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = '1'
    runtimeEvents.length = 0
    uiEvents.length = 0
  })

  afterEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
    process.env.AIDE_CODEX_COMMAND = undefined
  })

  it('creates a fake managed Claude session and reports ready state', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: (_meta, event) => runtimeEvents.push(event),
      onUpdate: (event) => uiEvents.push(event),
    })

    const snapshot = await manager.createSession(createConfig('claude'))

    expect(snapshot.provider).toBe('claude')
    expect(snapshot.sessionState).toBe('ready')
    expect(runtimeEvents.map((event) => event.type)).toEqual([
      'session.started',
      'session.state.changed',
      'session.state.changed',
    ])
  })

  it('drops a session whose provider fails to start so the user can retry', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    process.env.AIDE_FAKE_MANAGED_PROVIDERS = 'fail-start'

    await expect(manager.createSession(config)).rejects.toThrow(
      'Fake managed provider failed to start',
    )
    expect(manager.getSnapshots()[config.sessionId]).toBeUndefined()

    process.env.AIDE_FAKE_MANAGED_PROVIDERS = '1'

    await expect(manager.createSession(config)).resolves.toMatchObject({
      sessionState: 'ready',
    })
  })

  const nonWindowsIt = process.platform === 'win32' ? it.skip : it

  nonWindowsIt(
    'reports a missing Codex executable without crashing and allows retry',
    async () => {
      const manager = new ManagedSessionManager({
        getNow: () => '2026-04-11T10:00:00.000Z',
        onRuntimeEvent: () => undefined,
        onUpdate: () => undefined,
      })
      const config = createConfig('codex')

      process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
      process.env.AIDE_CODEX_COMMAND = '/missing/aide-codex-command'

      await expect(manager.createSession(config)).rejects.toThrow()
      expect(manager.getSnapshots()[config.sessionId]).toBeUndefined()

      process.env.AIDE_FAKE_MANAGED_PROVIDERS = '1'
      process.env.AIDE_CODEX_COMMAND = undefined

      await expect(manager.createSession(config)).resolves.toMatchObject({
        sessionState: 'ready',
      })
    },
  )

  it('tracks fake approvals and input prompts through the managed snapshot', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: (event) => uiEvents.push(event),
    })

    const config = createConfig('codex')
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'approval')

    let snapshot = manager.getSnapshots()[config.sessionId]
    expect(snapshot.pendingApprovals).toHaveLength(1)
    expect(snapshot.sessionState).toBe('waiting')

    await manager.resolveRequest(
      config.sessionId,
      snapshot.pendingApprovals[0]?.id ?? '',
      'accept',
    )

    snapshot = manager.getSnapshots()[config.sessionId]
    expect(snapshot.pendingApprovals).toHaveLength(0)
    expect(snapshot.sessionState).toBe('ready')

    await manager.sendInput(config.sessionId, 'input')
    snapshot = manager.getSnapshots()[config.sessionId]
    expect(snapshot.pendingUserInputs).toHaveLength(1)

    await manager.resolveUserInput(
      config.sessionId,
      snapshot.pendingUserInputs[0]?.id ?? '',
      { prompt: 'Continue' },
    )

    snapshot = manager.getSnapshots()[config.sessionId]
    expect(snapshot.pendingUserInputs).toHaveLength(0)
    expect(snapshot.sessionState).toBe('ready')
  })

  it('revisions snapshots and preserves structured plan approvals', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: (event) => uiEvents.push(event),
    })
    const config = {
      ...createConfig('codex'),
      interactionMode: 'plan' as const,
    }

    const created = await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'plan approval')
    const pending = manager.getSnapshots()[config.sessionId]

    expect(pending.revision).toBeGreaterThan(created.revision)
    expect(pending.runtimeGeneration).toBe(1)
    expect(pending.interactionMode).toBe('plan')
    expect(pending.planApproval).toMatchObject({
      id: pending.pendingApprovals[0]?.id,
    })
    expect(uiEvents.at(-1)).toMatchObject({ revision: pending.revision })
  })

  it('increments runtime generation when switching providers', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    const switched = await manager.switchSessionProvider(config.sessionId, {
      effort: 'high',
      mode: 'codex',
      model: 'gpt-test',
      serviceTier: 'priority',
    })

    expect(switched.runtimeGeneration).toBe(2)
    expect(switched.provider).toBe('codex')
    expect(switched.effort).toBe('high')
    expect(switched.model).toBe('gpt-test')
    expect(switched.serviceTier).toBe('priority')
  })

  it('restarts a ready session when its advertised effort or service tier changes', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('codex')

    await manager.createSession(config)
    const switched = await manager.switchSessionProvider(config.sessionId, {
      effort: 'high',
      mode: 'codex',
      model: 'gpt-test',
      serviceTier: 'priority',
    })

    expect(switched.runtimeGeneration).toBe(2)
    expect(switched.provider).toBe('codex')
    expect(switched.effort).toBe('high')
    expect(switched.serviceTier).toBe('priority')
  })

  it('keeps the active selection when a busy session rejects a switch', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('codex')

    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'approval')
    const before = manager.getSnapshots()[config.sessionId]

    await expect(
      manager.switchSessionProvider(config.sessionId, {
        effort: 'high',
        mode: 'codex',
        model: 'gpt-test',
        serviceTier: 'priority',
      }),
    ).rejects.toThrow(
      'Cannot switch provider while a turn is active or approvals/inputs are pending',
    )

    expect(manager.getSnapshots()[config.sessionId]).toEqual(before)
  })

  it('rolls back a failed provider selection without publishing it', async () => {
    const starts: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => undefined,
        start: async () => {
          starts.push(config.mode)
          emitRuntimeEvent({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            state: 'ready',
            type: 'session.state.changed',
          })

          if (config.mode === 'codex') {
            throw new Error('Codex candidate failed to start')
          }
        },
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: (_meta, event) => runtimeEvents.push(event),
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)

    await expect(
      manager.switchSessionProvider(config.sessionId, {
        effort: 'high',
        mode: 'codex',
        model: 'gpt-test',
        serviceTier: 'priority',
      }),
    ).rejects.toThrow('Codex candidate failed to start')

    expect(starts).toEqual(['claude', 'codex', 'claude'])
    expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
      effort: null,
      model: null,
      provider: 'claude',
      runtimeGeneration: 3,
      serviceTier: null,
      sessionState: 'ready',
    })
    expect(runtimeEvents.some((event) => event.provider === 'codex')).toBe(
      false,
    )
  })

  it('preserves the prior selection in an error snapshot when rollback fails', async () => {
    let claudeStarts = 0
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => undefined,
        start: async () => {
          if (config.mode === 'claude') {
            claudeStarts += 1
            if (claudeStarts === 1) {
              emitRuntimeEvent({
                createdAt: '2026-04-11T10:00:00.000Z',
                provider: 'claude',
                state: 'ready',
                type: 'session.state.changed',
              })
              return
            }

            throw new Error('Claude rollback failed to start')
          }

          throw new Error('Codex candidate failed to start')
        },
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)

    await expect(
      manager.switchSessionProvider(config.sessionId, { mode: 'codex' }),
    ).rejects.toThrow(
      'Provider switch failed: Codex candidate failed to start; rollback failed: Claude rollback failed to start',
    )

    expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
      lastError:
        'Provider switch failed: Codex candidate failed to start; rollback failed: Claude rollback failed to start',
      model: null,
      provider: 'claude',
      runtimeGeneration: 3,
      sessionState: 'error',
    })
  })

  it.each([
    { exitCode: 0, expectedTurnState: 'interrupted' },
    { exitCode: 1, expectedTurnState: 'failed' },
  ] as const)('terminal exit code $exitCode clears active turn bookkeeping for recovery', async ({
    exitCode,
    expectedTurnState,
  }) => {
    const backendEvents: {
      emit?: (event: ManagedProviderRuntimeEvent) => void
    } = {}
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => {
        backendEvents.emit = emit

        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => undefined,
          start: async () => {
            emit({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              state: 'ready',
              type: 'session.state.changed',
            })
          },
        }
      },
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    const emitRuntimeEvent = backendEvents.emit

    if (!emitRuntimeEvent) {
      throw new Error('expected backend event emitter')
    }

    emitRuntimeEvent({
      createdAt: '2026-04-11T10:00:00.000Z',
      provider: 'claude',
      turnId: 'turn-1',
      type: 'turn.started',
    })
    await manager.sendInput(config.sessionId, 'queued after turn start')
    emitRuntimeEvent({
      createdAt: '2026-04-11T10:00:00.000Z',
      exitCode,
      provider: 'claude',
      type: 'session.exited',
    })

    expect(manager.getSnapshots()[config.sessionId]?.turns).toContainEqual(
      expect.objectContaining({
        completedAt: '2026-04-11T10:00:00.000Z',
        id: 'turn-1',
        state: expectedTurnState,
      }),
    )
    expect(manager.getSnapshots()[config.sessionId]?.running).toBe(false)

    await expect(
      manager.switchSessionProvider(config.sessionId, {
        mode: 'codex',
      }),
    ).resolves.toMatchObject({ provider: 'codex', sessionState: 'ready' })
  })

  it('rejects provider switches while a session is still connecting', async () => {
    const manager = new ManagedSessionManager({
      createBackend: () => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => undefined,
        start: async () => undefined,
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)

    await expect(
      manager.switchSessionProvider(config.sessionId, { mode: 'codex' }),
    ).rejects.toThrow('connecting')
  })

  it('rejects a concurrent provider switch while the first switch is closing', async () => {
    const closeStarted = createDeferred()
    const releaseClose = createDeferred()
    const starts: string[] = []
    let closeCount = 0
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => {
          closeCount += 1

          if (closeCount === 1) {
            closeStarted.resolve()
            await releaseClose.promise
          }
        },
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => undefined,
        start: async () => {
          starts.push(config.mode)
          emitRuntimeEvent({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            state: 'ready',
            type: 'session.state.changed',
          })
        },
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    const firstSwitch = manager.switchSessionProvider(config.sessionId, {
      mode: 'codex',
    })
    await closeStarted.promise

    await expect(
      manager.switchSessionProvider(config.sessionId, { mode: 'claude' }),
    ).rejects.toThrow('already in progress')

    releaseClose.resolve()
    await expect(firstSwitch).resolves.toMatchObject({ provider: 'codex' })
    expect(closeCount).toBe(1)
    expect(starts).toEqual(['claude', 'codex'])
  })

  it('ignores events emitted by any superseded backend generation', async () => {
    const emitters: Array<(event: ManagedProviderRuntimeEvent) => void> = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emitters.push(emitRuntimeEvent)

        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => undefined,
          start: async () => {
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              state: 'ready',
              type: 'session.state.changed',
            })
          },
        }
      },
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    const staleEmitter = emitters[0]

    if (!staleEmitter) {
      throw new Error('expected original backend event emitter')
    }

    await manager.switchSessionProvider(config.sessionId, {
      mode: 'codex',
    })
    const staleCandidateEmitter = emitters[1]

    if (!staleCandidateEmitter) {
      throw new Error('expected candidate backend event emitter')
    }

    const switched = await manager.switchSessionProvider(config.sessionId, {
      mode: 'claude',
    })

    staleEmitter({
      createdAt: '2026-04-11T10:00:00.000Z',
      message: 'old backend failed after close',
      provider: 'claude',
      type: 'runtime.error',
    })
    staleCandidateEmitter({
      createdAt: '2026-04-11T10:00:00.000Z',
      message: 'superseded candidate failed after a later switch',
      provider: 'codex',
      type: 'runtime.error',
    })

    expect(manager.getSnapshots()[config.sessionId]).toEqual(switched)
  })

  it('owns session cleanup independently from renderer subscriptions', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    expect(manager.getSnapshots()[config.sessionId]).toBeDefined()

    await manager.closeAll()
    expect(manager.getSnapshots()).toEqual({})
  })

  it('appends streamed content and completion state for fake work turns', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })

    const config = createConfig('claude')
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'build preview')

    const snapshot = manager.getSnapshots()[config.sessionId]

    expect(snapshot.content).toHaveLength(2)
    expect(snapshot.content[0]).toMatchObject({
      kind: 'user-prompt',
      text: 'build preview',
    })
    expect(snapshot.content[0]?.turnId).toBeTruthy()
    expect(snapshot.content[1]).toMatchObject({
      kind: 'assistant-text',
      text: 'Handled: build preview',
    })
    expect(snapshot.content[1]?.turnId).toBe(snapshot.content[0]?.turnId)
    expect(snapshot.lastCompletedAt).toBe('2026-04-11T10:00:00.000Z')
    expect(snapshot.sessionState).toBe('ready')
  })

  it('tracks turn summaries through the snapshot', async () => {
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })

    const config = createConfig('claude')
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'hello')

    const snapshot = manager.getSnapshots()[config.sessionId]

    expect(snapshot.turns).toHaveLength(1)
    expect(snapshot.turns[0]).toMatchObject({
      state: 'completed',
      startedAt: '2026-04-11T10:00:00.000Z',
      completedAt: '2026-04-11T10:00:00.000Z',
    })
    expect(snapshot.turns[0]?.id).toBeTruthy()
  })

  it('delivers an attributed visible answer to a provider after a switch', async () => {
    const receivedByCodex: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          const turnId = `${config.mode}-turn`
          if (config.mode === 'codex') receivedByCodex.push(text)
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            turnId,
            type: 'turn.started',
          })
          if (config.mode === 'claude') {
            emit({
              createdAt: '2026-04-11T10:00:00.000Z',
              itemId: 'claude-answer',
              kind: 'assistant-text',
              provider: 'claude',
              text: 'The deployment fact is blue.',
              type: 'content.delta',
            })
          }
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            state: 'completed',
            turnId,
            type: 'turn.completed',
          })
        },
        start: async () => {
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            state: 'ready',
            type: 'session.state.changed',
          })
        },
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'remember the deployment fact')
    await manager.switchSessionProvider(config.sessionId, { mode: 'codex' })
    await manager.sendInput(config.sessionId, 'what is the deployment fact?')

    expect(receivedByCodex).toHaveLength(1)
    expect(receivedByCodex[0]).toContain('Assistant (claude)')
    expect(receivedByCodex[0]).toContain('The deployment fact is blue.')
    expect(receivedByCodex[0]).toContain('what is the deployment fact?')
  })

  it('restores completed turns and marks running turns interrupted', async () => {
    const store = createMemoryStore()
    const config = createConfig('claude')
    const first = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store,
    })

    await first.createSession(config)
    await first.sendInput(config.sessionId, 'persist this answer')
    await first.closeAll()

    const second = new ManagedSessionManager({
      getNow: () => '2026-04-11T11:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store,
    })
    const snapshot = await second.createSession(config)

    expect(
      snapshot.content.some((item) => item.text === 'persist this answer'),
    ).toBe(true)
    expect(snapshot.turns[0]?.state).toBe('completed')
    await second.closeAll()
  })
})
