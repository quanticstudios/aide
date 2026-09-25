import { describe, expect, it, vi } from 'vitest'

import type {
  ManagedSessionContentItem,
  ManagedSessionEvent,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import {
  type ManagedSessionUpdate,
  shareSnapshotContent,
  subscribeManagedSession,
} from './managed-session-events'

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
    updatedAt: '2026-09-25T10:00:00.000Z',
    ...extra,
  }
}

function snapshot(
  sessionId: string,
  revision: number,
  content: ManagedSessionContentItem[],
): ManagedSessionSnapshot {
  return {
    content,
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
    sessionId,
    sessionState: 'running',
    turns: [],
    updatedAt: '2026-09-25T10:00:00.000Z',
    workspaceId: 'workspace-1',
  } as ManagedSessionSnapshot
}

function createSource() {
  let emit: ((event: ManagedSessionEvent) => void) | null = null
  const unsubscribe = vi.fn(() => {
    emit = null
  })
  const source = {
    onManagedSessionEvent: vi.fn(
      (callback: (event: ManagedSessionEvent) => void) => {
        emit = callback
        return unsubscribe
      },
    ),
  }
  return {
    emit: (event: ManagedSessionEvent) => emit?.(event),
    source,
    unsubscribe,
  }
}

describe('shareSnapshotContent', () => {
  it('keeps unchanged items and swaps in only the changed one', () => {
    const previous = snapshot('s', 1, [
      item('a', 'done', { tool: undefined }),
      item('b', 'stream'),
    ])
    const next = snapshot('s', 2, [
      item('a', 'done', { tool: undefined }),
      item('b', 'streaming'),
    ])

    const shared = shareSnapshotContent(previous, next)

    expect(shared.content[0]).toBe(previous.content[0])
    expect(shared.content[1]).toBe(next.content[1])
    expect(shared.revision).toBe(2)
  })

  it('reuses the whole content array when every item is unchanged', () => {
    const previous = snapshot('s', 1, [item('a', 'x'), item('b', 'y')])
    const next = snapshot('s', 2, [item('a', 'x'), item('b', 'y')])

    expect(shareSnapshotContent(previous, next).content).toBe(previous.content)
  })

  it('treats nested tool changes as a changed item', () => {
    const tool = { id: 't', name: 'bash', status: 'running' }
    const previous = snapshot('s', 1, [
      item('a', '', { kind: 'tool-call', tool: { ...tool } as never }),
    ])
    const next = snapshot('s', 2, [
      item('a', '', {
        kind: 'tool-call',
        tool: { ...tool, status: 'completed' } as never,
      }),
    ])

    expect(shareSnapshotContent(previous, next).content[0]).toBe(
      next.content[0],
    )
  })
})

describe('subscribeManagedSession', () => {
  it('opens one IPC subscription and routes events to their session only', () => {
    const { emit, source, unsubscribe } = createSource()
    const first: ManagedSessionUpdate[] = []
    const second: ManagedSessionUpdate[] = []

    const stopFirst = subscribeManagedSession(source, 'one', (update) =>
      first.push(update),
    )
    const stopSecond = subscribeManagedSession(source, 'two', (update) =>
      second.push(update),
    )
    emit({
      revision: 1,
      snapshot: snapshot('one', 1, [item('a', 'x')]),
      type: 'snapshot',
    })
    emit({ revision: 2, sessionId: 'two', type: 'removed' })

    expect(source.onManagedSessionEvent).toHaveBeenCalledTimes(1)
    expect(first.map((update) => update.type)).toEqual(['snapshot'])
    expect(second).toEqual([{ type: 'removed' }])

    stopFirst()
    expect(unsubscribe).not.toHaveBeenCalled()
    stopSecond()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('hands listeners snapshots that share unchanged items with the last one', () => {
    const { emit, source } = createSource()
    const received: ManagedSessionSnapshot[] = []
    const stop = subscribeManagedSession(source, 'one', (update) => {
      if (update.type === 'snapshot') received.push(update.snapshot)
    })

    emit({
      revision: 1,
      snapshot: snapshot('one', 1, [item('a', 'x'), item('b', 'y')]),
      type: 'snapshot',
    })
    emit({
      revision: 2,
      snapshot: snapshot('one', 2, [item('a', 'x'), item('b', 'yz')]),
      type: 'snapshot',
    })

    expect(received[1]?.content[0]).toBe(received[0]?.content[0])
    expect(received[1]?.content[1]).not.toBe(received[0]?.content[1])
    stop()
  })
})
