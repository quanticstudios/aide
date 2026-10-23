import { describe, expect, it } from 'vitest'

import type { ManagedSessionContentItem } from '../../../shared/managed-session'
import { buildTranscriptRows } from './transcript-rows'

function item(
  id: string,
  kind: ManagedSessionContentItem['kind'],
  turnId: string | null = 'turn',
): ManagedSessionContentItem {
  return { id, kind, provider: 'claude', text: id, turnId, updatedAt: '' }
}

describe('buildTranscriptRows', () => {
  it('keeps a short turn as one row', () => {
    const group = { items: [item('a', 'user-prompt')], turnId: 'turn' }

    expect(buildTranscriptRows([group])).toEqual([
      { group, isFirst: true, isLast: true, items: group.items, key: 'turn' },
    ])
  })

  it('slices a long turn and keys slices stably as it grows', () => {
    const items = Array.from({ length: 7 }, (_, index) =>
      item(`t${index}`, 'assistant-text'),
    )
    const rows = buildTranscriptRows([{ items, turnId: 'turn' }], 3)

    expect(rows.map((row) => row.items.map((entry) => entry.id))).toEqual([
      ['t0', 't1', 't2'],
      ['t3', 't4', 't5'],
      ['t6'],
    ])
    expect(rows.map((row) => row.key)).toEqual(['turn', 'turn:1', 'turn:2'])
    expect(rows.map((row) => [row.isFirst, row.isLast])).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ])
  })

  it('waits for a tool-call run to end, up to twice the slice size', () => {
    const items = [
      item('p', 'user-prompt'),
      ...Array.from({ length: 9 }, (_, index) =>
        item(`c${index}`, 'tool-call'),
      ),
    ]
    const rows = buildTranscriptRows([{ items, turnId: 'turn' }], 3)

    expect(rows.map((row) => row.items.length)).toEqual([6, 4])
  })

  it('keys a turnless group by its first item', () => {
    const rows = buildTranscriptRows([
      { items: [item('notice', 'system', null)], turnId: null },
    ])

    expect(rows[0]?.key).toBe('system-notice')
  })
})
