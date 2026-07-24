import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { createAideDatabase } from './database'
import {
  WorkspaceSetupManager,
  resolveWorkspaceSetupShell,
} from './workspace-setup-manager'

class FakeChild extends EventEmitter {
  public readonly stderr = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: BufferEncoding) => void
  }
  public readonly stdout = new EventEmitter() as EventEmitter & {
    setEncoding: (encoding: BufferEncoding) => void
  }
  public readonly kill = vi.fn()
  public pid = 4242

  public constructor() {
    super()
    this.stdout.setEncoding = vi.fn()
    this.stderr.setEncoding = vi.fn()
  }

  public close(exitCode: number | null, signal: NodeJS.Signals | null = null) {
    this.emit('close', exitCode, signal)
  }
}

function createFixture(command: string | null = 'printf ready') {
  const database = createAideDatabase(':memory:')
  const project = database.createProject({
    defaultBranch: 'main',
    name: 'aide',
    remoteUrl: null,
    repoRoot: '/workspace/aide',
  })
  if (command !== null) {
    database.updateProject(project.id, { setupCommand: command })
  }
  const workspace = database.createWorkspace({
    branchName: 'feature/setup',
    name: 'Setup',
    projectId: project.id,
    windowId: null,
    worktreePath: '/workspace/aide/.worktrees/setup',
  })
  return { database, project, workspace }
}

