import { describe, expect, it } from 'vitest'

import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import { shareSnapshotContent } from './managed-session-events'

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
