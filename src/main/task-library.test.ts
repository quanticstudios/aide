import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import type { ManagedSessionSnapshot } from '../shared/managed-session'
import { createAideDatabase } from './database'
import { TaskLibrary } from './task-library'

function fixture(databasePath = ':memory:') {
  const database = createAideDatabase(databasePath)
  const project = database.createProject({
    name: 'Aide',
    repoRoot: '/repo',
    defaultBranch: 'main',
    remoteUrl: null,
  })
  const workspace = database.createWorkspace({
    projectId: project.id,
    name: 'Feature',
    branchName: 'feature/search',
    worktreePath: '/repo',
    windowId: null,
  })
  const snapshot: ManagedSessionSnapshot = {
    sessionId: 'saved-task',
    workspaceId: workspace.id,
    paneId: 'agent:one',
    provider: 'claude',
    model: null,
    effort: null,
    interactionMode: 'build',
    detail: null,
    lastCompletedAt: '2026-09-17T10:00:00.000Z',
    lastError: null,
    lastErrorAt: null,
    content: [
      {
        id: 'prompt',
        kind: 'user-prompt',
        text: 'Fix the checkout',
        provider: null,
        turnId: 'turn',
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
      {
        id: 'answer',
        kind: 'assistant-text',
        text: 'The retry token is cedar-47.',
        provider: 'claude',
        turnId: 'turn',
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
      {
        id: 'private',
        kind: 'reasoning-text',
        text: 'hidden-canary',
        provider: 'claude',
        turnId: 'turn',
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
    ],
    turns: [],
    pendingApprovals: [],
    pendingUserInputs: [],
    permissionMode: 'default',
    planApproval: null,
    revision: 1,
    runtimeGeneration: 1,
    running: false,
    selectionNotice: null,
    serviceTier: null,
    sessionState: 'ready',
    updatedAt: '2026-09-17T10:00:00.000Z',
  }
  database.saveManagedSession({
    config: {
      cwd: '/repo',
      mode: 'claude',
      sessionId: snapshot.sessionId,
      paneId: snapshot.paneId,
      workspaceId: workspace.id,
    },
    snapshot,
  })
  const live = { [snapshot.sessionId]: snapshot }
  return {
    database,
    snapshot,
    live,
    library: new TaskLibrary(database, () => live),
  }
}

describe('TaskLibrary', () => {
  it('searches conversation text and branch names without exposing hidden reasoning', () => {
    const { database, library } = fixture()
    expect(library.getSnapshot('CEDAR-47').tasks[0]?.title).toBe(
      'Fix the checkout',
    )
    expect(library.getSnapshot('feature/search').tasks).toHaveLength(1)
    expect(library.getSnapshot('hidden-canary').tasks).toEqual([])
    expect(library.getSnapshot().tasks[0]?.excerpt).not.toContain(
      'hidden-canary',
    )
    database.close()
  })

  it('persists title, pin, archive, read state and notification preferences across restart', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-task-library-'))
    try {
      const file = path.join(directory, 'state.sqlite')
      const { database, library } = fixture(file)
      const task = library.getSnapshot().tasks[0]
      if (!task) throw new Error('Missing fixture task')
      library.update(task.sessionId, {
        title: 'Checkout recovery',
        pinned: true,
        archived: true,
        readActivityKey: task.activityKey,
      })
      expect(library.getSnapshot().notificationSoundsEnabled).toBe(false)
      database.setTaskNotificationsEnabled(false)
      database.setTaskNotificationSoundsEnabled(true)
      database.close()
      const reopened = createAideDatabase(file)
      const restored = new TaskLibrary(reopened, () => ({}))
      expect(restored.getSnapshot('recovery')).toMatchObject({
        notificationsEnabled: false,
        notificationSoundsEnabled: true,
        tasks: [
          {
            title: 'Checkout recovery',
            pinned: true,
            archived: true,
            unread: false,
          },
        ],
      })
      restored.update(task.sessionId, { archived: false })
      expect(restored.getSnapshot('cedar-47').tasks[0]?.archived).toBe(false)
      reopened.close()
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects archiving active work and stale read markers without losing newer activity', () => {
    const { database, library, snapshot } = fixture()
    const earlierKey = library.getSnapshot().tasks[0]?.activityKey
    snapshot.pendingUserInputs = [
      { id: 'question', detail: null, questions: [] },
    ]
    expect(() =>
      library.update(snapshot.sessionId, { archived: true }),
    ).toThrow('Finish or interrupt')
    expect(() =>
      library.update(snapshot.sessionId, { readActivityKey: earlierKey }),
    ).toThrow('newer activity')
    expect(library.getSnapshot().tasks[0]).toMatchObject({
      status: 'input',
      unread: true,
      archived: false,
    })
    expect(() => library.update('unknown-task', { pinned: true })).toThrow(
      'no longer available',
    )
    expect(() => library.update(snapshot.sessionId, { title: ' ' })).toThrow()
    database.close()
  })

  it('notifies only new attention, respecting persisted preferences', () => {
    const { database, library, snapshot } = fixture()
    expect(library.nextNotification(snapshot)).toBeNull()
    const completedKey = library.getSnapshot().tasks[0]?.activityKey
    library.update(snapshot.sessionId, { readActivityKey: completedKey })
    snapshot.runtimeGeneration += 1
    expect(library.getSnapshot().tasks[0]?.unread).toBe(false)
    expect(library.nextNotification(snapshot)).toBeNull()
    snapshot.pendingApprovals = [
      {
        id: 'approval-1',
        detail: null,
        requestType: 'file-change-approval',
        request: { toolName: 'Edit' },
      },
    ]
    expect(library.nextNotification(snapshot)).toEqual({
      sessionId: snapshot.sessionId,
      kind: 'approval',
      title: 'Fix the checkout',
      body: 'Approval needed: Edit',
    })
    expect(library.nextNotification(snapshot)).toBeNull()
    library.update(snapshot.sessionId, { title: 'Checkout retry' })
    snapshot.pendingApprovals[0].id = 'approval-2'
    expect(library.nextNotification(snapshot)?.title).toBe('Checkout retry')
    database.setTaskNotificationsEnabled(false)
    snapshot.pendingApprovals[0].id = 'approval-3'
    expect(library.nextNotification(snapshot)).toBeNull()
    database.close()
  })

  it('counts live threads waiting on an approval or an answer', () => {
    const { database, library, live, snapshot } = fixture()
    expect(library.attentionCount()).toBe(0)
    snapshot.pendingApprovals = [
      { id: 'approval-1', detail: null, requestType: 'file-change-approval' },
    ]
    live.other = {
      ...snapshot,
      sessionId: 'other',
      pendingApprovals: [],
      pendingUserInputs: [{ id: 'input-1', detail: null, questions: [] }],
    }
    live.running = {
      ...snapshot,
      sessionId: 'running',
      pendingApprovals: [],
      sessionState: 'running',
    }
    expect(library.attentionCount()).toBe(2)
    database.close()
  })
})
