import { describe, expect, it } from 'vitest'

import type { ManagedSessionSnapshot } from '../shared/managed-session'
import type { WorkspaceRecord } from '../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../shared/preview'
import type { WorkspaceActivityCollectionSnapshot } from '../shared/workspace-activity'
import {
  canAccessWorkspace,
  requireMainWindowAccess,
  requireSessionAccess,
  requireWorkspaceAccess,
  scopeManagedSessionSnapshots,
  scopeWorkspaceActivitySnapshot,
  scopeWorkspacePreviewSnapshots,
} from './workspace-access'

const mainWorkspace: WorkspaceRecord = {
  branchName: 'main',
  createdAt: '2026-07-13T00:00:00.000Z',
  id: 'workspace-main',
  name: 'Main',
  projectId: 'project-1',
  updatedAt: '2026-07-13T00:00:00.000Z',
  windowId: null,
  worktreePath: '/workspace/main',
}

const detachedWorkspace: WorkspaceRecord = {
  ...mainWorkspace,
  id: 'workspace-detached',
  name: 'Detached',
  windowId: 'window-detached',
}

const activitySnapshot: WorkspaceActivityCollectionSnapshot = {
  activitiesByWorkspace: {
    [mainWorkspace.id]: [
      {
        detail: null,
        paneId: 'terminal',
        provider: 'terminal',
        sessionId: 'terminal-main',
        source: 'fallback',
        state: 'terminal-running',
        updatedAt: '2026-07-13T00:00:00.000Z',
        workspaceId: mainWorkspace.id,
      },
    ],
    [detachedWorkspace.id]: [
      {
        detail: null,
        paneId: 'terminal',
        provider: 'terminal',
        sessionId: 'terminal-detached',
        source: 'fallback',
        state: 'terminal-running',
        updatedAt: '2026-07-13T00:00:00.000Z',
        workspaceId: detachedWorkspace.id,
      },
    ],
  },
  revision: 3,
}

function managedSnapshot(workspaceId: string): ManagedSessionSnapshot {
  return {
    content: [],
    detail: null,
    effort: null,
    interactionMode: 'build',
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    model: null,
    paneId: 'agent',
    pendingApprovals: [],
    pendingUserInputs: [],
    planApproval: null,
    provider: 'codex',
    revision: 1,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: null,
    serviceTier: null,
    sessionId: `managed-${workspaceId}`,
    sessionState: 'ready',
    turns: [],
    updatedAt: '2026-07-13T00:00:00.000Z',
    workspaceId,
  }
}

function previewSnapshot(workspaceId: string): WorkspacePreviewSnapshot {
  return {
    activeTabId: null,
    initialized: true,
    revision: 1,
    tabs: [],
    workspaceId,
  }
}

describe('workspace access', () => {
  const store = {
    getWorkspace: (workspaceId: string) =>
      [mainWorkspace, detachedWorkspace].find(
        (workspace) => workspace.id === workspaceId,
      ) ?? null,
  }
  const mainContext = {
    kind: 'main' as const,
    windowId: null,
    workspaceId: null,
  }
  const detachedContext = {
    kind: 'workspace' as const,
    windowId: detachedWorkspace.windowId as string,
    workspaceId: detachedWorkspace.id,
  }

  it('authorizes only the authoritative persisted owner', () => {
    expect(canAccessWorkspace(mainContext, mainWorkspace)).toBe(true)
    expect(canAccessWorkspace(mainContext, detachedWorkspace)).toBe(false)
    expect(canAccessWorkspace(detachedContext, detachedWorkspace)).toBe(true)
    expect(canAccessWorkspace(detachedContext, mainWorkspace)).toBe(false)

    expect(() =>
      requireWorkspaceAccess(store, mainContext, detachedWorkspace.id),
    ).toThrow('not owned by this window')
    expect(() =>
      requireWorkspaceAccess(store, detachedContext, mainWorkspace.id),
    ).toThrow('not owned by this window')
    expect(
      requireWorkspaceAccess(store, detachedContext, detachedWorkspace.id),
    ).toEqual(detachedWorkspace)
  })

  it('restricts global operations and session operations to their sender owner', () => {
    expect(() => requireMainWindowAccess(detachedContext)).toThrow(
      'main window',
    )
    expect(() =>
      requireSessionAccess(
        detachedContext,
        'terminal-main',
        new Map([['terminal-main', mainWorkspace.id]]),
        store,
      ),
    ).toThrow('not owned by this window')
    expect(() =>
      requireSessionAccess(detachedContext, 'unknown', new Map(), store),
    ).toThrow('Unknown session')
  })

  it('filters collection snapshots to the receiver workspace set', () => {
    const allowedWorkspaceIds = new Set([detachedWorkspace.id])

    expect(
      scopeWorkspaceActivitySnapshot(activitySnapshot, allowedWorkspaceIds),
    ).toEqual({
      activitiesByWorkspace: {
        [detachedWorkspace.id]:
          activitySnapshot.activitiesByWorkspace[detachedWorkspace.id],
      },
      revision: 3,
    })
    expect(
      scopeManagedSessionSnapshots(
        {
          main: managedSnapshot(mainWorkspace.id),
          detached: managedSnapshot(detachedWorkspace.id),
        },
        allowedWorkspaceIds,
      ),
    ).toEqual({ detached: managedSnapshot(detachedWorkspace.id) })
    expect(
      scopeWorkspacePreviewSnapshots(
        {
          [mainWorkspace.id]: previewSnapshot(mainWorkspace.id),
          [detachedWorkspace.id]: previewSnapshot(detachedWorkspace.id),
        },
        allowedWorkspaceIds,
      ),
    ).toEqual({
      [detachedWorkspace.id]: previewSnapshot(detachedWorkspace.id),
    })
  })
})
