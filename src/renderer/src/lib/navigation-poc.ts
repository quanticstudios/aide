import type {
  PersistenceSnapshot,
  ProjectRecord,
  SurfaceLayoutRecord,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import { createDefaultPaneMetadata } from './pane-catalog'

export interface PlaceholderPane {
  accent: 'amber' | 'blue' | 'emerald' | 'rose' | 'violet'
  description: string
  id: string
  label: string
  layoutClassName: string
  type: string
}

export interface WorkspaceScene {
  description: string
  headline: string
  panes: PlaceholderPane[]
}

const PANE_COPY_MARKER = '::copy-'

function createProject(
  id: string,
  name: string,
  repoRoot: string,
  defaultBranch: string,
): ProjectRecord {
  return {
    id,
    name,
    repoRoot,
    remoteUrl: null,
    defaultBranch,
    createdAt: '2026-03-22T00:00:00Z',
    updatedAt: '2026-03-22T00:00:00Z',
  }
}

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
  branchName: string,
  worktreePath: string,
): WorkspaceRecord {
  return {
    id,
    projectId,
    name,
    branchName,
    worktreePath,
    windowId: null,
    createdAt: '2026-03-22T00:00:00Z',
    updatedAt: '2026-03-22T00:00:00Z',
  }
}

const demoProjects = [
  createProject('demo-project-aide', 'aide', '/work/aide', 'main'),
  createProject(
    'demo-project-storefront',
    'storefront',
    '/work/storefront',
    'main',
  ),
  createProject('demo-project-infra', 'infra', '/work/infra', 'main'),
]

const demoWorkspaces = [
  createWorkspace(
    'demo-workspace-aide-nav',
    'demo-project-aide',
    'navigation-poc',
    'feat/navigation-poc',
    '/work/aide/.worktrees/navigation-poc',
  ),
  createWorkspace(
    'demo-workspace-aide-review',
    'demo-project-aide',
    'agent-review',
    'chore/agent-followups',
    '/work/aide/.worktrees/agent-review',
  ),
  createWorkspace(
    'demo-workspace-storefront-checkout',
    'demo-project-storefront',
    'checkout-redesign',
    'feat/checkout-redesign',
    '/work/storefront/.worktrees/checkout-redesign',
  ),
  createWorkspace(
    'demo-workspace-storefront-pricing',
    'demo-project-storefront',
    'pricing-test',
    'experiment/pricing-copy',
    '/work/storefront/.worktrees/pricing-test',
  ),
  createWorkspace(
    'demo-workspace-infra-deploy',
    'demo-project-infra',
    'deploy-pipeline',
    'feat/deploy-pipeline',
    '/work/infra/.worktrees/deploy-pipeline',
  ),
]

