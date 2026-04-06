import type {
  PersistedLayoutNode,
  WorkspaceLayoutRecord,
} from '../../../shared/persistence'

export type WorkspaceLayoutPresetId = 'columns' | 'focus' | 'stack'

function createPaneNode(
  workspaceId: string,
  nodeId: string,
  paneId: string,
  parentId: string | null,
): PersistedLayoutNode {
  return {
    activeViewIndex: 0,
    children: [],
    id: nodeId,
    paneId,
    parentId,
    sizeWeights: [],
    type: 'pane',
    viewIds: [paneId],
    workspaceId,
  }
}

function createFlatSplitLayout(
  workspaceId: string,
  paneIds: readonly string[],
  type: 'split-horizontal' | 'split-vertical',
): WorkspaceLayoutRecord {
  if (paneIds.length === 0) {
    return {
      nodes: [],
      rootNodeId: `${workspaceId}:empty`,
      workspaceId,
    }
  }

  if (paneIds.length === 1) {
    return {
      nodes: [
        createPaneNode(
          workspaceId,
          `${workspaceId}:pane:1`,
          paneIds[0] ?? 'pane',
          null,
        ),
      ],
      rootNodeId: `${workspaceId}:pane:1`,
      workspaceId,
    }
  }

  const rootId = `${workspaceId}:preset-root`
  const paneNodes = paneIds.map((paneId, index) =>
    createPaneNode(
      workspaceId,
      `${workspaceId}:pane:${index + 1}`,
      paneId,
      rootId,
    ),
  )

  return {
    nodes: [
      {
        children: paneNodes.map((node) => node.id),
        id: rootId,
        paneId: null,
        parentId: null,
        sizeWeights: paneNodes.map(() => 1),
        type,
        workspaceId,
      },
      ...paneNodes,
    ],
    rootNodeId: rootId,
    workspaceId,
  }
}

function createFocusLayout(
  workspaceId: string,
  paneIds: readonly string[],
): WorkspaceLayoutRecord {
  if (paneIds.length <= 2) {
    return createFlatSplitLayout(workspaceId, paneIds, 'split-horizontal')
  }

  const rootId = `${workspaceId}:focus-root`
  const stackId = `${workspaceId}:focus-stack`
  const primaryPane = createPaneNode(
    workspaceId,
    `${workspaceId}:pane:1`,
    paneIds[0] ?? 'pane',
    rootId,
  )
  const secondaryPaneIds = paneIds.slice(1)
  const secondaryPaneNodes = secondaryPaneIds.map((paneId, index) =>
    createPaneNode(
      workspaceId,
      `${workspaceId}:pane:${index + 2}`,
      paneId,
      stackId,
    ),
  )

  return {
    nodes: [
      {
        children: [primaryPane.id, stackId],
        id: rootId,
        paneId: null,
        parentId: null,
        sizeWeights: [2, 1],
        type: 'split-horizontal',
        workspaceId,
      },
      primaryPane,
      {
        children: secondaryPaneNodes.map((node) => node.id),
        id: stackId,
        paneId: null,
        parentId: rootId,
        sizeWeights: secondaryPaneNodes.map(() => 1),
        type: 'split-vertical',
        workspaceId,
      },
      ...secondaryPaneNodes,
    ],
    rootNodeId: rootId,
    workspaceId,
  }
}

export function createWorkspaceLayoutPreset(
  workspaceId: string,
  paneIds: readonly string[],
  presetId: WorkspaceLayoutPresetId,
): WorkspaceLayoutRecord {
  if (presetId === 'stack') {
    return createFlatSplitLayout(workspaceId, paneIds, 'split-vertical')
  }

  if (presetId === 'focus') {
    return createFocusLayout(workspaceId, paneIds)
  }

  return createFlatSplitLayout(workspaceId, paneIds, 'split-horizontal')
}
