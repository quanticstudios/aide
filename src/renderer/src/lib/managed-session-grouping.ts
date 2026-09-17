import type { ManagedSessionContentItem } from '../../../shared/managed-session'

export interface TurnGroup {
  items: ManagedSessionContentItem[]
  turnId: string | null
}

export function groupContentByTurn(
  content: readonly ManagedSessionContentItem[],
): TurnGroup[] {
  const groups: TurnGroup[] = []
  const groupsByTurnId = new Map<string, TurnGroup>()

  for (const item of content) {
    const key = item.turnId ?? `content:${item.id}`
    const existingGroup = groupsByTurnId.get(key)

    if (existingGroup) {
      existingGroup.items.push(item)
      continue
    }

    const group = { items: [item], turnId: item.turnId }
    groupsByTurnId.set(key, group)
    groups.push(group)
  }

  return groups
}
