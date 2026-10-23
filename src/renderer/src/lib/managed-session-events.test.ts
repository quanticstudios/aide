import { describe, expect, it, vi } from 'vitest'

import { diffSnapshots } from '../../../main/managed-session-ipc'
import type { ManagedSessionIpcEvent } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import type { SessionDeltaState } from '../../../shared/session-delta'
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

function createSource(
  sync: (sessionId: string) => SessionDeltaState | null = () => null,
) {
  let emit: ((event: ManagedSessionIpcEvent) => void) | null = null
  const unsubscribe = vi.fn(() => {
    emit = null
  })
  const source = {
    onManagedSessionEvent: vi.fn(
      (callback: (event: ManagedSessionIpcEvent) => void) => {
        emit = callback
        return unsubscribe
      },
    ),
    syncManagedSession: vi.fn(async (sessionId: string) => sync(sessionId)),
  }
  return {
    emit: (event: ManagedSessionIpcEvent) => emit?.(event),
    source,
    unsubscribe,
  }
}

/** Main's side of one session: diffs each snapshot against the last and keeps the seq. */
function createMain(initial: ManagedSessionSnapshot) {
  let state: SessionDeltaState = { seq: 1, snapshot: initial }
  return {
    next(next: ManagedSessionSnapshot): ManagedSessionIpcEvent {
      const deltas = diffSnapshots(state, next)
      state = { seq: deltas.at(-1)?.seq ?? state.seq, snapshot: next }
      return { deltas, sessionId: next.sessionId, type: 'deltas' }
    },
    get state() {
      return state
    },
  }
}

function text(update: ManagedSessionUpdate | undefined): string | undefined {
  return update?.type === 'snapshot'
    ? update.snapshot.content.map((entry) => entry.text).join('|')
    : undefined
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
  it('opens one IPC subscription and routes events to their session only', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'x')]))
    const { emit, source, unsubscribe } = createSource((sessionId) =>
      sessionId === 'one' ? main.state : null,
    )
    const first: ManagedSessionUpdate[] = []
    const second: ManagedSessionUpdate[] = []

    const stopFirst = subscribeManagedSession(source, 'one', (update) =>
      first.push(update),
    )
    const stopSecond = subscribeManagedSession(source, 'two', (update) =>
      second.push(update),
    )
    await vi.waitFor(() => expect(first).toHaveLength(1))
    emit(main.next(snapshot('one', 2, [item('a', 'xy')])))
    emit({ revision: 2, sessionId: 'two', type: 'removed' })

    expect(source.onManagedSessionEvent).toHaveBeenCalledTimes(1)
    expect(first.map(text)).toEqual(['x', 'xy'])
    expect(second).toEqual([{ type: 'removed' }])

    stopFirst()
    expect(unsubscribe).not.toHaveBeenCalled()
    stopSecond()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('fetches a snapshot on attach, then applies each later delta once', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'Hel')]))
    const { emit, source } = createSource(() => main.state)
    const received: ManagedSessionUpdate[] = []
    const stop = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )
    const delta = main.next(snapshot('one', 2, [item('a', 'Hello')]))

    emit(delta)
    await vi.waitFor(() => expect(received).toHaveLength(1))
    emit(delta)
    emit(delta)
    emit(main.next(snapshot('one', 3, [item('a', 'Hello'), item('b', '!')])))

    expect(source.syncManagedSession).toHaveBeenCalledTimes(1)
    expect(received.map(text)).toEqual(['Hello', 'Hello|!'])
    stop()
  })

  it('resyncs on a seq gap instead of applying a delta to the wrong base', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'one')]))
    const { emit, source } = createSource(() => main.state)
    const received: ManagedSessionUpdate[] = []
    const stop = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )
    await vi.waitFor(() => expect(received).toHaveLength(1))

    main.next(snapshot('one', 2, [item('a', 'one two')]))
    emit(main.next(snapshot('one', 3, [item('a', 'one two three')])))
    expect(received.map(text)).toEqual(['one'])
    await vi.waitFor(() => expect(received).toHaveLength(2))
    emit(main.next(snapshot('one', 4, [item('a', 'one two three four')])))

    expect(source.syncManagedSession).toHaveBeenCalledTimes(2)
    expect(received.map(text)).toEqual([
      'one',
      'one two three',
      'one two three four',
    ])
    stop()
  })

  it('applies deltas that arrive while a snapshot request is in flight', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'Hel')]))
    let answer: (state: SessionDeltaState | null) => void = () => undefined
    const { emit, source } = createSource(
      () => new Promise((resolve) => (answer = resolve)) as never,
    )
    const received: ManagedSessionUpdate[] = []
    const stop = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )
    const synced = main.state

    emit(main.next(snapshot('one', 2, [item('a', 'Hello')])))
    answer(synced)
    await vi.waitFor(() => expect(received).toHaveLength(1))

    expect(received.map(text)).toEqual(['Hello'])
    expect(source.syncManagedSession).toHaveBeenCalledTimes(1)
    stop()
  })

  it('drops a snapshot reply for a session removed while it was in flight', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'x')]))
    let answer: (state: SessionDeltaState | null) => void = () => undefined
    const { emit, source } = createSource(
      () => new Promise((resolve) => (answer = resolve)) as never,
    )
    const received: ManagedSessionUpdate[] = []
    const stop = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )

    emit({ revision: 2, sessionId: 'one', type: 'removed' })
    answer(main.state)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(received).toEqual([{ type: 'removed' }])
    stop()
  })

  it('ignores a repeated unsubscribe instead of dropping a newer listener', () => {
    const { emit, source } = createSource()
    const received: ManagedSessionUpdate[] = []
    const stopStale = subscribeManagedSession(source, 'one', () => undefined)
    stopStale()
    const stop = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )
    const keepHubOpen = subscribeManagedSession(source, 'two', () => undefined)

    stopStale()
    emit({ revision: 1, sessionId: 'one', type: 'removed' })

    expect(received).toEqual([{ type: 'removed' }])
    stop()
    keepHubOpen()
  })

  it('forgets a session once its last listener leaves and fetches it again on return', async () => {
    const main = createMain(snapshot('one', 1, [item('a', 'x')]))
    const { source } = createSource(() => main.state)
    const keepHubOpen = subscribeManagedSession(source, 'two', () => undefined)
    const first = subscribeManagedSession(source, 'one', () => undefined)
    first()

    const received: ManagedSessionUpdate[] = []
    const second = subscribeManagedSession(source, 'one', (update) =>
      received.push(update),
    )
    await vi.waitFor(() => expect(received).toHaveLength(1))

    expect(source.syncManagedSession).toHaveBeenCalledWith('one')
    expect(
      source.syncManagedSession.mock.calls.filter(([id]) => id === 'one'),
    ).toHaveLength(2)
    second()
    keepHubOpen()
  })

  it('hands listeners snapshots that share unchanged items with the last one', async () => {
    const main = createMain(
      snapshot('one', 1, [item('a', 'x'), item('b', 'y')]),
    )
    const { emit, source } = createSource(() => main.state)
    const received: ManagedSessionSnapshot[] = []
    const stop = subscribeManagedSession(source, 'one', (update) => {
      if (update.type === 'snapshot') received.push(update.snapshot)
    })
    await vi.waitFor(() => expect(received).toHaveLength(1))

    emit(main.next(snapshot('one', 2, [item('a', 'x'), item('b', 'yz')])))

    expect(received[1]?.content[0]).toBe(received[0]?.content[0])
    expect(received[1]?.content[1]).not.toBe(received[0]?.content[1])
    stop()
  })
})
