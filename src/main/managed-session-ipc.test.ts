import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManagedSessionIpcEvent } from '../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionEvent,
  ManagedSessionSnapshot,
} from '../shared/managed-session'
import { applyDelta, type SessionDeltaState } from '../shared/session-delta'
import {
  diffSnapshots,
  MANAGED_SESSION_IPC_FRAME_MS,
  ManagedSessionIpcBroadcaster,
} from './managed-session-ipc'
import { ManagedSessionManager } from './managed-session-manager'

function item(
  id: string,
  text: string,
  extra: Partial<ManagedSessionContentItem> = {},
): ManagedSessionContentItem {
  return {
    id,
    kind: 'assistant-text',
    provider: 'codex',
    text,
    turnId: 'turn-1',
    updatedAt: '2026-10-23T10:00:00.000Z',
    ...extra,
  }
}

function snapshot(
  revision: number,
  extra: Partial<ManagedSessionSnapshot> = {},
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
    permissionMode: 'default',
    planApproval: null,
    provider: 'codex',
    revision,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: null,
    serviceTier: null,
    sessionId: 'session-1',
    sessionState: 'running',
    turns: [],
    updatedAt: `2026-10-23T10:00:0${revision}.000Z`,
    workspaceId: 'workspace-1',
    ...extra,
  }
}

function replay(
  state: SessionDeltaState | null,
  deltas: ReturnType<typeof diffSnapshots>,
): SessionDeltaState | null {
  return deltas.reduce<SessionDeltaState | null>(applyDelta, state)
}

describe('diffSnapshots', () => {
  const base = snapshot(1, {
    content: [item('a', 'Hello'), item('b', '', { kind: 'tool-call' })],
    pendingApprovals: [
      {
        detail: 'run it',
        id: 'approval-1',
        requestType: 'command-execution-approval',
      },
    ],
    turns: [
      {
        id: 'turn-1',
        provider: 'codex',
        startedAt: 'now',
        state: 'running',
      } as never,
    ],
  })
  const state: SessionDeltaState = { seq: 4, snapshot: base }

  it.each([
    [
      'a text append',
      snapshot(2, {
        ...base,
        content: [
          item('a', 'Hello world', { updatedAt: 'later' }),
          base.content[1],
        ],
        revision: 2,
      }),
      ['item.text.append'],
    ],
    [
      'a new item, a resolved approval and a finished turn',
      snapshot(3, {
        ...base,
        content: [...base.content, item('c', 'Done')],
        pendingApprovals: [],
        revision: 3,
        running: false,
        sessionState: 'ready',
        turns: [{ ...base.turns[0], state: 'completed' }],
      }),
      ['item.add', 'approval.resolve', 'turn', 'status'],
    ],
    [
      'a changed and an unset session field',
      snapshot(4, {
        ...base,
        model: 'gpt',
        revision: 4,
        selectionNotice: null,
      }),
      ['session.patch'],
    ],
    [
      'a reordered transcript',
      snapshot(5, { ...base, content: [base.content[1], base.content[0]] }),
      ['snapshot'],
    ],
    [
      'only a new revision',
      snapshot(6, { ...base, revision: 6 }),
      ['session.patch'],
    ],
  ])('rebuilds %s exactly', (_label, next, types) => {
    const deltas = diffSnapshots(state, next)

    expect(deltas.map((delta) => delta.type)).toEqual(types)
    expect(deltas.map((delta) => delta.seq)).toEqual(
      types.map((_type, index) => state.seq + 1 + index),
    )
    expect(replay(state, deltas)?.snapshot).toEqual(next)
  })

  it('sends nothing when the snapshot did not change', () => {
    expect(diffSnapshots(state, { ...base })).toEqual([])
  })

  it('starts a session with a snapshot delta', () => {
    expect(diffSnapshots(null, base)).toMatchObject([
      { seq: 1, snapshot: base, type: 'snapshot' },
    ])
  })
})

