import { describe, expect, it } from 'vitest'

import { createAideDatabase } from './database'
import { PreviewManager } from './preview-manager'

function createWorkspaceDatabase() {
  const database = createAideDatabase(':memory:')
  const project = database.createProject({
    defaultBranch: 'main',
    name: 'aide',
    remoteUrl: null,
    repoRoot: '/workspace/aide',
  })
  const firstWorkspace = database.createWorkspace({
    branchName: 'main',
    name: 'main',
    projectId: project.id,
    windowId: null,
    worktreePath: '/workspace/aide',
  })
  const secondWorkspace = database.createWorkspace({
    branchName: 'next',
    name: 'next',
    projectId: project.id,
    windowId: null,
    worktreePath: '/workspace/aide-next',
  })

  return { database, firstWorkspace, secondWorkspace }
}

describe('PreviewManager', () => {
  it('creates the default tab once and preserves an initialized empty state', () => {
    const { database, firstWorkspace } = createWorkspaceDatabase()
    const manager = new PreviewManager(database, {
      getNow: () => '2026-07-13T10:00:00.000Z',
    })

    const initial = manager.ensure(firstWorkspace.id)
    expect(initial.tabs).toHaveLength(1)
    expect(initial.tabs[0]).toMatchObject({
      updatedAt: '2026-07-13T10:00:00.000Z',
      url: 'http://127.0.0.1:4173',
      workspaceId: firstWorkspace.id,
    })
    expect(initial.tabs[0]?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )

    manager.closeTab(firstWorkspace.id, initial.tabs[0]?.id ?? '')
    const empty = manager.ensure(firstWorkspace.id)

    expect(empty).toMatchObject({
      activeTabId: null,
      initialized: true,
      tabs: [],
    })
    database.close()
  })

  it('keeps workspace tabs isolated and publishes monotonic revisions', () => {
    const { database, firstWorkspace, secondWorkspace } =
      createWorkspaceDatabase()
    const events: Record<string, number[]> = {}
    const manager = new PreviewManager(database, {
      onUpdate: (event) => {
        const revisions = events[event.snapshot.workspaceId] ?? []
        events[event.snapshot.workspaceId] = [
          ...revisions,
          event.snapshot.revision,
        ]
      },
    })

    const first = manager.ensure(firstWorkspace.id)
    const added = manager.openTab(firstWorkspace.id, 'localhost:3000')
    const second = manager.ensure(secondWorkspace.id)

    expect(added.revision).toBeGreaterThan(first.revision)
    expect(second.tabs).toHaveLength(1)
    expect(second.tabs[0]?.url).toBe('http://127.0.0.1:4173')
    expect(events[firstWorkspace.id]).toEqual([1, 2])
    expect(events[secondWorkspace.id]).toEqual([1])
    database.close()
  })

  it('rejects external navigation reports without changing durable state', () => {
    const { database, firstWorkspace } = createWorkspaceDatabase()
    const manager = new PreviewManager(database)
    const snapshot = manager.ensure(firstWorkspace.id)
    const tabId = snapshot.tabs[0]?.id ?? ''

    expect(() =>
      manager.reportNavigation({
        canGoBack: false,
        canGoForward: false,
        expectedRevision: snapshot.revision,
        status: 'success',
        tabId,
        url: 'https://example.com',
        workspaceId: firstWorkspace.id,
      }),
    ).toThrow(/loopback/)
    expect(manager.ensure(firstWorkspace.id).revision).toBe(snapshot.revision)
    database.close()
  })

  it('lists durable workspace snapshots and ignores stale guest navigation', () => {
    const { database, firstWorkspace, secondWorkspace } =
      createWorkspaceDatabase()
    const manager = new PreviewManager(database)
    const initial = manager.ensure(firstWorkspace.id)
    const tabId = initial.tabs[0]?.id ?? ''
    const navigated = manager.navigate(
      firstWorkspace.id,
      tabId,
      'http://localhost:3000/current',
    )

    const stale = manager.reportNavigation({
      canGoBack: false,
      canGoForward: false,
      expectedRevision: initial.revision,
      status: 'success',
      tabId,
      url: initial.tabs[0]?.url ?? '',
      workspaceId: firstWorkspace.id,
    })
    const restored = new PreviewManager(database).list()

    expect(stale).toEqual(navigated)
    expect(restored[firstWorkspace.id]).toEqual(navigated)
    expect(restored[secondWorkspace.id]).toBeUndefined()
    database.close()
  })
})
