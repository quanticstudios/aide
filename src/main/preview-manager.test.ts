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
    const manager = new PreviewManager(database)

    const initial = manager.ensure(firstWorkspace.id)
    expect(initial.tabs).toHaveLength(1)
    expect(initial.tabs[0]?.url).toBe('http://127.0.0.1:4173')

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
        status: 'ready',
        tabId,
        url: 'https://example.com',
        workspaceId: firstWorkspace.id,
      }),
    ).toThrow(/loopback/)
    expect(manager.ensure(firstWorkspace.id).revision).toBe(snapshot.revision)
    database.close()
  })
})
