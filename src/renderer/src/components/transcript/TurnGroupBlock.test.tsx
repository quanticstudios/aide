// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../../shared/managed-session'
import {
  applyDelta,
  SESSION_DELTA_VERSION,
} from '../../../../shared/session-delta'
import { shareSnapshotContent } from '../../lib/managed-session-events'
import { groupContentByTurn } from '../../lib/managed-session-grouping'
import { buildTranscriptRows } from '../../lib/transcript-rows'
import TurnGroupBlock from './TurnGroupBlock'

const rowUpdates = vi.hoisted(() => [] as string[])

// why: each leaf below renders once per render of its row, so a Profiler inside it records exactly which rows re-rendered.
vi.mock('../MarkdownContent', async () => {
  const { Profiler, createElement } = await import('react')
  return {
    default: ({ text }: { text: string }) =>
      createElement(
        Profiler,
        {
          id: text.split(' ')[0] ?? '',
          onRender: (id, phase) => {
            if (phase !== 'mount') rowUpdates.push(id)
          },
        },
        text,
      ),
  }
})
vi.mock('./ToolCallBlock', async (importOriginal) => {
  const { Profiler, createElement } = await import('react')
  return {
    ...(await importOriginal<object>()),
    default: ({ tool }: { tool: { callId: string } }) =>
      createElement(Profiler, {
        id: tool.callId,
        onRender: (id, phase) => {
          if (phase !== 'mount') rowUpdates.push(id)
        },
      }),
  }
})
vi.mock('../ManagedComposerAttachments', async () => {
  const { Profiler, createElement } = await import('react')
  return {
    default: () =>
      createElement(Profiler, {
        id: 'prompt',
        onRender: (id, phase) => {
          if (phase !== 'mount') rowUpdates.push(id)
        },
      }),
  }
})

function contentItem(
  id: string,
  turnId: string,
  kind: ManagedSessionContentItem['kind'],
  text: string,
  extra: Partial<ManagedSessionContentItem> = {},
): ManagedSessionContentItem {
  return {
    id,
    kind,
    provider: 'claude',
    text,
    turnId,
    updatedAt: '2026-10-23T12:00:00.000Z',
    ...extra,
  }
}

const noop = () => undefined

function Transcript({
  content,
  workedForMs = null,
}: {
  readonly content: readonly ManagedSessionContentItem[]
  readonly workedForMs?: number | null
}) {
  return buildTranscriptRows(groupContentByTurn(content)).map((row) => (
    <TurnGroupBlock
      canBranch={false}
      checkpointId="checkpoint"
      isCompleted={false}
      isFailed={false}
      isRunning={row.group.turnId === 'turn-2'}
      key={row.key}
      onBranch={noop}
      onEditFromHere={noop}
      onInterrupt={noop}
      onOpenDiff={noop}
      onRetry={noop}
      providerLabel="Claude"
      recipientAlias={null}
      requestText={null}
      rewindDisabledReason={null}
      row={row}
      sessionId="session"
      workedForMs={row.group.turnId === 'turn-2' ? workedForMs : null}
    />
  ))
}

const STREAMED_TOKENS = 500

function initialContent(): ManagedSessionContentItem[] {
  return [
    contentItem('old-prompt', 'turn-1', 'user-prompt', 'Earlier question'),
    contentItem('old-reply', 'turn-1', 'assistant-text', 'Earlier reply'),
    contentItem('prompt', 'turn-2', 'user-prompt', 'Question'),
    contentItem('thinking', 'turn-2', 'assistant-text', 'Thinking aloud', {
      phase: 'commentary',
    }),
    contentItem('tool', 'turn-2', 'tool-call', '', {
      tool: {
        callId: 'call-1',
        input: {},
        status: 'completed',
        toolName: 'Read',
      },
    }),
    contentItem('answer', 'turn-2', 'assistant-text', 'Answer'),
  ]
}

// why: IPC snapshots carry fresh copies of every item, and the hub shares the unchanged ones back.
function streamSnapshot(
  snapshot: ManagedSessionSnapshot,
  token: number,
): ManagedSessionSnapshot {
  const content = structuredClone(snapshot.content).map((item) =>
    item.id === 'answer' ? { ...item, text: `${item.text} t${token}` } : item,
  )
  return shareSnapshotContent(snapshot, { ...snapshot, content })
}

