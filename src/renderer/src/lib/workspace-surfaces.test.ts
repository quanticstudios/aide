import { describe, expect, it } from 'vitest'

import {
  type WorkspaceLayoutRecord,
  createEmptyPersistenceSnapshot,
} from '../../../shared/persistence'
import {
  createLegacySurfaceId,
  createSinglePaneSurface,
  findWorkspaceIdForSurface,
  resolveSurfaceLayout,
  resolveWorkspaceSurfaces,
} from './workspace-surfaces'
import { createWorkspacePaneInstanceId } from './workspace-layout-mutations'

const AGENT_INSTANCE_ID_PATTERN =
  /^agent::copy-instance-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('workspace surface resolution', () => {
  function createLegacyLayout(): WorkspaceLayoutRecord {
    return {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: 'legacy-pane',
          paneId: 'terminal',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['terminal'],
          workspaceId: 'workspace-1',
        },
      ],
      rootNodeId: 'legacy-pane',
      workspaceId: 'workspace-1',
    }
  }

  it('treats an explicit empty persisted surface state as authoritative', () => {
    const snapshot = {
      ...createEmptyPersistenceSnapshot(),
      surfaceLayouts: {},
      workspaceLayouts: {
        'workspace-1': createLegacyLayout(),
      },
      workspaceSurfaces: {
        'workspace-1': [],
      },
    }
    const legacySurfaceId = createLegacySurfaceId('workspace-1')

    expect(resolveWorkspaceSurfaces(snapshot, 'workspace-1')).toEqual([])
    expect(resolveSurfaceLayout(snapshot, 'workspace-1', legacySurfaceId)).toBe(
      null,
    )
    expect(findWorkspaceIdForSurface(snapshot, legacySurfaceId)).toBeNull()
  })

  it('falls back to legacy workspace layout only when no persisted surface state exists', () => {
    const snapshot = {
      ...createEmptyPersistenceSnapshot(),
      surfaceLayouts: {},
      workspaceLayouts: {
        'workspace-1': createLegacyLayout(),
      },
      workspaceSurfaces: {},
    }
    const legacySurfaceId = createLegacySurfaceId('workspace-1')

    expect(resolveWorkspaceSurfaces(snapshot, 'workspace-1')).toEqual([
      {
        id: legacySurfaceId,
        orderIndex: 0,
        rootNodeId: 'legacy-pane',
        title: 'Workspace',
        workspaceId: 'workspace-1',
      },
    ])
    expect(
      resolveSurfaceLayout(snapshot, 'workspace-1', legacySurfaceId),
    ).toMatchObject({
      rootNodeId: 'legacy-pane',
      surfaceId: legacySurfaceId,
    })
    expect(findWorkspaceIdForSurface(snapshot, legacySurfaceId)).toBe(
      'workspace-1',
    )
  })
})

describe('workspace surface pane identity', () => {
  it('preserves distinct pane identities across surfaces', () => {
    const firstPaneId = createWorkspacePaneInstanceId('agent')
    const secondPaneId = createWorkspacePaneInstanceId('agent')
    const firstSurface = createSinglePaneSurface({
      orderIndex: 0,
      paneId: firstPaneId,
      title: 'Agent',
      workspaceId: 'workspace-1',
    })
    const secondSurface = createSinglePaneSurface({
      orderIndex: 1,
      paneId: secondPaneId,
      title: 'Agent',
      workspaceId: 'workspace-1',
    })

    expect(firstPaneId).toMatch(AGENT_INSTANCE_ID_PATTERN)
    expect(secondPaneId).toMatch(AGENT_INSTANCE_ID_PATTERN)
    expect(secondPaneId).not.toBe(firstPaneId)
    expect(firstSurface.layout.nodes[0]?.paneId).toBe(firstPaneId)
    expect(secondSurface.layout.nodes[0]?.paneId).toBe(secondPaneId)
  })

  it('keeps a saved task pane identity when reopening its surface', () => {
    const savedPaneId = 'agent::copy-7'
    const { layout } = createSinglePaneSurface({
      orderIndex: 0,
      paneId: savedPaneId,
      title: 'Saved task',
      workspaceId: 'workspace-1',
    })

    expect(layout.nodes[0]?.paneId).toBe(savedPaneId)
    expect(layout.nodes[0]?.type === 'pane' && layout.nodes[0].viewIds).toEqual(
      [savedPaneId],
    )
  })
})
