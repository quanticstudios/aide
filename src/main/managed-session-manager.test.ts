import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { ManagedSessionEvent } from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import { ManagedSessionManager } from './managed-session-manager'

function createConfig(mode: 'claude' | 'codex' = 'claude') {
  return {
    cwd: '/tmp/workspace-1',
    mode,
    paneId: `workspace-1:${mode}-pane`,
    sessionId: `workspace-1:${mode}-session`,
    workspaceId: 'workspace-1',
  } as const
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
})
