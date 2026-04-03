import type {
  PersistedLayoutNode,
  PersistedSplitLayoutNode,
  WorkspaceLayoutRecord,
} from '../../../shared/persistence'
import { getWorkspacePaneTemplateId } from './navigation-poc'

const MIN_WEIGHT = 0.2

export interface WorkspaceLayoutMutationResult {
  blockedReason: 'last-pane' | null
  didChange: boolean
  layout: WorkspaceLayoutRecord
  nextActivePaneId: string | null
}

function cloneLayoutNode(node: PersistedLayoutNode): PersistedLayoutNode {
  return {
    ...node,
    children: [...node.children],
    sizeWeights: [...node.sizeWeights],
  } as PersistedLayoutNode
}

function cloneLayout(layout: WorkspaceLayoutRecord): WorkspaceLayoutRecord {
  return {
    ...layout,
    nodes: layout.nodes.map((node) => cloneLayoutNode(node)),
  }
}

function createNodeMap(layout: WorkspaceLayoutRecord) {
  return new Map(layout.nodes.map((node) => [node.id, node]))
}

function serializeNodes(
  layout: WorkspaceLayoutRecord,
  nodeMap: Map<string, PersistedLayoutNode>,
  appendedNodes: PersistedLayoutNode[] = [],
): PersistedLayoutNode[] {
  const nodes = layout.nodes
    .filter((node) => nodeMap.has(node.id))
    .map((node) => nodeMap.get(node.id) ?? node)

  return [...nodes, ...appendedNodes]
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

function createNodeId(
  layout: WorkspaceLayoutRecord,
  kind: 'pane-node' | 'split-node',
): string {
  const existingNodeIds = new Set(layout.nodes.map((node) => node.id))
  let counter = 1

  while (true) {
    const candidate = `${layout.workspaceId}:${kind}:${counter}`

    if (!existingNodeIds.has(candidate)) {
      return candidate
    }

    counter += 1
  }
}

function createSplitPaneId(
  layout: WorkspaceLayoutRecord,
  paneId: string,
): string {
  const existingPaneIds = new Set(
    layout.nodes.flatMap((node) => (node.type === 'pane' ? [node.paneId] : [])),
  )
  const templateId = getWorkspacePaneTemplateId(paneId)
  let counter = 1

  while (true) {
    const candidate = `${templateId}::copy-${counter}`

    if (!existingPaneIds.has(candidate)) {
      return candidate
    }

    counter += 1
  }
}

function createPaneIdForTemplate(
  layout: WorkspaceLayoutRecord,
  templatePaneId: string,
): string {
  const existingPaneIds = new Set(
    layout.nodes.flatMap((node) => (node.type === 'pane' ? [node.paneId] : [])),
  )

  if (!existingPaneIds.has(templatePaneId)) {
    return templatePaneId
  }

  return createSplitPaneId(layout, templatePaneId)
}

function createSinglePaneLayout(
  workspaceId: string,
  paneId: string,
): WorkspaceLayoutRecord {
  return {
    nodes: [
      {
        children: [],
        id: `${workspaceId}:pane-node:1`,
        paneId,
        parentId: null,
        sizeWeights: [],
        type: 'pane',
        workspaceId,
      },
    ],
    rootNodeId: `${workspaceId}:pane-node:1`,
    workspaceId,
  }
}

function findPaneNode(
  nodeMap: Map<string, PersistedLayoutNode>,
  paneId: string,
): PersistedLayoutNode | null {
  for (const node of nodeMap.values()) {
    if (node.type === 'pane' && node.paneId === paneId) {
      return node
    }
  }

  return null
}

function firstDescendantPaneId(
  nodeMap: Map<string, PersistedLayoutNode>,
  nodeId: string,
): string | null {
  const node = nodeMap.get(nodeId)

  if (!node) {
    return null
  }

  if (node.type === 'pane') {
    return node.paneId
  }

  for (const childId of node.children) {
    const paneId = firstDescendantPaneId(nodeMap, childId)

    if (paneId) {
      return paneId
    }
  }

  return null
}

export function splitWorkspacePane(
  layout: WorkspaceLayoutRecord,
  paneId: string,
  splitType: PersistedSplitLayoutNode['type'],
  targetTemplatePaneId?: string,
): WorkspaceLayoutMutationResult {
  const nextLayout = cloneLayout(layout)
  const nodeMap = createNodeMap(nextLayout)
  const paneNode = findPaneNode(nodeMap, paneId)

  if (!paneNode || paneNode.type !== 'pane') {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const splitNodeId = createNodeId(nextLayout, 'split-node')
  const duplicatePaneNodeId = createNodeId(nextLayout, 'pane-node')
  const duplicatePaneId = targetTemplatePaneId
    ? createPaneIdForTemplate(nextLayout, targetTemplatePaneId)
    : createSplitPaneId(nextLayout, paneId)
  const parentNode =
    paneNode.parentId !== null ? (nodeMap.get(paneNode.parentId) ?? null) : null
  const updatedPaneNode = {
    ...paneNode,
    parentId: splitNodeId,
  }
  const duplicatePaneNode: PersistedLayoutNode = {
    children: [] as [],
    id: duplicatePaneNodeId,
    paneId: duplicatePaneId,
    parentId: splitNodeId,
    sizeWeights: [] as [],
    type: 'pane',
    workspaceId: layout.workspaceId,
  }
  const splitNode: PersistedSplitLayoutNode = {
    children: [updatedPaneNode.id, duplicatePaneNode.id],
    id: splitNodeId,
    paneId: null,
    parentId: parentNode?.id ?? null,
    sizeWeights: [1, 1],
    type: splitType,
    workspaceId: layout.workspaceId,
  }

  nodeMap.set(updatedPaneNode.id, updatedPaneNode)

  if (parentNode && parentNode.type !== 'pane') {
    nodeMap.set(parentNode.id, {
      ...parentNode,
      children: parentNode.children.map((childId) =>
        childId === paneNode.id ? splitNodeId : childId,
      ),
    })
  }

  return {
    blockedReason: null,
    didChange: true,
    layout: {
      ...nextLayout,
      nodes: serializeNodes(nextLayout, nodeMap, [
        splitNode,
        duplicatePaneNode,
      ]),
      rootNodeId:
        nextLayout.rootNodeId === paneNode.id
          ? splitNodeId
          : nextLayout.rootNodeId,
    },
    nextActivePaneId: paneId,
  }
}

export function addWorkspacePane(
  layout: WorkspaceLayoutRecord | null,
  workspaceId: string,
  templatePaneId: string,
  _activePaneId: string | null,
  _splitType: PersistedSplitLayoutNode['type'] = 'split-horizontal',
): WorkspaceLayoutMutationResult {
  if (!layout) {
    return {
      blockedReason: null,
      didChange: true,
      layout: createSinglePaneLayout(workspaceId, templatePaneId),
      nextActivePaneId: templatePaneId,
    }
  }

  const nextLayout = cloneLayout(layout)
  const nodeMap = createNodeMap(nextLayout)
  const newPaneNodeId = createNodeId(nextLayout, 'pane-node')
  const newPaneId = createPaneIdForTemplate(nextLayout, templatePaneId)
  const newPaneNode: PersistedLayoutNode = {
    children: [] as [],
    id: newPaneNodeId,
    paneId: newPaneId,
    parentId: null,
    sizeWeights: [] as [],
    type: 'pane',
    workspaceId,
  }
  const rootNode = nodeMap.get(nextLayout.rootNodeId) ?? null

  if (!rootNode) {
    return {
      blockedReason: null,
      didChange: true,
      layout: createSinglePaneLayout(workspaceId, newPaneId),
      nextActivePaneId: newPaneId,
    }
  }

  if (rootNode.type === 'split-horizontal' && rootNode.parentId === null) {
    newPaneNode.parentId = rootNode.id
    nodeMap.set(rootNode.id, {
      ...rootNode,
      children: [...rootNode.children, newPaneNode.id],
      sizeWeights: [...rootNode.sizeWeights, 1],
    })
  } else {
    const splitNodeId = createNodeId(nextLayout, 'split-node')

    nodeMap.set(rootNode.id, {
      ...rootNode,
      parentId: splitNodeId,
    })

    const splitNode: PersistedSplitLayoutNode = {
      children: [rootNode.id, newPaneNode.id],
      id: splitNodeId,
      paneId: null,
      parentId: null,
      sizeWeights: [1, 1],
      type: 'split-horizontal',
      workspaceId,
    }

    newPaneNode.parentId = splitNodeId
    nodeMap.set(splitNode.id, splitNode)
    nextLayout.rootNodeId = splitNodeId

    return {
      blockedReason: null,
      didChange: true,
      layout: {
        ...nextLayout,
        nodes: serializeNodes(nextLayout, nodeMap, [splitNode, newPaneNode]),
      },
      nextActivePaneId: newPaneId,
    }
  }

  nodeMap.set(newPaneNode.id, newPaneNode)

  return {
    blockedReason: null,
    didChange: true,
    layout: {
      ...nextLayout,
      nodes: serializeNodes(nextLayout, nodeMap, [newPaneNode]),
    },
    nextActivePaneId: newPaneId,
  }
}

export function closeWorkspacePane(
  layout: WorkspaceLayoutRecord,
  paneId: string,
): WorkspaceLayoutMutationResult {
  const nextLayout = cloneLayout(layout)
  const nodeMap = createNodeMap(nextLayout)
  const paneNodes = nextLayout.nodes.filter((node) => node.type === 'pane')

  if (paneNodes.length <= 1) {
    return {
      blockedReason: 'last-pane',
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const paneNode = findPaneNode(nodeMap, paneId)

  if (!paneNode || paneNode.type !== 'pane' || !paneNode.parentId) {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const parentNode = nodeMap.get(paneNode.parentId)

  if (!parentNode || parentNode.type === 'pane') {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const paneIndex = parentNode.children.indexOf(paneNode.id)

  if (paneIndex === -1) {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  nodeMap.delete(paneNode.id)

  const remainingChildIds = parentNode.children.filter(
    (childId) => childId !== paneNode.id,
  )
  const remainingWeights = normalizeWeights(
    parentNode.sizeWeights,
    parentNode.children.length,
  ).filter((_, index) => index !== paneIndex)

  let rootNodeId = nextLayout.rootNodeId
  const preferredChildId =
    remainingChildIds[paneIndex] ?? remainingChildIds[paneIndex - 1] ?? null

  if (remainingChildIds.length === 1) {
    const survivingChildId = remainingChildIds[0] ?? null
    const survivingChild =
      survivingChildId !== null ? (nodeMap.get(survivingChildId) ?? null) : null
    const grandparentNode =
      parentNode.parentId !== null
        ? (nodeMap.get(parentNode.parentId) ?? null)
        : null

    nodeMap.delete(parentNode.id)

    if (survivingChild) {
      nodeMap.set(survivingChild.id, {
        ...survivingChild,
        parentId: grandparentNode?.id ?? null,
      })
    }

    if (
      grandparentNode &&
      grandparentNode.type !== 'pane' &&
      survivingChildId
    ) {
      nodeMap.set(grandparentNode.id, {
        ...grandparentNode,
        children: grandparentNode.children.map((childId) =>
          childId === parentNode.id ? survivingChildId : childId,
        ),
      })
    }

    if (rootNodeId === parentNode.id && survivingChildId) {
      rootNodeId = survivingChildId
    }
  } else {
    nodeMap.set(parentNode.id, {
      ...parentNode,
      children: remainingChildIds,
      sizeWeights: remainingWeights,
    })
  }

  return {
    blockedReason: null,
    didChange: true,
    layout: {
      ...nextLayout,
      nodes: serializeNodes(nextLayout, nodeMap),
      rootNodeId,
    },
    nextActivePaneId:
      (preferredChildId && firstDescendantPaneId(nodeMap, preferredChildId)) ??
      nextLayout.nodes.find(
        (node) => node.type === 'pane' && node.paneId !== paneId,
      )?.paneId ??
      null,
  }
}

export function resizeWorkspacePane(
  layout: WorkspaceLayoutRecord,
  paneId: string,
  delta: number,
): WorkspaceLayoutMutationResult {
  const nextLayout = cloneLayout(layout)
  const nodeMap = createNodeMap(nextLayout)
  const paneNode = findPaneNode(nodeMap, paneId)

  if (
    !paneNode ||
    paneNode.type !== 'pane' ||
    !paneNode.parentId ||
    delta === 0
  ) {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const parentNode = nodeMap.get(paneNode.parentId)

  if (
    !parentNode ||
    parentNode.type === 'pane' ||
    parentNode.children.length < 2
  ) {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const paneIndex = parentNode.children.indexOf(paneNode.id)
  const weights = normalizeWeights(
    parentNode.sizeWeights,
    parentNode.children.length,
  )

  if (paneIndex === -1) {
    return {
      blockedReason: null,
      didChange: false,
      layout,
      nextActivePaneId: paneId,
    }
  }

  const nextWeights = [...weights]

  if (delta > 0) {
    const reducibleWeights = weights.map((weight, index) =>
      index === paneIndex ? 0 : Math.max(0, weight - MIN_WEIGHT),
    )
    const totalReducible = reducibleWeights.reduce(
      (total, weight) => total + weight,
      0,
    )
    const transfer = Math.min(delta, totalReducible)

    if (transfer <= 0) {
      return {
        blockedReason: null,
        didChange: false,
        layout,
        nextActivePaneId: paneId,
      }
    }

    for (const [index, reducibleWeight] of reducibleWeights.entries()) {
      if (index === paneIndex || reducibleWeight <= 0) {
        continue
      }

      nextWeights[index] -= (transfer * reducibleWeight) / totalReducible
    }

    nextWeights[paneIndex] += transfer
  } else {
    const shrinkAmount = Math.min(
      -delta,
      Math.max(0, weights[paneIndex] - MIN_WEIGHT),
    )

    if (shrinkAmount <= 0) {
      return {
        blockedReason: null,
        didChange: false,
        layout,
        nextActivePaneId: paneId,
      }
    }

    const growthPerSibling = shrinkAmount / (weights.length - 1)

    nextWeights[paneIndex] -= shrinkAmount

    for (const index of nextWeights.keys()) {
      if (index !== paneIndex) {
        nextWeights[index] += growthPerSibling
      }
    }
  }

  nodeMap.set(parentNode.id, {
    ...parentNode,
    sizeWeights: nextWeights,
  })

  return {
    blockedReason: null,
    didChange: true,
    layout: {
      ...nextLayout,
      nodes: serializeNodes(nextLayout, nodeMap),
    },
    nextActivePaneId: paneId,
  }
}
