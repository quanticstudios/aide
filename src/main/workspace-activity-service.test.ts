import { describe, expect, it, vi } from 'vitest'

import type { ManagedSessionSnapshot } from '../shared/managed-session'
import { WorkspaceActivityService } from './workspace-activity-service'

function snapshot(
  overrides: Partial<ManagedSessionSnapshot> = {},
): ManagedSessionSnapshot {
  return {
    content: [],
    detail: null,
    effort: null,
    interactionMode: 'build',
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    model: null,
    paneId: 'pane-1',
    pendingApprovals: [],
    pendingUserInputs: [],
    planApproval: null,
    provider: 'claude',
    revision: 1,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: null,
    serviceTier: null,
    sessionId: 'session-1',
    sessionState: 'ready',
    turns: [],
    updatedAt: '2026-04-06T12:00:00.000Z',
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

describe('WorkspaceActivityService', () => {
  it('derives managed activity only from managed snapshots', () => {
    const service = new WorkspaceActivityService({ onUpdate: () => undefined })

    service.handleManagedSessionSnapshot(
      snapshot({
        pendingApprovals: [
          {
            detail: 'Approve the command',
            id: 'approval-1',
            requestType: 'command-execution-approval',
          },
        ],
      }),
    )

    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1']?.[0],
    ).toMatchObject({
      source: 'managed',
      state: 'pending-approval',
    })
  })

  it('ignores stale managed snapshot revisions and generations', () => {
    const service = new WorkspaceActivityService({ onUpdate: () => undefined })

    service.handleManagedSessionSnapshot(
      snapshot({ revision: 2, sessionState: 'running' }),
    )
    service.handleManagedSessionSnapshot(
      snapshot({ revision: 1, sessionState: 'ready' }),
    )
    service.handleManagedSessionSnapshot(
      snapshot({ revision: 99, runtimeGeneration: 0, sessionState: 'ready' }),
    )

    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1']?.[0],
    ).toMatchObject({
      state: 'working',
    })
  })

  it('does not surface historic completion before a workspace has been visited', () => {
    const service = new WorkspaceActivityService({ onUpdate: () => undefined })

    service.handleManagedSessionSnapshot(
      snapshot({
        lastCompletedAt: '2026-04-06T12:00:00.000Z',
        running: false,
        sessionState: 'stopped',
      }),
    )

    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1'],
    ).toBeUndefined()
  })

  it('surfaces errors newer than the persisted visit watermark', () => {
    const service = new WorkspaceActivityService({
      onUpdate: () => undefined,
      visitWatermarks: { 'workspace-1': '2026-04-06T11:59:00.000Z' },
    })

    service.handleManagedSessionSnapshot(
      snapshot({
        lastError: 'Provider failed',
        lastErrorAt: '2026-04-06T12:01:00.000Z',
        revision: 2,
        sessionState: 'error',
        updatedAt: '2026-04-06T12:01:00.000Z',
      }),
    )

    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1']?.[0],
    ).toMatchObject({
      state: 'error',
    })
  })

  it('acknowledges activity through the latest processed update on visit', () => {
    const persisted = vi.fn()
    const service = new WorkspaceActivityService({
      onUpdate: () => undefined,
      onWorkspaceVisited: persisted,
    })
    service.handleManagedSessionSnapshot(
      snapshot({
        lastCompletedAt: '2026-04-06T12:01:00.000Z',
        running: false,
        sessionState: 'stopped',
        updatedAt: '2026-04-06T12:01:00.000Z',
      }),
    )

    service.markWorkspaceVisited('workspace-1')

    expect(persisted).toHaveBeenCalledWith(
      'workspace-1',
      '2026-04-06T12:01:00.000Z',
    )
    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1'],
    ).toBeUndefined()
  })

  it('publishes revisioned collections and gives plan-ready its own state', () => {
    const events: unknown[] = []
    const service = new WorkspaceActivityService({
      onUpdate: (event) => events.push(event),
    })

    service.handleManagedSessionSnapshot(
      snapshot({
        interactionMode: 'plan',
        planApproval: { detail: 'Apply the plan', id: 'plan-1' },
        revision: 3,
      }),
    )

    expect(service.getSnapshot()).toMatchObject({
      revision: 1,
      activitiesByWorkspace: {
        'workspace-1': [{ state: 'plan-ready' }],
      },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ revision: 1 })
  })

  it('does not infer plan readiness from plan mode without a structured request', () => {
    const service = new WorkspaceActivityService({ onUpdate: () => undefined })

    service.handleManagedSessionSnapshot(
      snapshot({ interactionMode: 'plan', running: false }),
    )

    expect(service.getSnapshot().activitiesByWorkspace).toEqual({})
  })

  it('uses a single collection revision across workspaces', () => {
    const events: number[] = []
    const service = new WorkspaceActivityService({
      onUpdate: (event) => events.push(event.revision),
    })

    service.handleManagedSessionSnapshot(
      snapshot({ sessionState: 'running', workspaceId: 'workspace-1' }),
    )
    service.handleManagedSessionSnapshot(
      snapshot({
        sessionId: 'session-2',
        sessionState: 'connecting',
        workspaceId: 'workspace-2',
      }),
    )

    expect(events).toEqual([1, 2])
    expect(service.getSnapshot().revision).toBe(2)
  })

  it('acknowledges terminal activity emitted while a workspace is visible', () => {
    const persisted = vi.fn()
    const service = new WorkspaceActivityService({
      onUpdate: () => undefined,
      onWorkspaceVisited: persisted,
    })
    service.setVisibleWorkspace('workspace-1')

    service.handleManagedSessionSnapshot(
      snapshot({
        lastCompletedAt: '2026-04-06T12:01:00.000Z',
        running: false,
        sessionState: 'stopped',
        updatedAt: '2026-04-06T12:01:00.000Z',
      }),
    )

    expect(persisted).toHaveBeenLastCalledWith(
      'workspace-1',
      '2026-04-06T12:01:00.000Z',
    )
    expect(service.getSnapshot().activitiesByWorkspace).toEqual({})
  })

  it('keeps fallback activity terminal-only and coarse', () => {
    const service = new WorkspaceActivityService({ onUpdate: () => undefined })
    service.trackSession({
      cols: 80,
      cwd: '/tmp/workspace-1',
      mode: 'shell',
      paneId: 'pane-terminal',
      rows: 24,
      sessionId: 'terminal-1',
      workspaceId: 'workspace-1',
    })

    expect(
      service.getSnapshot().activitiesByWorkspace['workspace-1']?.[0],
    ).toMatchObject({
      provider: 'terminal',
      source: 'fallback',
      state: 'terminal-running',
    })
  })
})
