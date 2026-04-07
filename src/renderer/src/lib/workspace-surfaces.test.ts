import { describe, expect, it } from 'vitest'

import {
  type WorkspaceLayoutRecord,
  createEmptyPersistenceSnapshot,
} from '../../../shared/persistence'
import {
  createLegacySurfaceId,
  findWorkspaceIdForSurface,
  resolveSurfaceLayout,
  resolveWorkspaceSurfaces,
} from './workspace-surfaces'

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