describe('WorkspaceSetupManager', () => {
  it('runs exactly one cwd-scoped shell process and gates agents until success', () => {
    const { database, workspace } = createFixture()
    const child = new FakeChild()
    const spawn = vi.fn(() => child as never)
    const updates: unknown[] = []
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      onUpdate: (event) => updates.push(event),
      spawn,
      store: database,
    })

    expect(() => manager.assertManagedSessionAllowed(workspace.id)).toThrow(
      'required',
    )
    expect(manager.run(workspace.id).state).toBe('running')
    expect(manager.run(workspace.id).state).toBe('running')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      '/bin/sh',
      ['-lc', 'printf ready'],
      expect.objectContaining({
        cwd: workspace.worktreePath,
        detached: true,
        windowsHide: true,
      }),
    )

    child.stdout.emit('data', 'ready\n')
    child.close(0)

    expect(manager.getSnapshot(workspace.id)).toMatchObject({
      outputTail: 'ready\n',
      state: 'succeeded',
    })
    expect(() =>
      manager.assertManagedSessionAllowed(workspace.id),
    ).not.toThrow()
    expect(updates.length).toBeGreaterThan(2)
    database.close()
  })

  it('does not gate projects without a command and persists not-required state', () => {
    const { database, workspace } = createFixture(null)
    const manager = new WorkspaceSetupManager({
      onUpdate: () => undefined,
      spawn: vi.fn() as never,
      store: database,
    })

    expect(() =>
      manager.assertManagedSessionAllowed(workspace.id),
    ).not.toThrow()
    expect(manager.run(workspace.id)).toMatchObject({
      commandRequired: false,
      state: 'not-required',
    })
    database.close()
  })

  it('returns the authoritative failed snapshot when spawning fails synchronously', () => {
    const { database, workspace } = createFixture()
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      onUpdate: () => undefined,
      spawn: vi.fn(() => {
        throw new Error('spawn failed')
      }),
      store: database,
    })

    expect(manager.run(workspace.id)).toMatchObject({ state: 'failed' })
    database.close()
  })

  it('bounds output, cancels the detached process group, and records a retryable terminal state', () => {
    const { database, workspace } = createFixture()
    const child = new FakeChild()
    const kill = vi.fn(() => true)
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      kill,
      onUpdate: () => undefined,
      spawn: vi.fn(() => child as never),
      store: database,
    })

    manager.run(workspace.id)
    child.stderr.emit('data', `${'x'.repeat(70_000)}\n`)
    const cancelled = manager.cancel(workspace.id)

    expect(cancelled).toMatchObject({
      outputTruncated: true,
      state: 'cancelled',
    })
    expect(Buffer.byteLength(cancelled.outputTail)).toBeLessThanOrEqual(
      64 * 1024,
    )
    expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')
    expect(() => manager.assertManagedSessionAllowed(workspace.id)).toThrow(
      'cancelled',
    )
    database.close()
  })

  it('invalidates prior success when the project setup revision changes without rerunning it', () => {
    const { database, project, workspace } = createFixture('printf first')
    const child = new FakeChild()
    const spawn = vi.fn(() => child as never)
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      onUpdate: () => undefined,
      spawn,
      store: database,
    })

    manager.run(workspace.id)
    database.updateProject(project.id, { setupCommand: 'printf second' })
    expect(manager.getSnapshot(workspace.id).state).toBe('running')
    child.close(0)

    expect(spawn).toHaveBeenCalledTimes(1)
    expect(manager.getSnapshot(workspace.id)).toMatchObject({
      projectSetupRevision: 2,
      state: 'not-run',
    })
    expect(() => manager.assertManagedSessionAllowed(workspace.id)).toThrow(
      'required',
    )
    database.close()
  })

  it('advances the collection revision when a command change updates virtual workspace state', () => {
    const { database, project, workspace } = createFixture(null)
    const updates: Array<{
      revision: number
      setup: { state: string; workspaceId: string }
    }> = []
    const manager = new WorkspaceSetupManager({
      onUpdate: (event) => updates.push(event),
      spawn: vi.fn() as never,
      store: database,
    })
    const hydratedRevision = manager.getCollectionSnapshot().revision

    database.updateProject(project.id, { setupCommand: 'printf configured' })
    manager.publishProjectSnapshots(project.id)

    expect(updates.at(-1)).toMatchObject({
      setup: {
        state: 'not-run',
        workspaceId: workspace.id,
      },
    })
    expect(updates.at(-1)?.revision).toBeGreaterThan(hydratedRevision)
    expect(manager.getCollectionSnapshot().revision).toBe(
      updates.at(-1)?.revision,
    )
    database.close()
  })

  it('waits through bounded SIGKILL completion during shutdown', async () => {
    const { database, workspace } = createFixture()
    const child = new FakeChild()
    const killGrace = { callback: null as (() => void) | null }
    const kill = vi.fn(() => true)
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      kill,
      onUpdate: () => undefined,
      setTimeout: ((callback: () => void) => {
        killGrace.callback = callback
        return 1 as never
      }) as unknown as typeof setTimeout,
      spawn: vi.fn(() => child as never),
      store: database,
    })
    manager.run(workspace.id)

    let completed = false
    const shutdown = manager.shutdown().then(() => {
      completed = true
    })
    await Promise.resolve()
    expect(completed).toBe(false)
    expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGTERM')

    if (!killGrace.callback) throw new Error('Expected SIGKILL grace callback.')
    killGrace.callback()
    await shutdown
    expect(kill).toHaveBeenCalledWith(-child.pid, 'SIGKILL')
    database.close()
  })

  it('stops a live process before workspace deletion can cascade its state', async () => {
    const { database, workspace } = createFixture()
    const child = new FakeChild()
    const manager = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      onUpdate: () => undefined,
      spawn: vi.fn(() => child as never),
      store: database,
    })
    manager.run(workspace.id)

    const stopping = manager.cancelForWorkspace(workspace.id)
    child.close(null, 'SIGTERM')
    await stopping
    expect(database.deleteWorkspace(workspace.id)).toBe(true)

    expect(database.getWorkspaceSetupState(workspace.id)).toBeNull()
    database.close()
  })

  it('reconciles an app-relaunch running record to a truthful failed state', () => {
    const { database, workspace } = createFixture()
    const firstChild = new FakeChild()
    const first = new WorkspaceSetupManager({
      getShell: () => '/bin/sh',
      onUpdate: () => undefined,
      spawn: vi.fn(() => firstChild as never),
      store: database,
    })
    first.run(workspace.id)

    const reopened = new WorkspaceSetupManager({
      onUpdate: () => undefined,
      spawn: vi.fn() as never,
      store: database,
    })

    expect(reopened.getSnapshot(workspace.id)).toMatchObject({
      errorSummary: 'Setup was interrupted when Aide closed.',
      state: 'failed',
    })
    database.close()
  })
})

describe('resolveWorkspaceSetupShell', () => {
  it('uses an executable absolute user shell and otherwise falls back deterministically', () => {
    expect(
      resolveWorkspaceSetupShell({
        environmentShell: '/definitely/missing-shell',
        fallbackShells: ['/bin/sh'],
      }),
    ).toBe('/bin/sh')
  })
})
