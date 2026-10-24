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
}: {
  readonly content: readonly ManagedSessionContentItem[]
}) {
  return groupContentByTurn(content).map((group) => (
    <TurnGroupBlock
      canBranch={false}
      checkpointId="checkpoint"
      group={group}
      isFailed={false}
      isRunning={group.turnId === 'turn-2'}
      key={group.turnId}
      onBranch={noop}
      onEditFromHere={noop}
      onInterrupt={noop}
      onRetry={noop}
      providerLabel="Claude"
      recipientAlias={null}
      requestText={null}
      rewindDisabledReason={null}
      sessionId="session"
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