function streamDelta(
  snapshot: ManagedSessionSnapshot,
  token: number,
): ManagedSessionSnapshot {
  return applyDelta(
    { seq: token, snapshot },
    {
      itemId: 'answer',
      itemUpdatedAt: snapshot.updatedAt,
      revision: token + 1,
      seq: token + 1,
      sessionId: 'session',
      text: ` t${token}`,
      type: 'item.text.append',
      updatedAt: snapshot.updatedAt,
      version: SESSION_DELTA_VERSION,
    },
  ).snapshot
}

describe('TurnGroupBlock', () => {
  afterEach(() => {
    rowUpdates.length = 0
  })

  it.each([
    ['snapshots', streamSnapshot],
    ['deltas', streamDelta],
  ])('re-renders only the streaming row while %s stream 500 tokens', (_, stream) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const root = createRoot(document.createElement('div'))
    let snapshot = {
      content: initialContent(),
      revision: 0,
      sessionId: 'session',
      updatedAt: '2026-10-23T12:00:00.000Z',
    } as ManagedSessionSnapshot
    act(() => root.render(<Transcript content={snapshot.content} />))

    for (let token = 0; token < STREAMED_TOKENS; token += 1) {
      snapshot = stream(snapshot, token)
      act(() => root.render(<Transcript content={snapshot.content} />))
    }

    expect(new Set(rowUpdates)).toEqual(new Set(['Answer']))
    expect(rowUpdates).toHaveLength(STREAMED_TOKENS)
    act(() => root.unmount())
  })
})

describe('TurnGroupBlock reasoning', () => {
  afterEach(() => {
    rowUpdates.length = 0
    vi.useRealTimers()
  })

  it('shows a live thinking row, ticks without re-rendering other rows, then collapses with its duration', () => {
    vi.useFakeTimers({ now: Date.parse('2026-10-23T12:00:01.000Z') })
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const container = document.createElement('div')
    const root = createRoot(container)
    const reasoning = contentItem(
      'reasoning',
      'turn-2',
      'reasoning-text',
      'First idea.\n\nLatest idea.',
      { createdAt: '2026-10-23T12:00:00.000Z' },
    )
    const content = [
      contentItem('old-prompt', 'turn-1', 'user-prompt', 'Earlier question'),
      contentItem('old-reply', 'turn-1', 'assistant-text', 'Earlier reply'),
      contentItem('prompt', 'turn-2', 'user-prompt', 'Question'),
      reasoning,
    ]
    act(() => root.render(<Transcript content={content} />))
    const row = () =>
      container.querySelector('[data-testid="managed-content-reasoning-text"]')

    expect(row()?.getAttribute('data-state')).toBe('live')
    expect(row()?.textContent).toContain('Thinking1s')
    act(() => vi.advanceTimersByTime(2_000))
    expect(row()?.textContent).toContain('Thinking3s')
    expect(rowUpdates).toEqual([])

    const done = [
      ...content.slice(0, -1),
      { ...reasoning, updatedAt: '2026-10-23T12:00:12.000Z' },
      contentItem('answer', 'turn-2', 'assistant-text', 'Answer'),
    ]
    act(() => root.render(<Transcript content={done} />))
    expect(row()?.getAttribute('data-state')).toBe('done')
    expect(row()?.textContent).toContain('Thought for 12s')
    expect(
      row()?.querySelector('[data-testid="thinking-preview"]')?.textContent,
    ).toBe('Latest idea.')

    act(() => row()?.querySelector('button')?.click())
    expect(row()?.querySelector('pre')?.textContent).toBe(
      'First idea.\n\nLatest idea.',
    )
    act(() => root.unmount())
  })
})

describe('TurnGroupBlock work summary', () => {
  it('summarizes a tool run in plain words and says how long a finished turn worked', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const container = document.createElement('div')
    const root = createRoot(container)
    act(() =>
      root.render(
        <Transcript content={initialContent()} workedForMs={134_000} />,
      ),
    )
    const workedFor = container.querySelector('[data-testid="turn-worked-for"]')

    expect(
      container.querySelector('[data-testid="managed-tool-call-group"] summary')
        ?.textContent,
    ).toContain('Read 1 file')
    expect(workedFor?.textContent).toBe('Worked for 2m 14s')
    expect(workedFor?.nextElementSibling?.textContent).toContain('Answer')

    act(() => root.render(<Transcript content={initialContent()} />))
    expect(
      container.querySelector('[data-testid="turn-worked-for"]'),
    ).toBeNull()
    act(() => root.unmount())
  })
})
