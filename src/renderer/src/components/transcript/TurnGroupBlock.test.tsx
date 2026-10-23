// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../../shared/managed-session'
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

describe('TurnGroupBlock', () => {
  afterEach(() => {
    rowUpdates.length = 0
  })

  it('re-renders only the streaming row while 500 tokens arrive', () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
    const content = [
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
    const container = document.createElement('div')
    const root = createRoot(container)
    let snapshot = { content } as ManagedSessionSnapshot
    act(() => root.render(<Transcript content={snapshot.content} />))

    for (let token = 0; token < 500; token += 1) {
      // why: every IPC snapshot carries fresh copies of every item, as the context bridge delivers them.
      const next = structuredClone(snapshot.content).map((item) =>
        item.id === 'answer'
          ? { ...item, text: `${item.text} t${token}` }
          : item,
      )
      snapshot = shareSnapshotContent(snapshot, {
        ...snapshot,
        content: next,
      })
      act(() => root.render(<Transcript content={snapshot.content} />))
    }

    console.log(
      'row updates',
      rowUpdates.length,
      [...new Set(rowUpdates)].join(','),
    )
    expect(new Set(rowUpdates)).toEqual(new Set(['Answer']))
    expect(rowUpdates).toHaveLength(500)
    act(() => root.unmount())
  })
})
