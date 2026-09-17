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
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    itemId: `${config.sessionId}-reasoning`,
    kind: 'reasoning-text',
    provider: config.mode,
    text: 'private reasoning',
    type: 'content.delta',
  })
  emit({
    createdAt: '2026-04-11T10:00:00.000Z',
    itemId: `${config.sessionId}-tool`,
    kind: 'command-output',
    provider: config.mode,
    text: 'private tool output',
    type: 'content.delta',
  })
  if (config.readOnly) {
    emit({
      createdAt: '2026-04-11T10:00:00.000Z',
      inputTokens: 3,
      outputTokens: 5,
      provider: config.mode,
      report: {
        createdAt: '2026-04-11T10:00:00.000Z',
        estimatedCostUsd: 0.1,
        id: `${config.sessionId}-usage`,
        models: [
          {
            cacheCreationInputTokens: null,
            cachedInputTokens: null,
            estimatedCostUsd: 0.1,
            inputTokens: 3,
            model: config.model ?? null,
            outputTokens: 5,
          },
        ],
        provider: config.mode,
        scopeId: config.sessionId,
        turnId,
      },
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
    expect(prepared[0]?.history).toEqual(prepared[1]?.history)
    expect(JSON.stringify(prepared[0]?.history)).not.toContain('private')
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
    expect(snapshot.usageReports).toHaveLength(2)
    expect(snapshot.usageSummary).toMatchObject({
      estimatedCostUsd: 0.2,
      inputTokens: 6,
      outputTokens: 10,
    })
    await manager.sendInput(config.sessionId, 'normal')
    expect(lastOriginalInput.startsWith('normal')).toBe(true)
    expect(lastOriginalInput).toContain('@alpha (claude/alpha)')
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
      { alias: 'Good', selection: { mode: 'claude' as const, model: 'good' } },
      { alias: 'Bad', selection: { mode: 'claude' as const, model: 'bad' } },
    ]
    await manager.createSession(config)
    expect(
      manager.configureSessionAgents(config.sessionId, agents).agents,
    ).toEqual([
      expect.objectContaining({ alias: 'good' }),
      expect.objectContaining({ alias: 'bad' }),
    ])
    await manager.sendInput(config.sessionId, 'compare', ['GOOD', 'bad'])
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

  it('cancels a child while preparation waits and accepts a later parent prompt', async () => {
    let beginPreparation!: () => void
    let releasePreparation!: () => void
    const preparationStarted = new Promise<void>((resolve) => {
      beginPreparation = resolve
    })
    const preparationRelease = new Promise<void>((resolve) => {
      releasePreparation = resolve
    })
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) =>
          emitAnswer(config as OpinionConfig, emit, `answer ${text}`),
        start: async () => emitReady(config, emit),
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      prepareInput: async (input) => {
        if ((input.config as OpinionConfig).readOnly) {
          beginPreparation()
          await preparationRelease
        }
        return { text: input.text }
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    manager.configureSessionAgents(config.sessionId, [
      { alias: 'alpha', selection: { mode: 'claude', model: 'alpha' } },
    ])
    const dispatch = manager.sendInput(config.sessionId, 'compare', ['alpha'])
    await preparationStarted
    await manager.interruptSession(config.sessionId)
    await dispatch
    releasePreparation()
    await Promise.resolve()
    expect(manager.getSnapshots()[config.sessionId].content).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: 'answer compare' }),
      ]),
    )
    await expect(
      manager.sendInput(config.sessionId, 'normal'),
    ).resolves.toBeUndefined()
  })

  it('cancels one asked alias without cancelling another', async () => {
    let releaseAlpha!: () => void
    const alphaPending = new Promise<void>((resolve) => {
      releaseAlpha = resolve
    })
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => releaseAlpha(),
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          if (config.model === 'alpha') await alphaPending
          emitAnswer(config as OpinionConfig, emit, `answer ${text}`)
        },
        start: async () => emitReady(config, emit),
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
    const alphaAbort = new AbortController()
    const alpha = manager.askAgent(
      config.sessionId,
      'alpha',
      'alpha prompt',
      alphaAbort.signal,
    )
    const beta = manager.askAgent(
      config.sessionId,
      'beta',
      'beta prompt',
      new AbortController().signal,
    )
    await vi.waitFor(() =>
      expect(manager.getSnapshots()[config.sessionId].turns).toHaveLength(2),
    )
    alphaAbort.abort()
    await expect(alpha).rejects.toThrow('cancelled')
    await expect(beta).resolves.toContain('@beta (beta):')
    expect(manager.getSnapshots()[config.sessionId].turns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          recipientAlias: 'alpha',
          state: 'cancelled',
        }),
        expect.objectContaining({ recipientAlias: 'beta', state: 'completed' }),
      ]),
    )
  })

  it('rejects an agent request while a parent close waits for its backend', async () => {
    let beginClose!: () => void
    let releaseClose!: () => void
    const closeStarted = new Promise<void>((resolve) => {
      beginClose = resolve
    })
    const closeRelease = new Promise<void>((resolve) => {
      releaseClose = resolve
    })
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => {
          beginClose()
          await closeRelease
        },
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) =>
          emitAnswer(config as OpinionConfig, emit, `answer ${text}`),
        start: async () => emitReady(config, emit),
      }),
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    const config = createConfig()
    await manager.createSession(config)
    manager.configureSessionAgents(config.sessionId, [
      { alias: 'alpha', selection: { mode: 'claude', model: 'alpha' } },
    ])
    const close = manager.closeSession(config.sessionId)
    await closeStarted
    await expect(
      manager.askAgent(
        config.sessionId,
        'alpha',
        'do not start',
        new AbortController().signal,
      ),
    ).rejects.toThrow('unavailable')
    releaseClose()
    await close
  })

  it('cancels delayed child startup before the child sends input', async () => {
    let beginChildStart!: () => void
    let releaseChildStart!: () => void
    let childSendCount = 0
    const childStartStarted = new Promise<void>((resolve) => {
      beginChildStart = resolve
    })
    const childStartRelease = new Promise<void>((resolve) => {
      releaseChildStart = resolve
    })
    const manager = new ManagedSessionManager({
      createBackend: (config, emit) => ({
        close: async () => undefined,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async (text) => {
          if ((config as OpinionConfig).readOnly) childSendCount += 1
          emitAnswer(config as OpinionConfig, emit, `answer ${text}`)
        },
        start: async () => {
          if ((config as OpinionConfig).readOnly) {
            beginChildStart()
            await childStartRelease
          }
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
    ])
    const dispatch = manager.sendInput(config.sessionId, 'compare', ['alpha'])
    await childStartStarted
    await manager.interruptSession(config.sessionId)
    await dispatch
    releaseChildStart()
    await Promise.resolve()
    expect(childSendCount).toBe(0)
  })
})
