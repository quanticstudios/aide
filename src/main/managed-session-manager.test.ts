import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  ManagedSessionEvent,
  PersistedManagedSession,
} from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import {
  buildClaudeUserContent,
  buildCodexTurnInput,
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

  it('persists fleet tools and separates completion from acceptance', async () => {
    const store = createMemoryStore()
    const options = {
      store,
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    }
    const manager = new ManagedSessionManager(options)
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'fleet plan')
    const fleet = manager.getSnapshots()[config.sessionId]?.fleet
    expect(fleet?.plan?.nodes).toHaveLength(2)
    expect(fleet?.acceptedNodeIds).toEqual([])
    expect(() =>
      manager.acceptFleetNode(config.sessionId, 'drawer', true),
    ).toThrow('Only completed')
    manager.updateFleetNode(config.sessionId, {
      nodeId: 'drawer',
      status: 'completed',
      detail: 'Rendered',
      evidence: 'Reported smoke result',
    })
    expect(() =>
      manager.acceptFleetNode(config.sessionId, 'drawer', true),
    ).toThrow('dependencies')
    manager.acceptFleetNode(config.sessionId, 'storage', true)
    manager.acceptFleetNode(config.sessionId, 'drawer', true)
    await manager.closeAll()
    const reopened = new ManagedSessionManager(options)
    reopened.acceptFleetNode(config.sessionId, 'storage', false)
    expect(reopened.getActiveSessionCount()).toBe(0)
    await reopened.createSession(config)
    expect(
      reopened.getSnapshots()[config.sessionId]?.fleet?.acceptedNodeIds,
    ).toEqual([])
    expect(
      reopened.getSnapshots()[config.sessionId]?.fleet?.plan?.nodes[1]?.status,
    ).toBe('completed')
    reopened.acceptFleetNode(config.sessionId, 'storage', true)
    reopened.updateFleetNode(config.sessionId, {
      nodeId: 'storage',
      status: 'blocked',
      detail: 'New failure',
      evidence: '',
    })
    expect(
      reopened.getSnapshots()[config.sessionId]?.fleet?.acceptedNodeIds,
    ).toEqual([])
    await reopened.closeAll()
  })

  it('records preparation and enforces fleet attempt and failure limits', async () => {
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async ({ text }) => ({ text }),
    })
    const config = {
      ...createConfig(),
      agents: [
        {
          alias: 'Sol',
          selection: {
            mode: 'codex' as const,
            model: 'gpt-5.6-sol',
            effort: 'medium',
          },
        },
      ],
    }
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'fleet plan')
    const signal = new AbortController().signal
    await expect(
      manager.askAgent(config.sessionId, 'Sol', 'check', signal),
    ).rejects.toThrow('Specify the plan node')
    await expect(
      manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
        nodeId: 'missing',
      }),
    ).rejects.toThrow('Unknown plan')
    for (let index = 0; index < 3; index += 1) {
      await manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
        nodeId: 'drawer',
        reason: 'Review the drawer',
        risk: 'high',
      })
    }
    await expect(
      manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
        nodeId: 'drawer',
      }),
    ).rejects.toThrow()
    await expect(
      manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
        failure: 'infrastructure',
      }),
    ).rejects.toThrow()
    const fleet = manager.getSnapshots()[config.sessionId]?.fleet
    expect(fleet?.attemptCounts?.drawer).toBe(3)
    expect(
      fleet?.events
        .filter(
          (event) => event.type === 'agent' && event.status === 'completed',
        )
        .map((event) => event.attempt),
    ).toEqual([1, 2, 3])
    expect(
      fleet?.events.filter(
        (event) => event.type === 'agent' && event.status === 'completed',
      ),
    ).toHaveLength(3)
    expect(
      fleet?.events.some(
        (event) =>
          event.type === 'preparation' &&
          event.status === 'completed' &&
          event.source === 'runtime',
      ),
    ).toBe(true)
    expect(
      fleet?.events.some(
        (event) => event.type === 'decision' && event.status === 'blocked',
      ),
    ).toBe(true)
    manager.setFleetPlan(config.sessionId, fleet?.plan)
    await expect(
      manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
        nodeId: 'drawer',
      }),
    ).rejects.toThrow()
    manager.setFleetPlan(config.sessionId, {
      ...fleet?.plan,
      nodes: fleet?.plan?.nodes.map((node) =>
        node.id === 'drawer' ? { ...node, title: 'A different task' } : node,
      ),
    })
    await manager.askAgent(config.sessionId, 'Sol', 'check', signal, {
      nodeId: 'drawer',
    })
    expect(
      manager.getSnapshots()[config.sessionId]?.fleet?.attemptCounts?.drawer,
    ).toBe(1)
    await manager.closeAll()
  })

  it('preserves unrelated acceptance and revokes transitive dependents after changes', async () => {
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    const node = {
      id: 'first',
      title: 'First',
      dependsOn: [],
      detail: '',
      evidence: 'reported',
      status: 'completed',
    }
    manager.setFleetPlan(config.sessionId, {
      summary: 'Tasks',
      nodes: [
        node,
        { ...node, id: 'other' },
        { ...node, id: 'child', dependsOn: ['first'] },
      ],
    })
    for (const id of ['first', 'other', 'child'])
      manager.acceptFleetNode(config.sessionId, id, true)
    manager.updateFleetNode(config.sessionId, {
      nodeId: 'first',
      status: 'completed',
      detail: '',
      evidence: 'reported',
    })
    expect(
      manager.getSnapshots()[config.sessionId]?.fleet?.acceptedNodeIds,
    ).toEqual(['first', 'other', 'child'])
    manager.updateFleetNode(config.sessionId, {
      nodeId: 'first',
      status: 'blocked',
      detail: 'needs changes',
      evidence: '',
    })
    expect(
      manager.getSnapshots()[config.sessionId]?.fleet?.acceptedNodeIds,
    ).toEqual(['other'])
    await manager.closeAll()
  })

  it('builds native Claude and Codex image payloads', () => {
    const pastedImage = {
      data: 'iVBORw0KGgo=',
      mimeType: 'image/png' as const,
      name: 'pasted.png',
    }
    const workspaceImage = {
      ...pastedImage,
      name: 'workspace.png',
      path: '/workspace/workspace.png',
    }
    expect(buildClaudeUserContent('inspect', [pastedImage])).toEqual([
      { text: 'inspect', type: 'text' },
      {
        source: {
          data: pastedImage.data,
          media_type: 'image/png',
          type: 'base64',
        },
        type: 'image',
      },
    ])
    expect(
      buildCodexTurnInput('inspect', [pastedImage, workspaceImage]),
    ).toEqual([
      { text: 'inspect', type: 'text' },
      {
        type: 'image',
        url: `data:image/png;base64,${pastedImage.data}`,
      },
      {
        type: 'image',
        url: `data:image/png;base64,${workspaceImage.data}`,
      },
    ])
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

  nonWindowsIt(
    'does not terminalize a Codex session for startup stderr',
    async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-stderr-'))
      const command = path.join(directory, 'codex')
      writeFileSync(
        command,
        `#!${process.execPath}
const { createInterface } = require('node:readline');
process.stderr.write('WARNING: refusing temporary PATH aliases\\n');
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  const result = message.method === 'thread/start' ? { thread: { id: 'thread' }, model: 'test' } : {};
  process.stdout.write(JSON.stringify({ id: message.id, result }) + '\\n');
});
`,
        { mode: 0o700 },
      )
      process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
      process.env.AIDE_CODEX_COMMAND = command
      const manager = new ManagedSessionManager({
        onRuntimeEvent: (_meta, event) => runtimeEvents.push(event),
        onUpdate: (event) => uiEvents.push(event),
      })
      try {
        const snapshot = await manager.createSession({
          ...createConfig('codex'),
          cwd: directory,
        })
        expect(snapshot.sessionState).toBe('ready')
        expect(
          runtimeEvents.filter((event) => event.type === 'runtime.error'),
        ).toEqual([])
        expect(
          uiEvents.some(
            (event) =>
              event.type === 'snapshot' &&
              event.snapshot.sessionState === 'error',
          ),
        ).toBe(false)
      } finally {
        await manager.closeAll()
        rmSync(directory, { recursive: true, force: true })
      }
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

  it('captures the pre-turn snapshot and queues another prompt while the turn runs', async () => {
    let savedPrompt = ''
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            turnId: 'running-turn',
            type: 'turn.started',
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
      beforeInput: async ({ snapshot, text }) => {
        expect(snapshot.content.some((item) => item.text === text)).toBe(false)
        return { checkpointId: `checkpoint-${text}` }
      },
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async ({ text }) => {
        expect(savedPrompt).toBe(text)
        return { text }
      },
      store: {
        reconcileInterruptedManagedSessions: () => [],
        saveManagedSession: (entry) => {
          savedPrompt = entry.snapshot.content.at(-1)?.text ?? ''
          return entry
        },
      },
    })
    const config = createConfig('claude')

    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'persist before dispatch')
    await manager.sendInput(config.sessionId, 'second prompt')
    expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
      queuedInputs: [expect.objectContaining({ text: 'second prompt' })],
      turns: [
        expect.objectContaining({
          checkpointId: 'checkpoint-persist before dispatch',
        }),
      ],
    })
  })

  it('delivers queued prompts in order and supports cancellation', async () => {
    let emitRuntimeEvent:
      | ((event: ManagedProviderRuntimeEvent) => void)
      | undefined
    const sent: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => {
        emitRuntimeEvent = emit
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async (text) => {
            sent.push(text)
            emit({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId: `turn-${sent.length}`,
              type: 'turn.started',
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
        }
      },
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'first')
    await manager.sendInput(config.sessionId, 'cancel me')
    await manager.sendInput(config.sessionId, 'third')
    const queued = manager.getSnapshots()[config.sessionId]?.queuedInputs ?? []
    manager.cancelQueuedInput(config.sessionId, queued[0]?.id ?? '')
    emitRuntimeEvent?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      provider: 'claude',
      state: 'completed',
      turnId: 'turn-1',
      type: 'turn.completed',
    })
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[0]?.split('\n\nFleet policy.')[0]).toBe('first')
    expect(sent[1]).toContain('third')
    expect(sent.join('\n')).not.toContain('cancel me')
  })

  it('pauses queued work after dispatch failure and resumes explicitly', async () => {
    let shouldFail = true
    const sent: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          sent.push(text)
          const turnId = `turn-${sent.length}`
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            turnId,
            type: 'turn.started',
          })
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
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async ({ text }) => {
        if (shouldFail) throw new Error('Jev unavailable')
        return { text }
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'retry me')
    expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
      queuePaused: true,
      queuedInputs: [expect.objectContaining({ lastError: 'Jev unavailable' })],
    })
    shouldFail = false
    await manager.resumeQueue(config.sessionId)
    expect(sent.map((prompt) => prompt.split('\n\nFleet policy.')[0])).toEqual([
      'retry me',
    ])
    expect(manager.getSnapshots()[config.sessionId]?.queuedInputs).toEqual([])
  })

  it('cancels a queued input while preparation is still running', async () => {
    const preparationStarted = createDeferred()
    const releasePreparation = createDeferred()
    const sent: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          sent.push(text)
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
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async ({ text }) => {
        preparationStarted.resolve()
        await releasePreparation.promise
        return { text }
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    const send = manager.sendInput(config.sessionId, 'cancel during Jev')
    await preparationStarted.promise
    const queuedInputId =
      manager.getSnapshots()[config.sessionId]?.queuedInputs?.[0]?.id ?? ''
    manager.cancelQueuedInput(config.sessionId, queuedInputId)
    releasePreparation.resolve()
    await send

    expect(sent).toEqual([])
    expect(manager.getSnapshots()[config.sessionId]?.queuedInputs).toEqual([])
  })

  it('never redelivers an input after an ambiguous provider failure', async () => {
    const sent: string[] = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          sent.push(text)
          throw new Error('Provider response timed out')
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
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'send at most once')
    await manager.resumeQueue(config.sessionId)

    expect(sent.map((prompt) => prompt.split('\n\nFleet policy.')[0])).toEqual([
      'send at most once',
    ])
    expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
      queuedInputs: [],
      content: [
        expect.objectContaining({ text: 'send at most once' }),
        expect.objectContaining({
          text: expect.stringContaining('will not resend'),
        }),
      ],
    })
  })

  it('keeps queued work paused after restart', async () => {
    const store = createMemoryStore()
    const config = createConfig()
    const first = new ManagedSessionManager({
      createBackend: (backendConfig, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: backendConfig.mode,
            turnId: 'running',
            type: 'turn.started',
          })
        },
        start: async () => {
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: backendConfig.mode,
            state: 'ready',
            type: 'session.state.changed',
          })
        },
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store,
    })
    await first.createSession(config)
    await first.sendInput(config.sessionId, 'running')
    await first.sendInput(config.sessionId, 'after restart')
    await first.closeAll()

    let sendsAfterRestart = 0
    const second = new ManagedSessionManager({
      createBackend: (backendConfig, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          sendsAfterRestart += 1
        },
        start: async () => {
          emit({
            createdAt: '2026-04-11T11:00:00.000Z',
            provider: backendConfig.mode,
            state: 'ready',
            type: 'session.state.changed',
          })
        },
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store,
    })
    const restored = await second.createSession(config)
    expect(sendsAfterRestart).toBe(0)
    expect(restored.queuePaused).toBe(true)
    expect(restored.queuedInputs).toEqual([
      expect.objectContaining({ text: 'after restart' }),
    ])
  })

  it('drains an explicitly resumed queue after a cancelled turn checkpoint completes', async () => {
    const checkpointCaptureStarted = createDeferred()
    const completeCheckpointCapture = createDeferred()
    let emitRuntimeEvent:
      | ((event: ManagedProviderRuntimeEvent) => void)
      | undefined
    const sent: string[] = []
    const manager = new ManagedSessionManager({
      afterTurn: async () => {
        checkpointCaptureStarted.resolve()
        await completeCheckpointCapture.promise
      },
      beforeInput: async ({ text }) => ({ checkpointId: `checkpoint-${text}` }),
      createBackend: (config, emit) => {
        emitRuntimeEvent = emit
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async (text) => {
            sent.push(text)
            emit({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId: `turn-${sent.length}`,
              type: 'turn.started',
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
        }
      },
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'first')
    await manager.sendInput(config.sessionId, 'queued after cancellation')
    emitRuntimeEvent?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      provider: 'claude',
      state: 'cancelled',
      turnId: 'turn-1',
      type: 'turn.completed',
    })
    await checkpointCaptureStarted.promise

    await manager.resumeQueue(config.sessionId)
    expect(sent.map((prompt) => prompt.split('\n\nFleet policy.')[0])).toEqual([
      'first',
    ])

    completeCheckpointCapture.resolve()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    expect(sent[1]).toContain('queued after cancellation')
  })

  it('steers an active Codex turn without starting a concurrent turn', async () => {
    const checkpoints: string[] = []
    const steered: string[] = []
    const manager = new ManagedSessionManager({
      beforeInput: async ({ text }) => {
        checkpoints.push(text)
        return { checkpointId: `checkpoint-${text}` }
      },
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          emit({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            turnId: 'active',
            type: 'turn.started',
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
        steerInput: async (text) => {
          steered.push(text)
        },
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig('codex')
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'start')
    await manager.sendInput(config.sessionId, 'steer this')
    const queuedInputId =
      manager.getSnapshots()[config.sessionId]?.queuedInputs?.[0]?.id
    await manager.sendQueuedInputNow(config.sessionId, queuedInputId ?? '')
    expect(checkpoints).toEqual(['start'])
    expect(steered).toEqual([expect.stringContaining('steer this')])
    expect(manager.getSnapshots()[config.sessionId]?.turns).toHaveLength(1)
  })

  it('registers a restored session without starting a backend', async () => {
    const sourceManager = new ManagedSessionManager({
      getNow: () => '2026-04-11T09:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const sourceConfig = createConfig()
    const sourceSnapshot = await sourceManager.createSession(sourceConfig)
    let saved: PersistedManagedSession | null = null
    const manager = new ManagedSessionManager({
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store: {
        reconcileInterruptedManagedSessions: () => [],
        saveManagedSession: (entry) => {
          saved = entry
          return entry
        },
      },
    })
    const config = {
      ...sourceConfig,
      paneId: 'restored-pane',
      sessionId: 'restored-session',
    }
    const snapshot = {
      ...sourceSnapshot,
      paneId: config.paneId,
      sessionId: config.sessionId,
    }
    const restored = manager.registerRestoredSession(config, snapshot)
    expect(restored).toMatchObject({
      paneId: 'restored-pane',
      pendingApprovals: [],
      sessionId: 'restored-session',
      sessionState: 'stopped',
    })
    expect(saved).toMatchObject({ config, snapshot: restored })
    expect(manager.getActiveSessionCount()).toBe(0)
  })

  it('does not write after closeAll clears a timed-out session', async () => {
    const closeDeferred = createDeferred()
    let saveCount = 0
    const manager = new ManagedSessionManager({
      createBackend: () => ({
        close: async () => closeDeferred.promise,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => undefined,
        start: async () => undefined,
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      store: {
        reconcileInterruptedManagedSessions: () => [],
        saveManagedSession: (entry) => {
          saveCount += 1
          return entry
        },
      },
    })
    const config = createConfig()

    await manager.createSession(config)
    const closeAll = manager.closeAll(0)
    await Promise.resolve()
    await closeAll
    const savesAtShutdown = saveCount

    closeDeferred.resolve()
    await Promise.resolve()

    expect(manager.getSnapshots()).toEqual({})
    expect(saveCount).toBe(savesAtShutdown)
  })
})
