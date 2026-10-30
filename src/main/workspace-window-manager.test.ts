import { describe, expect, it, vi } from 'vitest'

import { createAideDatabase } from './database'
import {
  type WorkspaceWindowController,
  WorkspaceWindowManager,
} from './workspace-window-manager'

function createWorkspaceFixture() {
  const database = createAideDatabase(':memory:')
  const project = database.createProject({
    defaultBranch: 'main',
    name: 'aide',
    remoteUrl: null,
    repoRoot: '/workspace/aide',
  })
  const workspace = database.createWorkspace({
    branchName: 'feature/detach',
    name: 'Detach workspace',
    projectId: project.id,
    windowId: null,
    worktreePath: '/workspace/aide/.worktrees/detach',
  })

  return { database, workspace }
}

function createWindowController(): WorkspaceWindowController & {
  closeWindow: (windowId: string) => void
  createWorkspaceWindow: ReturnType<typeof vi.fn>
  focusWorkspaceWindow: ReturnType<typeof vi.fn>
} {
  const closeHandlers = new Map<string, () => void>()
  const createWorkspaceWindow = vi.fn(
    (context: { windowId: string }, onClosed: () => void) => {
      closeHandlers.set(context.windowId, onClosed)
    },
  )
  const focusWorkspaceWindow = vi.fn(() => false)

  return {
    closeWindow: (windowId) => closeHandlers.get(windowId)?.(),
    createWorkspaceWindow,
    focusWorkspaceWindow,
  }
}

describe('WorkspaceWindowManager', () => {
  it('detaches once, then focuses the live owner instead of creating a duplicate', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })
    const initialRevision = database.getSnapshot().catalogRevision

    expect(manager.detachWorkspace(workspace.id)).toEqual({
      outcome: 'detached',
      windowId: 'workspace-window-1',
      workspaceId: workspace.id,
    })
    expect(database.getWorkspace(workspace.id)?.windowId).toBe(
      'workspace-window-1',
    )
    expect(windows.createWorkspaceWindow).toHaveBeenCalledOnce()
    expect(ownershipChanges).toHaveBeenCalledOnce()
    expect(database.getSnapshot().catalogRevision).toBe(initialRevision + 1)

    windows.focusWorkspaceWindow.mockReturnValueOnce(true)

    expect(manager.detachWorkspace(workspace.id)).toEqual({
      outcome: 'focused-existing',
      windowId: 'workspace-window-1',
      workspaceId: workspace.id,
    })
    expect(windows.focusWorkspaceWindow).toHaveBeenCalledWith(
      'workspace-window-1',
    )
    expect(windows.createWorkspaceWindow).toHaveBeenCalledOnce()
    expect(ownershipChanges).toHaveBeenCalledOnce()

    database.close()
  })

  it('returns a closed detached workspace to the main window and publishes the committed repair', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })

    manager.detachWorkspace(workspace.id)
    windows.closeWindow('workspace-window-1')

    expect(database.getWorkspace(workspace.id)?.windowId).toBeNull()
    expect(ownershipChanges).toHaveBeenCalledTimes(2)

    database.close()
  })

  it('repairs a stale owner before allocating a fresh detached window', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    database.updateWorkspace(workspace.id, { windowId: 'stale-window-id' })
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })
    const initialRevision = database.getSnapshot().catalogRevision

    expect(manager.detachWorkspace(workspace.id)).toEqual({
      outcome: 'detached',
      windowId: 'workspace-window-1',
      workspaceId: workspace.id,
    })
    expect(database.getWorkspace(workspace.id)?.windowId).toBe(
      'workspace-window-1',
    )
    expect(ownershipChanges).toHaveBeenCalledTimes(2)
    expect(database.getSnapshot().catalogRevision).toBe(initialRevision + 2)

    database.close()
  })

  it('compensates ownership if window creation throws', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    windows.createWorkspaceWindow.mockImplementation(() => {
      throw new Error('Window creation failed.')
    })
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })
    const initialRevision = database.getSnapshot().catalogRevision

    expect(() => manager.detachWorkspace(workspace.id)).toThrow(
      'Window creation failed.',
    )
    expect(database.getWorkspace(workspace.id)?.windowId).toBeNull()
    expect(database.getSnapshot().catalogRevision).toBe(initialRevision + 2)
    expect(ownershipChanges).toHaveBeenCalledTimes(2)

    database.close()
  })

  it('does not report a detached workspace when its window closes synchronously during creation', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    windows.createWorkspaceWindow.mockImplementation((_context, onClosed) => {
      onClosed()
    })
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })

    const initialRevision = database.getSnapshot().catalogRevision

    expect(() => manager.detachWorkspace(workspace.id)).toThrow(
      'Workspace window closed before it could be shown.',
    )

    expect(database.getWorkspace(workspace.id)?.windowId).toBeNull()
    expect(ownershipChanges).toHaveBeenCalledTimes(2)
    expect(database.getSnapshot().catalogRevision).toBe(initialRevision + 2)

    database.close()
  })

  it('does not let an old close callback clear a newer owner', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })

    manager.detachWorkspace(workspace.id)
    database.compareAndSetWorkspaceWindowId(
      workspace.id,
      'workspace-window-1',
      'workspace-window-2',
    )
    windows.closeWindow('workspace-window-1')

    expect(database.getWorkspace(workspace.id)?.windowId).toBe(
      'workspace-window-2',
    )
    expect(ownershipChanges).toHaveBeenCalledOnce()

    database.close()
  })

  it('repairs stale persisted owner IDs before a renderer hydrates', () => {
    const { database, workspace } = createWorkspaceFixture()
    const windows = createWindowController()
    const ownershipChanges = vi.fn()
    database.updateWorkspace(workspace.id, { windowId: 'stale-window-id' })
    const manager = new WorkspaceWindowManager({
      createWindowId: () => 'workspace-window-1',
      onOwnershipChanged: ownershipChanges,
      store: database,
      windows,
    })

    expect(manager.repairStaleOwnership()).toBe(1)
    expect(database.getWorkspace(workspace.id)?.windowId).toBeNull()
    expect(ownershipChanges).not.toHaveBeenCalled()

    database.close()
  })
})
