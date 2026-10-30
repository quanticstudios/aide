import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type {
  ManagedSessionConfig,
  ManagedSessionEvent,
} from '../shared/managed-session'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import { ManagedSessionManager } from './managed-session-manager'

interface Deferred {
  promise: Promise<void>
  resolve: () => void
}

interface DeferredValue<T> {
  promise: Promise<T>
  resolve: (value: T) => void
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

function createDeferredValue<T>(): DeferredValue<T> {
  let resolve: ((value: T) => void) | undefined
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })

  return {
    promise,
    resolve: (value) => resolve?.(value),
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

describe('ManagedSessionManager', () => {
  const runtimeEvents: ManagedProviderRuntimeEvent[] = []
  const uiEvents: ManagedSessionEvent[] = []
  const temporaryPaths: string[] = []

  beforeEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = '1'
    runtimeEvents.length = 0
    uiEvents.length = 0
  })

  afterEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
    process.env.AIDE_FAKE_MANAGED_GIT_CHANGES = undefined
    process.env.AIDE_CODEX_COMMAND = undefined
    while (temporaryPaths.length > 0) {
      const temporaryPath = temporaryPaths.pop()
      if (temporaryPath) {
        rmSync(temporaryPath, { force: true, recursive: true })
      }
    }
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

  it('awaits a prepared baseline before dispatching provider work and binds it to that turn', async () => {
    const baseline = createDeferredValue<string>()
    const dispatch = vi.fn()
    const capturePatch = vi.fn(async (_config, _capturedBaseline: unknown) => ({
      binaryChanges: 'none' as const,
      changedFileCount: 1,
      message: null,
      patch: 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+turn',
      patchByteLength: 48,
      status: 'ready' as const,
    }))
    let emit: ((event: ManagedProviderRuntimeEvent) => void) | undefined
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emit = emitRuntimeEvent
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatch()
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId: 'provider-turn',
              type: 'turn.started',
            })
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId: 'provider-turn',
              type: 'turn.completed',
            })
          },
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
      turnPatchRecorder: {
        captureBaseline: async () => await baseline.promise,
        capturePatch,
        disposeBaseline: async () => undefined,
      },
    })
    const config = createConfig()
    await manager.createSession(config)

    const sending = manager.sendInput(config.sessionId, 'delayed baseline')
    await vi.waitFor(() => expect(dispatch).not.toHaveBeenCalled())
    baseline.resolve('baseline-before-dispatch')
    await sending

    await vi.waitFor(() => {
      expect(dispatch).toHaveBeenCalledOnce()
      expect(capturePatch).toHaveBeenCalledWith(
        config,
        'baseline-before-dispatch',
        expect.any(AbortSignal),
      )
    })
    expect(emit).toBeDefined()
  })

  it('serializes one workspace through patch cleanup without blocking another workspace', async () => {
    const firstPatchStarted = createDeferred()
    const releaseFirstPatch = createDeferred()
    const dispatches: string[] = []
    const emitters = new Map<
      string,
      (event: ManagedProviderRuntimeEvent) => void
    >()
    const firstConfig = createConfig()
    const secondConfig = {
      ...createConfig(),
      paneId: 'workspace-1:second-pane',
      sessionId: 'workspace-1:second-session',
    }
    const otherConfig = {
      ...createConfig(),
      cwd: '/tmp/workspace-2',
      paneId: 'workspace-2:pane',
      sessionId: 'workspace-2:session',
      workspaceId: 'workspace-2',
    }
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emitters.set(config.sessionId, emitRuntimeEvent)
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            const turnId = `turn-${config.sessionId}`
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId,
              type: 'turn.started',
            })
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId,
              type: 'turn.completed',
            })
          },
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.sessionId,
        capturePatch: async (_config, baseline) => {
          if (baseline === firstConfig.sessionId) {
            firstPatchStarted.resolve()
            await releaseFirstPatch.promise
          }
          return {
            binaryChanges: 'none',
            changedFileCount: 1,
            message: null,
            patch: 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+turn',
            patchByteLength: 48,
            status: 'ready',
          }
        },
        disposeBaseline: async () => undefined,
      },
    })
    await Promise.all([
      manager.createSession(firstConfig),
      manager.createSession(secondConfig),
      manager.createSession(otherConfig),
    ])

    await manager.sendInput(firstConfig.sessionId, 'first')
    await firstPatchStarted.promise
    const second = manager.sendInput(secondConfig.sessionId, 'second')
    const other = manager.sendInput(otherConfig.sessionId, 'other')

    await vi.waitFor(() => expect(dispatches).toContain(otherConfig.sessionId))
    expect(dispatches).not.toContain(secondConfig.sessionId)

    releaseFirstPatch.resolve()
    await Promise.all([second, other])
    expect(dispatches).toContain(secondConfig.sessionId)
    expect(emitters.size).toBe(3)
  })

  it('retains a workspace lease after an interrupt acknowledgement until the provider emits its terminal event', async () => {
    const dispatches: string[] = []
    const emitters = new Map<
      string,
      (event: ManagedProviderRuntimeEvent) => void
    >()
    const firstConfig = createConfig()
    const secondConfig = {
      ...createConfig(),
      paneId: 'workspace-1:second-pane',
      sessionId: 'workspace-1:second-session',
    }
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emitters.set(config.sessionId, emitRuntimeEvent)
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            if (config.sessionId === firstConfig.sessionId) {
              emitRuntimeEvent({
                createdAt: '2026-04-11T10:00:00.000Z',
                provider: config.mode,
                turnId: 'first-provider-turn',
                type: 'turn.started',
              })
            }
          },
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.sessionId,
        capturePatch: async (_config, baseline) => ({
          binaryChanges: 'none',
          changedFileCount: 1,
          message: null,
          patch: `diff --git a/${baseline as string} b/${baseline as string}`,
          patchByteLength: 1,
          status: 'ready',
        }),
        disposeBaseline: async () => undefined,
      },
    })
    await Promise.all([
      manager.createSession(firstConfig),
      manager.createSession(secondConfig),
    ])

    await manager.sendInput(firstConfig.sessionId, 'first')
    await manager.interruptSession(firstConfig.sessionId)
    const second = manager.sendInput(secondConfig.sessionId, 'second')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(dispatches).toEqual([firstConfig.sessionId])

    emitters.get(firstConfig.sessionId)?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      itemId: 'late-write-diagnostic',
      kind: 'file-change-output',
      provider: 'claude',
      text: 'late write after interrupt acknowledgement',
      type: 'content.delta',
    })
    emitters.get(firstConfig.sessionId)?.({
      createdAt: '2026-04-11T10:00:02.000Z',
      provider: 'claude',
      state: 'interrupted',
      turnId: 'first-provider-turn',
      type: 'turn.completed',
    })

    await second
    expect(dispatches).toEqual([
      firstConfig.sessionId,
      secondConfig.sessionId,
    ])
  })

  it('keeps a post-dispatch send failure contained until a terminal provider event', async () => {
    const dispatches: string[] = []
    const emitters = new Map<
      string,
      (event: ManagedProviderRuntimeEvent) => void
    >()
    const firstConfig = createConfig()
    const secondConfig = {
      ...createConfig(),
      paneId: 'workspace-1:second-pane',
      sessionId: 'workspace-1:second-session',
    }
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emitters.set(config.sessionId, emitRuntimeEvent)
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            if (config.sessionId === firstConfig.sessionId) {
              throw new Error('send failed after provider dispatch')
            }
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId: 'second-provider-turn',
              type: 'turn.started',
            })
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId: 'second-provider-turn',
              type: 'turn.completed',
            })
          },
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.sessionId,
        capturePatch: async () => ({
          binaryChanges: 'none',
          changedFileCount: 0,
          message: null,
          patch: null,
          patchByteLength: 0,
          status: 'empty',
        }),
        disposeBaseline: async () => undefined,
      },
    })
    await Promise.all([
      manager.createSession(firstConfig),
      manager.createSession(secondConfig),
    ])

    await expect(
      manager.sendInput(firstConfig.sessionId, 'first'),
    ).rejects.toThrow('send failed after provider dispatch')
    const second = manager.sendInput(secondConfig.sessionId, 'second')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(dispatches).toEqual([firstConfig.sessionId])

    emitters.get(firstConfig.sessionId)?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      provider: 'claude',
      state: 'failed',
      turnId: 'missing-start-after-send-failure',
      type: 'turn.completed',
    })

    await second
    expect(dispatches).toEqual([
      firstConfig.sessionId,
      secondConfig.sessionId,
    ])
  })

  it('recovers a sent turn with no lifecycle events only after backend shutdown', async () => {
    vi.useFakeTimers()
    try {
      const dispatches: string[] = []
      const closes = vi.fn(async () => undefined)
      const firstConfig = createConfig()
      const secondConfig = {
        ...createConfig(),
        paneId: 'workspace-1:second-pane',
        sessionId: 'workspace-1:second-session',
      }
      const manager = new ManagedSessionManager({
        createBackend: (config, emitRuntimeEvent) => ({
          close: closes,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            if (config.sessionId !== firstConfig.sessionId) {
              emitRuntimeEvent({
                createdAt: '2026-04-11T10:00:00.000Z',
                provider: config.mode,
                turnId: 'second-provider-turn',
                type: 'turn.started',
              })
              emitRuntimeEvent({
                createdAt: '2026-04-11T10:00:01.000Z',
                provider: config.mode,
                state: 'completed',
                turnId: 'second-provider-turn',
                type: 'turn.completed',
              })
            }
          },
          start: async () => {
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
        turnPatchRecorder: {
          captureBaseline: async (config) => config.sessionId,
          capturePatch: async () => ({
            binaryChanges: 'none',
            changedFileCount: 0,
            message: null,
            patch: null,
            patchByteLength: 0,
            status: 'empty',
          }),
          disposeBaseline: async () => undefined,
        },
      })
      await Promise.all([
        manager.createSession(firstConfig),
        manager.createSession(secondConfig),
      ])

      await manager.sendInput(firstConfig.sessionId, 'missing events')
      const second = manager.sendInput(secondConfig.sessionId, 'peer')
      await Promise.resolve()
      expect(dispatches).toEqual([firstConfig.sessionId])

      await vi.advanceTimersByTimeAsync(5_000)
      await second
      expect(closes).toHaveBeenCalled()
      expect(dispatches).toEqual([
        firstConfig.sessionId,
        secondConfig.sessionId,
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('cancels a timed-out recorder capture before allowing queued workspace work', async () => {
    vi.useFakeTimers()
    try {
      let captureAborted = false
      const dispatches: string[] = []
      const firstConfig = createConfig()
      const secondConfig = {
        ...createConfig(),
        paneId: 'workspace-1:second-pane',
        sessionId: 'workspace-1:second-session',
      }
      const manager = new ManagedSessionManager({
        createBackend: (config, emitRuntimeEvent) => ({
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            const turnId = `${config.sessionId}-turn`
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId,
              type: 'turn.started',
            })
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId,
              type: 'turn.completed',
            })
          },
          start: async () => {
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
        turnPatchRecorder: {
          captureBaseline: async (config, signal) => {
            if (config.sessionId !== firstConfig.sessionId) {
              return config.sessionId
            }
            return await new Promise<string>((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () => {
                  captureAborted = true
                  reject(new Error('snapshot copy cancelled'))
                },
                { once: true },
              )
            })
          },
          capturePatch: async () => ({
            binaryChanges: 'none',
            changedFileCount: 0,
            message: null,
            patch: null,
            patchByteLength: 0,
            status: 'empty',
          }),
          disposeBaseline: async () => undefined,
        },
      })
      await Promise.all([
        manager.createSession(firstConfig),
        manager.createSession(secondConfig),
      ])

      const first = manager.sendInput(firstConfig.sessionId, 'slow snapshot')
      await vi.advanceTimersByTimeAsync(15_000)
      await first
      expect(captureAborted).toBe(true)

      await manager.sendInput(secondConfig.sessionId, 'peer')
      expect(dispatches).toEqual([
        firstConfig.sessionId,
        secondConfig.sessionId,
      ])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a stale provider generation from releasing a later workspace lease', async () => {
    const oldPatchStarted = createDeferred()
    const releaseOldPatch = createDeferred()
    const dispatches: string[] = []
    const emitters = new Map<
      string,
      Array<(event: ManagedProviderRuntimeEvent) => void>
    >()
    const firstConfig = createConfig('claude')
    const secondConfig = {
      ...createConfig('claude'),
      paneId: 'workspace-1:second-pane',
      sessionId: 'workspace-1:second-session',
    }
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        const sessionEmitters = emitters.get(config.sessionId) ?? []
        sessionEmitters.push(emitRuntimeEvent)
        emitters.set(config.sessionId, sessionEmitters)
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatches.push(config.sessionId)
            const turnId = `turn-${config.sessionId}`
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:00.000Z',
              provider: config.mode,
              turnId,
              type: 'turn.started',
            })
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId,
              type: 'turn.completed',
            })
          },
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.sessionId,
        capturePatch: async (_config, baseline) => {
          if (baseline === firstConfig.sessionId) {
            oldPatchStarted.resolve()
            await releaseOldPatch.promise
          }
          return {
            binaryChanges: 'none',
            changedFileCount: 1,
            message: null,
            patch: 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+turn',
            patchByteLength: 48,
            status: 'ready',
          }
        },
        disposeBaseline: async () => undefined,
      },
    })
    await Promise.all([
      manager.createSession(firstConfig),
      manager.createSession(secondConfig),
    ])
    const staleEmitter = emitters.get(firstConfig.sessionId)?.[0]

    await manager.sendInput(firstConfig.sessionId, 'first')
    await oldPatchStarted.promise
    await manager.switchSessionProvider(firstConfig.sessionId, {
      mode: 'codex',
    })

    const second = manager.sendInput(secondConfig.sessionId, 'second')
    staleEmitter?.({
      createdAt: '2026-04-11T10:00:02.000Z',
      provider: 'claude',
      state: 'completed',
      turnId: `turn-${firstConfig.sessionId}`,
      type: 'turn.completed',
    })
    await Promise.resolve()
    expect(dispatches).not.toContain(secondConfig.sessionId)

    releaseOldPatch.resolve()
    await second
    expect(dispatches).toContain(secondConfig.sessionId)
  })

  it.each([
    'close',
    'interrupt',
  ] as const)('disposes an in-flight baseline when %s fails', async (operation) => {
    const baseline = createDeferredValue<string>()
    const captureBaseline = vi.fn(async () => await baseline.promise)
    const disposeBaseline = vi.fn(async () => undefined)
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => {
          if (operation === 'close') {
            throw new Error('close failed')
          }
        },
        interrupt: async () => {
          if (operation === 'interrupt') {
            throw new Error('interrupt failed')
          }
        },
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
      }),
      getNow: () => '2026-04-11T10:00:00.000Z',
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
      turnPatchRecorder: {
        captureBaseline,
        capturePatch: async () => {
          throw new Error('unreachable')
        },
        disposeBaseline,
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    const sending = manager.sendInput(config.sessionId, 'delayed')
    await vi.waitFor(() => expect(captureBaseline).toHaveBeenCalledOnce())

    await expect(
      operation === 'close'
        ? manager.closeSession(config.sessionId)
        : manager.interruptSession(config.sessionId),
    ).rejects.toThrow(`${operation} failed`)
    baseline.resolve('late-baseline')
    await sending

    await vi.waitFor(() =>
      expect(disposeBaseline).toHaveBeenCalledWith('late-baseline'),
    )
  })

  it('cleans an in-flight baseline after closeAll times out', async () => {
    const baseline = createDeferredValue<string>()
    const closeGate = createDeferred()
    const dispatches: string[] = []
    const captureBaseline = vi.fn(async (config: ManagedSessionConfig) =>
      config.sessionId === createConfig().sessionId
        ? await baseline.promise
        : config.sessionId,
    )
    const disposeBaseline = vi.fn(async () => undefined)
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => await closeGate.promise,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          dispatches.push(config.sessionId)
        },
        start: async () => {
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
      turnPatchRecorder: {
        captureBaseline,
        capturePatch: async () => {
          throw new Error('unreachable')
        },
        disposeBaseline,
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    const sending = manager.sendInput(config.sessionId, 'delayed')
    await vi.waitFor(() => expect(captureBaseline).toHaveBeenCalledOnce())

    await manager.closeAll(1)
    expect(manager.getSnapshots()[config.sessionId]).toBeDefined()
    const peerConfig = {
      ...createConfig(),
      paneId: 'workspace-1:peer-pane',
      sessionId: 'workspace-1:peer-session',
    }
    await manager.createSession(peerConfig)
    const peer = manager.sendInput(peerConfig.sessionId, 'peer')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(dispatches).toEqual([])
    baseline.resolve('late-baseline')
    await sending

    await vi.waitFor(() =>
      expect(disposeBaseline).toHaveBeenCalledWith('late-baseline'),
    )
    closeGate.resolve()
    await vi.waitFor(() =>
      expect(manager.getSnapshots()[config.sessionId]).toBeUndefined(),
    )
    await peer
    expect(dispatches).toEqual([peerConfig.sessionId])
    await manager.closeSession(peerConfig.sessionId)
  })

  it('escalates a rejected graceful close before releasing same-workspace work', async () => {
    const dispatches: string[] = []
    const forceCloses = vi.fn(async () => undefined)
    const firstConfig = createConfig()
    const peerConfig = {
      ...createConfig(),
      paneId: 'workspace-1:peer-pane',
      sessionId: 'workspace-1:peer-session',
    }
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => ({
        close: async () => {
          if (config.sessionId === firstConfig.sessionId) {
            throw new Error('graceful close failed')
          }
        },
        forceClose: forceCloses,
        interrupt: async () => undefined,
        resolveRequest: async () => undefined,
        resolveUserInput: async () => undefined,
        sendInput: async () => {
          dispatches.push(config.sessionId)
          const turnId = `${config.sessionId}-turn`
          emitRuntimeEvent({
            createdAt: '2026-04-11T10:00:00.000Z',
            provider: config.mode,
            turnId,
            type: 'turn.started',
          })
          if (config.sessionId !== firstConfig.sessionId) {
            emitRuntimeEvent({
              createdAt: '2026-04-11T10:00:01.000Z',
              provider: config.mode,
              state: 'completed',
              turnId,
              type: 'turn.completed',
            })
          }
        },
        start: async () => {
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.sessionId,
        capturePatch: async () => ({
          binaryChanges: 'none',
          changedFileCount: 0,
          message: null,
          patch: null,
          patchByteLength: 0,
          status: 'empty',
        }),
        disposeBaseline: async () => undefined,
      },
    })
    await manager.createSession(firstConfig)
    await manager.sendInput(firstConfig.sessionId, 'first')

    await manager.closeAll()
    await manager.createSession(peerConfig)
    const peer = manager.sendInput(peerConfig.sessionId, 'peer')
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(forceCloses).toHaveBeenCalledOnce()
    await peer
    expect(dispatches).toEqual([
      firstConfig.sessionId,
      peerConfig.sessionId,
    ])
  })

  it.each([
    {
      event: {
        createdAt: '2026-04-11T10:00:01.000Z',
        provider: 'claude' as const,
        state: 'completed' as const,
        turnId: 'missing-start',
        type: 'turn.completed' as const,
      },
      name: 'completed-before-start',
      state: 'completed',
    },
    {
      event: {
        createdAt: '2026-04-11T10:00:01.000Z',
        provider: 'claude' as const,
        state: 'ready' as const,
        type: 'session.state.changed' as const,
      },
      name: 'ready-without-start',
      state: 'failed',
    },
  ] as const)(
    'captures and releases a prepared baseline on $name',
    async ({ event, state: expectedState }) => {
      let emit: ((event: ManagedProviderRuntimeEvent) => void) | undefined
      const capturePatch = vi.fn(async () => ({
        binaryChanges: 'none' as const,
        changedFileCount: 1,
        message: null,
        patch: 'diff --git a/file b/file',
        patchByteLength: 1,
        status: 'ready' as const,
      }))
      const manager = new ManagedSessionManager({
        createBackend: (config, emitRuntimeEvent) => {
          emit = emitRuntimeEvent
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
        turnPatchRecorder: {
          captureBaseline: async () => 'baseline',
          capturePatch,
          disposeBaseline: async () => undefined,
        },
      })
      const config = createConfig()
      await manager.createSession(config)
      await manager.sendInput(config.sessionId, 'missing lifecycle event')
      emit?.(event)

      await vi.waitFor(() => expect(capturePatch).toHaveBeenCalledOnce())
      expect(manager.getSnapshots()[config.sessionId]?.turns).toMatchObject([
        { state: expectedState },
      ])
      await expect(
        manager.sendInput(config.sessionId, 'next turn is not deadlocked'),
      ).resolves.toBeUndefined()
      await manager.closeSession(config.sessionId)
    },
  )

  it('retains bounded, individually attributable turn patches across snapshots', async () => {
    let emit: ((event: ManagedProviderRuntimeEvent) => void) | undefined
    const captureBaseline = vi.fn(async (config: ManagedSessionConfig) => ({
      workspaceId: config.workspaceId,
    }))
    const capturePatch = vi.fn(
      async (_config: ManagedSessionConfig, baseline: unknown) => {
        const workspaceId = (baseline as { workspaceId: string }).workspaceId
        return {
          binaryChanges: 'none' as const,
          changedFileCount: 1,
          message: null,
          patch: `diff --git a/${workspaceId}.ts b/${workspaceId}.ts\n@@ -0,0 +1 @@\n+turn`,
          patchByteLength: 76,
          status: 'ready' as const,
        }
      },
    )
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emit = emitRuntimeEvent
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
      turnPatchRecorder: {
        captureBaseline,
        capturePatch,
        disposeBaseline: async () => undefined,
      },
    })
    const config = createConfig('claude')
    await manager.createSession(config)

    for (const providerTurnId of ['provider-turn-1', 'provider-turn-2']) {
      await manager.sendInput(config.sessionId, `prompt for ${providerTurnId}`)
      emit?.({
        createdAt: '2026-04-11T10:00:00.000Z',
        provider: 'claude',
        turnId: providerTurnId,
        type: 'turn.started',
      })
      emit?.({
        createdAt: '2026-04-11T10:00:01.000Z',
        provider: 'claude',
        state: 'completed',
        turnId: providerTurnId,
        type: 'turn.completed',
      })
    }

    await vi.waitFor(() => {
      expect(capturePatch).toHaveBeenCalledTimes(2)
    })

    const reloadedSnapshot = manager.getSnapshots()[config.sessionId]
    expect(reloadedSnapshot?.turns).toMatchObject([
      { diff: { changedFileCount: 1, status: 'ready' }, sequence: 1 },
      { diff: { changedFileCount: 1, status: 'ready' }, sequence: 2 },
    ])
    const [first, second] = reloadedSnapshot?.turns ?? []
    expect(first?.id).not.toBe('provider-turn-1')
    expect(first?.id).not.toBe(second?.id)
    expect(
      manager.getTurnPatch(config.sessionId, first?.id ?? ''),
    ).toMatchObject({
      patch: expect.stringContaining('workspace-1.ts'),
      turnId: first?.id,
    })
    expect(
      manager.getTurnPatch(config.sessionId, second?.id ?? ''),
    ).toMatchObject({
      patch: expect.stringContaining('workspace-1.ts'),
      turnId: second?.id,
    })
  })

  it('ignores stale generations and keeps turn patches isolated by session workspace', async () => {
    const emitters = new Map<
      string,
      Array<(event: ManagedProviderRuntimeEvent) => void>
    >()
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        const sessionEmitters = emitters.get(config.sessionId) ?? []
        sessionEmitters.push(emitRuntimeEvent)
        emitters.set(config.sessionId, sessionEmitters)
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
      turnPatchRecorder: {
        captureBaseline: async (config) => config.workspaceId,
        capturePatch: async (_config, baseline) => ({
          binaryChanges: 'none',
          changedFileCount: 1,
          message: null,
          patch: `diff --git a/${baseline as string}.ts b/${baseline as string}.ts\n@@ -0,0 +1 @@\n+isolated`,
          patchByteLength: 64,
          status: 'ready',
        }),
        disposeBaseline: async () => undefined,
      },
    })
    const firstConfig = createConfig('claude')
    const secondConfig = {
      ...createConfig('codex'),
      cwd: '/tmp/workspace-2',
      paneId: 'workspace-2:codex-pane',
      sessionId: 'workspace-2:codex-session',
      workspaceId: 'workspace-2',
    }
    await manager.createSession(firstConfig)
    await manager.createSession(secondConfig)
    const staleFirstEmitter = emitters.get(firstConfig.sessionId)?.[0]

    await manager.switchSessionProvider(firstConfig.sessionId, {
      mode: 'codex',
    })
    staleFirstEmitter?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      provider: 'claude',
      turnId: 'stale-turn',
      type: 'turn.started',
    })
    staleFirstEmitter?.({
      createdAt: '2026-04-11T10:00:02.000Z',
      provider: 'claude',
      state: 'completed',
      turnId: 'stale-turn',
      type: 'turn.completed',
    })

    const currentFirstEmitter = emitters.get(firstConfig.sessionId)?.at(-1)
    const secondEmitter = emitters.get(secondConfig.sessionId)?.[0]
    await manager.sendInput(firstConfig.sessionId, 'current turn')
    currentFirstEmitter?.({
      createdAt: '2026-04-11T10:00:03.000Z',
      provider: 'codex',
      turnId: 'current-turn',
      type: 'turn.started',
    })
    currentFirstEmitter?.({
      createdAt: '2026-04-11T10:00:04.000Z',
      provider: 'codex',
      state: 'completed',
      turnId: 'current-turn',
      type: 'turn.completed',
    })
    await manager.sendInput(secondConfig.sessionId, 'second session turn')
    secondEmitter?.({
      createdAt: '2026-04-11T10:00:05.000Z',
      provider: 'codex',
      turnId: 'second-session-turn',
      type: 'turn.started',
    })
    secondEmitter?.({
      createdAt: '2026-04-11T10:00:06.000Z',
      provider: 'codex',
      state: 'completed',
      turnId: 'second-session-turn',
      type: 'turn.completed',
    })

    await vi.waitFor(() => {
      const firstTurn = manager.getSnapshots()[firstConfig.sessionId]?.turns[0]
      const secondTurn =
        manager.getSnapshots()[secondConfig.sessionId]?.turns[0]
      expect(firstTurn?.diff.status).toBe('ready')
      expect(secondTurn?.diff.status).toBe('ready')
    })

    const firstTurn = manager.getSnapshots()[firstConfig.sessionId]?.turns[0]
    const secondTurn = manager.getSnapshots()[secondConfig.sessionId]?.turns[0]
    expect(
      manager.getTurnPatch(firstConfig.sessionId, firstTurn?.id ?? '')?.patch,
    ).toContain('workspace-1.ts')
    expect(
      manager.getTurnPatch(secondConfig.sessionId, secondTurn?.id ?? '')?.patch,
    ).toContain('workspace-2.ts')
    expect(
      manager.getTurnPatch(firstConfig.sessionId, secondTurn?.id ?? ''),
    ).toBeNull()
  })

  it('dispatches provider work after a baseline-limit failure and exposes an explicit completed-turn state', async () => {
    let emit: ((event: ManagedProviderRuntimeEvent) => void) | undefined
    const dispatch = vi.fn()
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emit = emitRuntimeEvent
        return {
          close: async () => undefined,
          interrupt: async () => undefined,
          resolveRequest: async () => undefined,
          resolveUserInput: async () => undefined,
          sendInput: async () => {
            dispatch()
          },
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
      turnPatchRecorder: {
        captureBaseline: async () => {
          throw new Error('Git worktree is unavailable')
        },
        capturePatch: async () => {
          throw new Error('unreachable')
        },
        disposeBaseline: async () => undefined,
      },
    })
    const config = createConfig()
    await manager.createSession(config)
    await manager.sendInput(config.sessionId, 'turn with capture error')
    expect(dispatch).toHaveBeenCalledOnce()
    emit?.({
      createdAt: '2026-04-11T10:00:00.000Z',
      provider: 'claude',
      turnId: 'turn-with-capture-error',
      type: 'turn.started',
    })
    emit?.({
      createdAt: '2026-04-11T10:00:01.000Z',
      provider: 'claude',
      state: 'failed',
      turnId: 'turn-with-capture-error',
      type: 'turn.completed',
    })

    await vi.waitFor(() => {
      expect(
        manager.getSnapshots()[config.sessionId]?.turns[0]?.diff,
      ).toMatchObject({
        message: 'Git worktree is unavailable',
        status: 'error',
      })
    })
  })

  it('bounds in-memory turn summaries and evicts their lazy patches together', async () => {
    let emit: ((event: ManagedProviderRuntimeEvent) => void) | undefined
    const manager = new ManagedSessionManager({
      createBackend: (config, emitRuntimeEvent) => {
        emit = emitRuntimeEvent
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
      turnPatchRecorder: {
        captureBaseline: async () => null,
        capturePatch: async () => ({
          binaryChanges: 'none',
          changedFileCount: 1,
          message: null,
          patch: 'diff --git a/file b/file\n@@ -0,0 +1 @@\n+turn',
          patchByteLength: 48,
          status: 'ready',
        }),
        disposeBaseline: async () => undefined,
      },
    })
    const config = createConfig()
    await manager.createSession(config)

    for (let number = 1; number <= 51; number += 1) {
      const providerTurnId = `turn-${number}`
      await manager.sendInput(config.sessionId, `prompt ${number}`)
      emit?.({
        createdAt: '2026-04-11T10:00:00.000Z',
        provider: 'claude',
        turnId: providerTurnId,
        type: 'turn.started',
      })
      emit?.({
        createdAt: '2026-04-11T10:00:01.000Z',
        provider: 'claude',
        state: 'completed',
        turnId: providerTurnId,
        type: 'turn.completed',
      })
    }

    await vi.waitFor(() => {
      const turns = manager.getSnapshots()[config.sessionId]?.turns ?? []
      expect(turns).toHaveLength(50)
      expect(turns[0]?.sequence).toBe(2)
      expect(turns.at(-1)?.diff.status).toBe('ready')
    })
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
    'keeps Codex stderr diagnostics nonterminal',
    async () => {
      const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-stderr-'))
      temporaryPaths.push(directory)
      const command = path.join(directory, 'codex-diagnostic-server')
      writeFileSync(
        command,
        [
          '#!/bin/sh',
          'request=0',
          'while IFS= read -r line; do',
          '  request=$((request + 1))',
          '  if [ "$request" -eq 1 ]; then',
          "    printf '%s\\n' '{\"id\":1,\"result\":{}}'",
          '  elif [ "$request" -eq 3 ]; then',
          "    printf '%s\\n' '{\"id\":2,\"result\":{\"thread\":{\"id\":\"thread-1\"}}}'",
          "    printf '%s\\n' 'nonfatal startup diagnostic' >&2",
          '  fi',
          'done',
        ].join('\n'),
      )
      chmodSync(command, 0o755)
      process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
      process.env.AIDE_CODEX_COMMAND = command
      const manager = new ManagedSessionManager({
        getNow: () => '2026-04-11T10:00:00.000Z',
        onRuntimeEvent: () => undefined,
        onUpdate: () => undefined,
      })
      const config = createConfig('codex')

      await manager.createSession(config)

      await vi.waitFor(() =>
        expect(manager.getSnapshots()[config.sessionId]).toMatchObject({
          content: [
            {
              kind: 'system',
              text: expect.stringContaining('nonfatal startup diagnostic'),
            },
          ],
          sessionState: 'ready',
        }),
      )
      await manager.closeSession(config.sessionId)
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
})
