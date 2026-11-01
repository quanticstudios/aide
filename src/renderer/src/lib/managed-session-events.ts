import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import { isEqualValue } from './deep-equal'

export type ManagedSessionUpdate =
  | { readonly snapshot: ManagedSessionSnapshot; readonly type: 'snapshot' }
  | { readonly type: 'removed' }

/** Returns `next` with every content item that equals one in `previous` replaced by the previous object. */
export function shareSnapshotContent(
  previous: ManagedSessionSnapshot | undefined,
  next: ManagedSessionSnapshot,
): ManagedSessionSnapshot {
  if (!previous) return next
  const previousItems = new Map<string, ManagedSessionContentItem>()
  for (const item of previous.content) previousItems.set(item.id, item)

  let reusedAll = previous.content.length === next.content.length
  const content = next.content.map((item, index) => {
    const previousItem = previousItems.get(item.id)
    const shared =
      previousItem && isEqualValue(previousItem, item) ? previousItem : item
    if (shared !== previous.content[index]) reusedAll = false
    return shared
  })

  return { ...next, content: reusedAll ? previous.content : content }
}
