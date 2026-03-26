import type {
  PersistedLayoutNode,
  PersistenceSnapshot,
  WorkspaceLayoutRecord,
} from '../../../shared/persistence'
import type { PlaceholderPane } from './navigation-poc'
import { getWorkspaceScene } from './navigation-poc'

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
  workspaceId: string,
): WorkspaceLayoutRecord {
  const scene = getWorkspaceScene(workspaceId)
  const paneNodes = scene.panes.map((pane) =>
    createPaneLayoutNode(workspaceId, pane),
  )

  return {
    nodes: [
      {
        children: paneNodes.map((pane) => pane.id),
        id: `${workspaceId}:fallback-root`,
        paneId: null,
        parentId: null,
        sizeWeights: paneNodes.map(() => 1),
        type: 'split-horizontal',
        workspaceId,
      },
      ...paneNodes,
    ],
    rootNodeId: `${workspaceId}:fallback-root`,
    workspaceId,
  }
}

export function resolveWorkspaceLayout(
  snapshot: PersistenceSnapshot,
  workspaceId: string | null,
): WorkspaceLayoutRecord | null {
  if (!workspaceId) {
    return null
  }

  return (
    snapshot.workspaceLayouts[workspaceId] ??
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

function createPaneLayoutNode(
  workspaceId: string,
  pane: PlaceholderPane,
): PersistedLayoutNode {
  return {
    children: [],
    id: `${workspaceId}:${pane.id}`,
    paneId: pane.id,
    parentId: `${workspaceId}:fallback-root`,
    sizeWeights: [],
    type: 'pane',
    workspaceId,
  }
}
