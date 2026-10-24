import type { ManagedSessionContentItem } from '../../../shared/managed-session'
import type { TurnGroup } from './managed-session-grouping'

/** One virtual-list row: a whole turn, or a slice of a long one. */
export interface TranscriptRow {
  readonly group: TurnGroup
  readonly isFirst: boolean
  readonly isLast: boolean
  readonly items: readonly ManagedSessionContentItem[]
  readonly key: string
}

/** Splits turn groups into rows of about `maxItems` items so one long turn cannot fill the DOM. */
export function buildTranscriptRows(
  groups: readonly TurnGroup[],
  maxItems = 20,
): TranscriptRow[] {
  const rows: TranscriptRow[] = []

  for (const group of groups) {
    const groupKey = group.turnId ?? `system-${group.items[0]?.id}`
    const slices: ManagedSessionContentItem[][] = [[]]

    for (const item of group.items) {
      const slice = slices.at(-1) ?? []
      const insideToolRun =
        item.kind === 'tool-call' && slice.at(-1)?.kind === 'tool-call'
      // why: a cut inside a tool-call run splits one "N tool calls" group in two, so wait for the run to end unless it doubles the slice.
      if (
        slice.length >= maxItems &&
        (!insideToolRun || slice.length >= maxItems * 2)
      ) {
        slices.push([item])
      } else {
        slice.push(item)
      }
    }

    slices.forEach((items, index) => {
      rows.push({
        group,
        isFirst: index === 0,
        isLast: index === slices.length - 1,
        items,
        key: index === 0 ? groupKey : `${groupKey}:${index}`,
      })
    })
  }

  return rows
}
