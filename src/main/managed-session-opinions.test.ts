import { describe, expect, it, vi } from 'vitest'

import type { ManagedSessionConfig } from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import { ManagedSessionManager } from './managed-session-manager'

type OpinionConfig = ManagedSessionConfig & { readOnly?: boolean }
type Emit = (event: ManagedProviderRuntimeEvent) => void

function createConfig(mode: 'build' | 'plan' = 'plan', sessionId = 'parent') {
  return {
    cwd: '/tmp/opinions',
    interactionMode: mode,
    mode: 'claude' as const,
    model: 'orchestrator',
    orchestratorSelection: { mode: 'claude' as const, model: 'orchestrator' },
    paneId: 'pane',
    sessionId,
    workspaceId: 'workspace',
  }
}

function emitReady(config: ManagedSessionConfig, emit: Emit) {
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    provider: config.mode,
    state: 'ready',
    type: 'session.state.changed',
  })
}

function emitAnswer(
  config: OpinionConfig,
  emit: Emit,
  text: string,
  state: 'completed' | 'failed' = 'completed',
) {
  const turnId = `${config.sessionId}-turn`
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    provider: config.mode,
    turnId,
    type: 'turn.started',
  })
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    itemId: `${config.sessionId}-answer`,
    kind: 'assistant-text',
    provider: config.mode,
    text,
    type: 'content.delta',
  })
  if (config.readOnly) {
    emit({
      createdAt: '2026-04-11T10:00:00.000Z',
      inputTokens: 3,
      outputTokens: 5,
      type: 'session.usage.updated',
    })
  }
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    provider: config.mode,
    state,
    turnId,
    type: 'turn.completed',
  })
}

describe('managed session opinions', () => {
  it('runs selected plan agents with safe history and preserves the orchestrator', async () => {
    let lastOriginalInput = ''
    const prepared: Array<{
      config: ManagedSessionConfig
      history: unknown[]
    }> = []
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          if (!(config as OpinionConfig).readOnly) lastOriginalInput = text
          emitAnswer(
            config as OpinionConfig,
            emit,
            (config as OpinionConfig).readOnly
              ? `answer ${config.model}`
              : 'assistant fact',
          )
        },
        start: async () => emitReady(config, emit),
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async (input) => {
        if ((input.config as OpinionConfig).readOnly)
          prepared.push({ config: input.config, history: [...input.history] })
        return { text: input.text }
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'prior user fact')
    manager.configureSessionAgents(config.sessionId, [
      { alias: 'alpha', selection: { mode: 'claude', model: 'alpha' } },
      { alias: 'beta', selection: { mode: 'claude', model: 'beta' } },
    ])
    await manager.sendInput(config.sessionId, 'compare', ['alpha', 'beta'])
    expect(prepared).toHaveLength(2)
    expect(prepared.map((input) => input.history)).toEqual([
      expect.arrayContaining([
        { provider: null, role: 'user', text: 'prior user fact' },
        { provider: 'claude', role: 'assistant', text: 'assistant fact' },
      ]),
      expect.arrayContaining([
        { provider: null, role: 'user', text: 'prior user fact' },
        { provider: 'claude', role: 'assistant', text: 'assistant fact' },
      ]),
    ])
    expect(prepared.map((input) => input.config)).toEqual([
      expect.objectContaining({ agents: [], model: 'alpha', readOnly: true }),
      expect.objectContaining({ agents: [], model: 'beta', readOnly: true }),
    ])
    expect(new Set(prepared.map((input) => input.config.sessionId)).size).toBe(
      2,
    )
    const snapshot = manager.getSnapshots()[config.sessionId]
    expect(snapshot).toMatchObject({
      model: 'orchestrator',
      orchestratorSelection: config.orchestratorSelection,
      provider: 'claude',
    })
    expect(snapshot.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: 'alpha', text: 'answer alpha' }),
        expect.objectContaining({ model: 'beta', text: 'answer beta' }),
      ]),
    )
    expect(snapshot.usage).toMatchObject({ inputTokens: 3, outputTokens: 5 })
    await manager.sendInput(config.sessionId, 'normal')
    expect(lastOriginalInput).toBe('normal')
  })

  it('keeps successful opinions and rejects invalid recipients before child starts', async () => {
    let startedChildren = 0
    const createBackend = (config: ManagedSessionConfig, emit: Emit) => ({
      close: async () => undefined,
      interrupt: async () => undefined,
      resolveRequest: async () => undefined,
      resolveUserInput: async () => undefined,
      sendInput: async () =>
        emitAnswer(
          config as OpinionConfig,
          emit,
          config.model === 'bad' ? 'failed' : 'kept',
          config.model === 'bad' ? 'failed' : 'completed',
        ),
      start: async () => {
        if ((config as OpinionConfig).readOnly) startedChildren++
      },
    })
    const manager = new ManagedSessionManager({
      createBackend,
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    const agents = [
      { alias: 'good', selection: { mode: 'claude' as const, model: 'good' } },
      { alias: 'bad', selection: { mode: 'claude' as const, model: 'bad' } },
    ]
    await manager.createSession(config)
    manager.configureSessionAgents(config.sessionId, agents)
    await manager.sendInput(config.sessionId, 'compare', ['good', 'bad'])
    expect(manager.getSnapshots()[config.sessionId].content).toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'kept' })]),
    )
    await expect(
      manager.sendInput(config.sessionId, 'unknown', ['missing']),
    ).rejects.toThrow()
    await expect(
      manager.sendInput(config.sessionId, 'duplicate', ['good', 'GOOD']),
    ).rejects.toThrow()
    expect(startedChildren).toBe(2)

    const buildConfig = createConfig('build', 'build')
    await manager.createSession(buildConfig)
    manager.configureSessionAgents(buildConfig.sessionId, agents)
    await expect(
      manager.sendInput(buildConfig.sessionId, 'compare', ['good', 'bad']),
    ).rejects.toThrow()
  })

  it('interrupts opinions, ignores late child events, and blocks a second writer', async () => {
    const pending = new Map<string, () => void>()
    const interrupted: string[] = []
    let lateChildEmitter: Emit | undefined
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => {
          interrupted.push(config.sessionId)
          pending.get(config.sessionId)?.()
        },
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () =>
          new Promise<void>((resolve) =>
            pending.set(config.sessionId, resolve),
          ),
        start: async () => {
          if ((config as OpinionConfig).readOnly) lateChildEmitter = emit
          emitReady(config, emit)
        },
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    manager.configureSessionAgents(config.sessionId, [
      { alias: 'alpha', selection: { mode: 'claude', model: 'alpha' } },
      { alias: 'beta', selection: { mode: 'claude', model: 'beta' } },
    ])
    const aliases = ['alpha', 'beta']
    const dispatch = manager.sendInput(config.sessionId, 'compare', aliases)
    await vi.waitFor(() => expect([...pending.keys()]).toHaveLength(2))
    await expect(
      manager.sendInput(config.sessionId, 'normal'),
    ).rejects.toThrow()
    await manager.interruptSession(config.sessionId)
    await dispatch
    lateChildEmitter?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      itemId: 'late',
      kind: 'assistant-text',
      provider: 'claude',
      text: 'late',
      type: 'content.delta',
    })
    expect(
      interrupted.filter((sessionId) => sessionId !== config.sessionId),
    ).toHaveLength(2)
    expect(manager.getSnapshots()[config.sessionId].content).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ text: 'late' })]),
    )
  })
})