describe('ManagedSessionIpcBroadcaster', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('coalesces a frame of updates into one message per session', () => {
    const sent: ManagedSessionIpcEvent[] = []
    const broadcaster = new ManagedSessionIpcBroadcaster({
      send: (event) => sent.push(event),
    })
    broadcaster.update(snapshot(1, { content: [item('a', '')] }))
    vi.advanceTimersByTime(MANAGED_SESSION_IPC_FRAME_MS)

    for (let index = 1; index <= 5; index += 1) {
      broadcaster.update(
        snapshot(1 + index, { content: [item('a', 'x'.repeat(index))] }),
      )
      broadcaster.update(
        snapshot(index, {
          content: [item('z', 'other')],
          sessionId: 'session-2',
        }),
      )
    }
    expect(sent).toHaveLength(1)
    vi.advanceTimersByTime(MANAGED_SESSION_IPC_FRAME_MS)

    expect(sent.map((event) => event.sessionId)).toEqual([
      'session-1',
      'session-1',
      'session-2',
    ])
    expect(sent[1]).toMatchObject({
      deltas: [{ seq: 2, text: 'xxxxx', type: 'item.text.append' }],
    })
  })

  it('flushes pending changes before answering a sync', () => {
    const sent: ManagedSessionIpcEvent[] = []
    const broadcaster = new ManagedSessionIpcBroadcaster({
      send: (event) => sent.push(event),
    })
    broadcaster.update(snapshot(1))
    broadcaster.update(snapshot(2, { content: [item('a', 'hi')] }))

    expect(broadcaster.sync('session-1')).toMatchObject({
      seq: 1,
      snapshot: { revision: 2 },
    })
    expect(sent).toHaveLength(1)
    expect(broadcaster.sync('missing')).toBeNull()
  })

  it('keeps its own copy of turns the manager updates in place', () => {
    const sent: ManagedSessionIpcEvent[] = []
    const broadcaster = new ManagedSessionIpcBroadcaster({
      send: (event) => sent.push(event),
    })
    const turn = {
      id: 'turn-1',
      state: 'running',
    } as never as ManagedSessionSnapshot['turns'][number]
    broadcaster.update(snapshot(1, { turns: [turn] }))
    broadcaster.flush()
    ;(turn as { state: string }).state = 'completed'
    broadcaster.update(snapshot(2, { turns: [turn] }))
    broadcaster.flush()

    expect(sent[1]).toMatchObject({
      deltas: [{ turn: { state: 'completed' }, type: 'turn' }],
    })
  })
})

describe('managed-session IPC bytes', () => {
  beforeEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = '1'
  })
  afterEach(() => {
    process.env.AIDE_FAKE_MANAGED_PROVIDERS = undefined
  })

  it('sends at least 10x fewer bytes than whole snapshots for five streaming agents', async () => {
    let measuring = false
    let snapshotBytes = 0
    let deltaBytes = 0
    const received = new Map<string, SessionDeltaState | null>()
    const broadcaster = new ManagedSessionIpcBroadcaster({
      send: (event) => {
        if (measuring) deltaBytes += JSON.stringify(event).length
        if (event.type === 'deltas') {
          received.set(
            event.sessionId,
            replay(received.get(event.sessionId) ?? null, event.deltas),
          )
        }
      },
    })
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: (event: ManagedSessionEvent) => {
        if (measuring) snapshotBytes += JSON.stringify(event).length
        if (event.type === 'snapshot') broadcaster.update(event.snapshot)
      },
    })
    const sessionIds = Array.from(
      { length: 5 },
      (_, index) => `session-${index}`,
    )
    for (const sessionId of sessionIds) {
      await manager.createSession({
        cwd: '/tmp/workspace-1',
        mode: 'codex',
        paneId: `pane-${sessionId}`,
        sessionId,
        workspaceId: 'workspace-1',
      })
      for (let turn = 0; turn < 10; turn += 1) {
        await manager.sendInput(
          sessionId,
          `earlier turn ${turn} ${'context '.repeat(100)}`,
        )
      }
    }
    broadcaster.flush()

    measuring = true
    await Promise.all(
      sessionIds.map((sessionId) =>
        manager.sendInput(sessionId, 'stream-codex'),
      ),
    )
    await vi.waitFor(
      () =>
        expect(
          sessionIds.every(
            (sessionId) =>
              manager.getSnapshots()[sessionId]?.sessionState === 'ready',
          ),
        ).toBe(true),
      { timeout: 10_000 },
    )
    broadcaster.flush()
    measuring = false

    console.info(
      `managed-session IPC bytes, five streaming agents: whole snapshots ${snapshotBytes}, deltas ${deltaBytes} (${(snapshotBytes / deltaBytes).toFixed(1)}x)`,
    )
    expect(snapshotBytes / deltaBytes).toBeGreaterThanOrEqual(10)
    for (const sessionId of sessionIds) {
      expect(received.get(sessionId)?.snapshot).toEqual(
        manager.getSnapshots()[sessionId],
      )
    }
    await manager.closeAll()
  }, 20_000)
})