const workspaceScenes: Record<string, WorkspaceScene> = {
  'demo-workspace-aide-nav': {
    headline: 'Navigation shell proof',
    description:
      'The selected workspace owns the whole surface. Placeholder panes simply show where core tools will live once navigation feels right.',
    panes: [
      {
        accent: 'blue',
        description:
          'Active task thread and next action list for the workspace.',
        id: 'chat',
        label: 'Chat task thread',
        layoutClassName: 'lg:col-span-5 lg:row-span-2',
        type: 'Chat',
      },
      {
        accent: 'emerald',
        description:
          'Command execution and build/test loops tied to this branch.',
        id: 'terminal',
        label: 'Workspace terminal',
        layoutClassName: 'lg:col-span-7 lg:row-span-2',
        type: 'Terminal',
      },
      {
        accent: 'amber',
        description: 'Changed-file review surface for trusting generated work.',
        id: 'git',
        label: 'Git review',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Git',
      },
      {
        accent: 'violet',
        description:
          'Light editor surface for jumping to files and validating edits.',
        id: 'editor',
        label: 'Editor inspect',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Editor',
      },
      {
        accent: 'rose',
        description: 'Preview target for the running app or docs surface.',
        id: 'preview',
        label: 'Preview target',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Preview',
      },
    ],
  },
  'demo-workspace-aide-review': {
    headline: 'Review-heavy workspace',
    description:
      'The same shell shifts emphasis depending on the selected workspace, while the navigation model stays unchanged.',
    panes: [
      {
        accent: 'amber',
        description: 'Primary diff inspection and changed-file routing.',
        id: 'git',
        label: 'Git review',
        layoutClassName: 'lg:col-span-6 lg:row-span-3',
        type: 'Git',
      },
      {
        accent: 'violet',
        description: 'File-by-file inspection for generated changes.',
        id: 'editor',
        label: 'Editor inspect',
        layoutClassName: 'lg:col-span-6 lg:row-span-2',
        type: 'Editor',
      },
      {
        accent: 'emerald',
        description: 'Test reruns and command history for this review branch.',
        id: 'terminal',
        label: 'Terminal verification',
        layoutClassName: 'lg:col-span-6 lg:row-span-1',
        type: 'Terminal',
      },
    ],
  },
  'demo-workspace-storefront-checkout': {
    headline: 'App delivery workspace',
    description:
      'Product workspaces can emphasize preview and editor validation without changing how you move between them.',
    panes: [
      {
        accent: 'rose',
        description: 'Live customer-facing checkout build preview.',
        id: 'preview',
        label: 'Checkout preview',
        layoutClassName: 'lg:col-span-7 lg:row-span-3',
        type: 'Preview',
      },
      {
        accent: 'violet',
        description: 'Implementation details and file jump targets.',
        id: 'editor',
        label: 'Editor inspect',
        layoutClassName: 'lg:col-span-5 lg:row-span-2',
        type: 'Editor',
      },
      {
        accent: 'blue',
        description: 'Open product questions and implementation tasks.',
        id: 'chat',
        label: 'Task thread',
        layoutClassName: 'lg:col-span-5 lg:row-span-1',
        type: 'Chat',
      },
    ],
  },
  'demo-workspace-storefront-pricing': {
    headline: 'Fast experiment workspace',
    description:
      'Short-lived experiments should still feel like first-class workspaces with a clear place in the project map.',
    panes: [
      {
        accent: 'blue',
        description: 'Experiment brief, notes, and decision log.',
        id: 'chat',
        label: 'Experiment brief',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Chat',
      },
      {
        accent: 'rose',
        description: 'Preview of alternate pricing states.',
        id: 'preview',
        label: 'Pricing preview',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Preview',
      },
      {
        accent: 'emerald',
        description: 'CLI and analytics checks for the experiment.',
        id: 'terminal',
        label: 'Terminal checks',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Terminal',
      },
    ],
  },
  'demo-workspace-infra-deploy': {
    headline: 'Operations workspace',
    description:
      'Infrastructure workspaces still benefit from the same movement model: project, workspace, then full-screen task focus.',
    panes: [
      {
        accent: 'emerald',
        description: 'Deploy logs, rollouts, and CLI orchestration.',
        id: 'terminal',
        label: 'Deployment terminal',
        layoutClassName: 'lg:col-span-8 lg:row-span-3',
        type: 'Terminal',
      },
      {
        accent: 'amber',
        description: 'Release diffs, infra config review, and approvals.',
        id: 'git',
        label: 'Infra review',
        layoutClassName: 'lg:col-span-4 lg:row-span-2',
        type: 'Git',
      },
      {
        accent: 'blue',
        description: 'Runbook and change summary tied to the rollout.',
        id: 'chat',
        label: 'Runbook thread',
        layoutClassName: 'lg:col-span-4 lg:row-span-1',
        type: 'Chat',
      },
    ],
  },
}

const defaultWorkspaceScene: WorkspaceScene = {
  headline: 'Workspace navigation proof',
  description:
    'Every workspace should feel like its own focused destination, even before the real pane implementations land.',
  panes: (['chat', 'terminal', 'git', 'editor', 'preview'] as const).map(
    (paneType) => ({
      ...createDefaultPaneMetadata(paneType),
      id: paneType,
      layoutClassName: 'lg:col-span-4 lg:row-span-2',
    }),
  ),
}

const demoWorkspaceLayouts: Record<string, WorkspaceLayoutRecord> = {
  'demo-workspace-aide-nav': {
    nodes: [
      {
        children: ['nav-primary-column', 'nav-review-column', 'nav-preview'],
        id: 'nav-root',
        paneId: null,
        parentId: null,
        sizeWeights: [1.1, 1, 1.1],
        type: 'split-horizontal',
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        children: ['nav-chat', 'nav-terminal'],
        id: 'nav-primary-column',
        paneId: null,
        parentId: 'nav-root',
        sizeWeights: [1, 1.1],
        type: 'split-vertical',
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'nav-chat',
        paneId: 'chat',
        parentId: 'nav-primary-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['chat'],
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'nav-terminal',
        paneId: 'terminal',
        parentId: 'nav-primary-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['terminal'],
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        children: ['nav-git', 'nav-editor'],
        id: 'nav-review-column',
        paneId: null,
        parentId: 'nav-root',
        sizeWeights: [1.2, 1],
        type: 'split-vertical',
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'nav-git',
        paneId: 'git',
        parentId: 'nav-review-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['git'],
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'nav-editor',
        paneId: 'editor',
        parentId: 'nav-review-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['editor'],
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'nav-preview',
        paneId: 'preview',
        parentId: 'nav-root',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['preview'],
        workspaceId: 'demo-workspace-aide-nav',
      },
    ],
    rootNodeId: 'nav-root',
    workspaceId: 'demo-workspace-aide-nav',
  },
}

function createDemoSurface(
  workspaceId: string,
  paneId: string,
  title: string,
  orderIndex: number,
): {
  layout: SurfaceLayoutRecord
  surface: WorkspaceSurfaceRecord
} {
  const surfaceId = `${workspaceId}:surface:${paneId}`
  const rootNodeId = `${surfaceId}:pane`

  return {
    layout: {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: rootNodeId,
          paneId,
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: [paneId],
          workspaceId,
        },
      ],
      rootNodeId,
      surfaceId,
      workspaceId,
    },
    surface: {
      id: surfaceId,
      orderIndex,
      rootNodeId,
      title,
      workspaceId,
    },
  }
}

