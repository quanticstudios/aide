import type {
  PersistedLayoutNode,
  PersistenceSnapshot,
  WorkspaceLayoutRecord,
} from '../../../shared/persistence'

export function collectWorkspaceLayoutPaneIds(
  layout: WorkspaceLayoutRecord | null,
): string[] {
  if (!layout) {
    return []
  }

  return layout.nodes.flatMap((node) =>
    node.type === 'pane' ? [node.paneId] : [],
  )
}

export function createFallbackWorkspaceLayout(
  _workspaceId: string,
): WorkspaceLayoutRecord | null {
  return null
}

function normalizeWeights(weights: number[], childCount: number): number[] {
  if (childCount === 0) {
    return []
  }

  if (weights.length !== childCount || weights.some((weight) => weight <= 0)) {
    return Array.from({ length: childCount }, () => 1)
  }

  return weights
}

function normalizeWorkspaceLayout(
  layout: WorkspaceLayoutRecord,
): WorkspaceLayoutRecord | null {
  const nodeLookup = new Map<string, PersistedLayoutNode>()

  for (const node of layout.nodes) {
    if (!node.id || nodeLookup.has(node.id)) {
      continue
    }

    nodeLookup.set(node.id, node)
  }

  const normalizedNodes = new Map<string, PersistedLayoutNode>()
  const visiting = new Set<string>()

  function normalizeSubtree(
    nodeId: string,
    parentId: string | null,
  ): string | null {
    const node = nodeLookup.get(nodeId)

    if (!node || visiting.has(nodeId)) {
      return null
    }

    visiting.add(nodeId)

    if (node.type === 'pane') {
      const viewIds =
        Array.isArray(node.viewIds) && node.viewIds.length > 0
          ? node.viewIds
          : [node.paneId]
      const activeViewIndex =
        typeof node.activeViewIndex === 'number'
          ? Math.min(Math.max(node.activeViewIndex, 0), viewIds.length - 1)
          : 0

      normalizedNodes.set(node.id, {
        ...node,
        activeViewIndex,
        children: [],
        parentId,
        sizeWeights: [],
        viewIds,
        workspaceId: layout.workspaceId,
      })
      visiting.delete(nodeId)
      return node.id
    }

    const childIds: string[] = []
    const seenChildIds = new Set<string>()

    for (const childId of node.children) {
      const normalizedChildId = normalizeSubtree(childId, node.id)

      if (!normalizedChildId || seenChildIds.has(normalizedChildId)) {
        continue
      }

      seenChildIds.add(normalizedChildId)
      childIds.push(normalizedChildId)
    }

    visiting.delete(nodeId)

    if (childIds.length === 0) {
      return null
    }

    if (childIds.length === 1) {
      const onlyChild = normalizedNodes.get(childIds[0])

      if (onlyChild) {
        normalizedNodes.set(childIds[0], {
          ...onlyChild,
          parentId,
        })
      }

      return childIds[0]
    }

    normalizedNodes.set(node.id, {
      children: childIds,
      id: node.id,
      paneId: null,
      parentId,
      sizeWeights: normalizeWeights(node.sizeWeights, childIds.length),
      type: node.type,
      workspaceId: layout.workspaceId,
    })

    return node.id
  }

  const normalizedRootId = normalizeSubtree(layout.rootNodeId, null)

  if (!normalizedRootId) {
    return null
  }

  const normalizedRoot = normalizedNodes.get(normalizedRootId)

  if (!normalizedRoot) {
    return null
  }

  normalizedNodes.set(normalizedRootId, {
    ...normalizedRoot,
    parentId: null,
  })

  const nodes = Array.from(
    new Set(layout.nodes.map((node) => node.id)),
  ).flatMap((nodeId) => {
    const node = normalizedNodes.get(nodeId)

    return node ? [node] : []
  })

  if (
    nodes.length === 0 ||
    collectWorkspaceLayoutPaneIds({ ...layout, nodes }).length === 0
  ) {
    return null
  }

  return {
    nodes,
    rootNodeId: normalizedRootId,
    workspaceId: layout.workspaceId,
  }
}

export function resolveWorkspaceLayout(
  snapshot: PersistenceSnapshot,
  workspaceId: string | null,
): WorkspaceLayoutRecord | null {
  if (!workspaceId) {
    return null
  }

  const persistedLayout = snapshot.workspaceLayouts[workspaceId]

  if (!persistedLayout) {
    return createFallbackWorkspaceLayout(workspaceId)
  }

  return (
    normalizeWorkspaceLayout(persistedLayout) ??
    createFallbackWorkspaceLayout(workspaceId)
  )
}

export function resolveWorkspaceLayoutRoot(
  layout: WorkspaceLayoutRecord | null,
): PersistedLayoutNode | null {
  if (!layout) {
    return null
  }

  return layout.nodes.find((node) => node.id === layout.rootNodeId) ?? null
}
