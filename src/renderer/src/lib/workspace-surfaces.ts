import type {
  PersistenceSnapshot,
  SurfaceLayoutRecord,
  WorkspaceLayoutRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'

const LEGACY_SURFACE_SUFFIX = ':surface:legacy-root'

export function createLegacySurfaceId(workspaceId: string): string {
  return `${workspaceId}${LEGACY_SURFACE_SUFFIX}`
}

export function createSinglePaneSurface(args: {
  orderIndex: number
  paneId: string
  title: string
  workspaceId: string
}): {
  layout: SurfaceLayoutRecord
  surface: WorkspaceSurfaceRecord
} {
  const surfaceId = `${args.workspaceId}:surface:${crypto.randomUUID()}`
  const rootNodeId = `${surfaceId}:pane-node:1`

  return {
    layout: {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: rootNodeId,
          paneId: args.paneId,
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: [args.paneId],
          workspaceId: args.workspaceId,
        },
      ],
      rootNodeId,
      surfaceId,
      workspaceId: args.workspaceId,
    },
    surface: {
      id: surfaceId,
      orderIndex: args.orderIndex,
      rootNodeId,
      title: args.title,
      workspaceId: args.workspaceId,
    },
  }
}

export function createSurfaceLayoutRecord(
  surfaceId: string,
  layout: WorkspaceLayoutRecord,
): SurfaceLayoutRecord {
  return {
    ...layout,
    surfaceId,
  }
}

export function resolveWorkspaceSurfaces(
  snapshot: PersistenceSnapshot,
  workspaceId: string | null,
): WorkspaceSurfaceRecord[] {
  if (!workspaceId) {
    return []
  }

  const persisted = snapshot.workspaceSurfaces?.[workspaceId]

  if (persisted && persisted.length > 0) {
    return [...persisted].sort(
      (left, right) => left.orderIndex - right.orderIndex,
    )
  }

  const legacyLayout = snapshot.workspaceLayouts[workspaceId]

  if (
    !legacyLayout ||
    !legacyLayout.rootNodeId ||
    legacyLayout.nodes.length === 0
  ) {
    return []
  }

  return [
    {
      id: createLegacySurfaceId(workspaceId),
      orderIndex: 0,
      rootNodeId: legacyLayout.rootNodeId,
      title: 'Workspace',
      workspaceId,
    },
  ]
}

export function findWorkspaceIdForSurface(
  snapshot: PersistenceSnapshot,
  surfaceId: string | null,
): string | null {
  if (!surfaceId) {
    return null
  }

  for (const [workspaceId, surfaces] of Object.entries(
    snapshot.workspaceSurfaces ?? {},
  )) {
    if (surfaces.some((surface) => surface.id === surfaceId)) {
      return workspaceId
    }
  }

  for (const workspaceId of Object.keys(snapshot.workspaceLayouts)) {
    if (surfaceId === createLegacySurfaceId(workspaceId)) {
      return workspaceId
    }
  }

  return null
}

export function resolveSurfaceLayout(
  snapshot: PersistenceSnapshot,
  workspaceId: string | null,
  surfaceId: string | null,
): SurfaceLayoutRecord | null {
  if (!workspaceId || !surfaceId) {
    return null
  }

  const persisted = snapshot.surfaceLayouts?.[surfaceId]

  if (persisted) {
    return persisted
  }

  const legacySurfaceId = createLegacySurfaceId(workspaceId)

  if (surfaceId !== legacySurfaceId) {
    return null
  }

  const legacyLayout = snapshot.workspaceLayouts[workspaceId]

  return legacyLayout
    ? createSurfaceLayoutRecord(surfaceId, legacyLayout)
    : null
}