const demoWorkspaceSurfaces: Record<string, WorkspaceSurfaceRecord[]> = {}
const demoSurfaceLayouts: Record<string, SurfaceLayoutRecord> = {}

for (const [workspaceId, scene] of Object.entries(workspaceScenes)) {
  demoWorkspaceSurfaces[workspaceId] = scene.panes.map((pane, index) => {
    const { layout, surface } = createDemoSurface(
      workspaceId,
      pane.id,
      pane.label,
      index,
    )
    demoSurfaceLayouts[surface.id] = layout
    return surface
  })
}

export const NAVIGATION_POC_SNAPSHOT: PersistenceSnapshot = {
  databasePath: 'demo://navigation-poc',
  lastActivePaneIdsBySurface: {},
  lastActivePaneIdsByWorkspace: {},
  lastActiveProjectId: 'demo-project-aide',
  lastActiveSurfaceIdsByWorkspace: {},
  lastActiveWorkspaceIdsByProject: {},
  lastActiveWorkspaceId: 'demo-workspace-aide-nav',
  migrationStrategy: 'Navigation-first POC fallback snapshot',
  schemaVersion: 0,
  projects: demoProjects,
  surfaceLayouts: demoSurfaceLayouts,
  workspaceLayouts: demoWorkspaceLayouts,
  workspaceSurfaces: demoWorkspaceSurfaces,
  workspaces: demoWorkspaces,
}

export function getWorkspaceScene(workspaceId: string | null): WorkspaceScene {
  if (!workspaceId) {
    return defaultWorkspaceScene
  }

  return workspaceScenes[workspaceId] ?? defaultWorkspaceScene
}

export function isDemoWorkspaceId(workspaceId: string | null): boolean {
  return Boolean(workspaceId && workspaceId in workspaceScenes)
}

export function getWorkspacePaneTemplateId(paneId: string): string {
  const markerIndex = paneId.indexOf(PANE_COPY_MARKER)

  return markerIndex === -1 ? paneId : paneId.slice(0, markerIndex)
}

export function resolveWorkspacePane(
  workspaceId: string | null,
  paneId: string | null,
): PlaceholderPane | null {
  const scene = getWorkspaceScene(workspaceId)

  if (scene.panes.length === 0) {
    return null
  }

  if (!paneId) {
    return scene.panes[0] ?? null
  }

  const templateId = getWorkspacePaneTemplateId(paneId)
  const template =
    scene.panes.find((pane) => pane.id === templateId) ?? scene.panes[0]

  if (!template) {
    return null
  }

  const isCopy = paneId !== templateId
  const copyNumber = isCopy
    ? Number.parseInt(
        paneId.slice(paneId.lastIndexOf(PANE_COPY_MARKER) + 7),
        10,
      )
    : null

  return {
    ...template,
    id: paneId,
    label:
      isCopy && Number.isFinite(copyNumber)
        ? `${template.label} copy ${copyNumber}`
        : template.label,
  }
}

export function resolveWorkspacePaneId(
  workspaceId: string | null,
  activePaneId: string | null,
): string | null {
  const scene = getWorkspaceScene(workspaceId)

  if (activePaneId && resolveWorkspacePane(workspaceId, activePaneId)) {
    return activePaneId
  }

  return scene.panes[0]?.id ?? null
}

export function selectRelativePane(
  workspaceId: string | null,
  activePaneId: string | null,
  direction: -1 | 1,
): string | null {
  const scene = getWorkspaceScene(workspaceId)

  if (scene.panes.length === 0) {
    return null
  }

  const resolvedPaneId = resolveWorkspacePaneId(workspaceId, activePaneId)
  const currentIndex = scene.panes.findIndex(
    (pane) => pane.id === resolvedPaneId,
  )

  if (currentIndex === -1) {
    return scene.panes[0]?.id ?? null
  }

  const nextIndex =
    (currentIndex + direction + scene.panes.length) % scene.panes.length

  return scene.panes[nextIndex]?.id ?? null
}

export function isNavigationPocSnapshot(
  snapshot: PersistenceSnapshot | null,
): boolean {
  return snapshot?.databasePath === NAVIGATION_POC_SNAPSHOT.databasePath
}

export function resolveNavigationSnapshot(
  snapshot: PersistenceSnapshot | null,
  useNavigationPoc = false,
): PersistenceSnapshot {
  if (snapshot) {
    if (snapshot.projects.length > 0 || !useNavigationPoc) {
      return snapshot
    }
  }

  if (useNavigationPoc) {
    return NAVIGATION_POC_SNAPSHOT
  }

  if (snapshot) {
    return snapshot
  }

  return {
    databasePath: '.aide.sqlite3',
    lastActivePaneIdsBySurface: {},
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveSurfaceIdsByWorkspace: {},
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: 'Pending runtime snapshot',
    schemaVersion: 0,
    projects: [],
    surfaceLayouts: {},
    workspaceLayouts: {},
    workspaceSurfaces: {},
    workspaces: [],
  }
}
