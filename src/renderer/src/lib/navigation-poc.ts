import type {
  PersistenceSnapshot,
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

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
  panes: [
    {
      accent: 'blue',
      description: 'Task and coordination surface.',
      id: 'chat',
      label: 'Chat task thread',
      layoutClassName: 'lg:col-span-4 lg:row-span-2',
      type: 'Chat',
    },
    {
      accent: 'emerald',
      description: 'Execution and verification surface.',
      id: 'terminal',
      label: 'Workspace terminal',
      layoutClassName: 'lg:col-span-4 lg:row-span-2',
      type: 'Terminal',
    },
    {
      accent: 'amber',
      description: 'Inspection and trust surface.',
      id: 'git',
      label: 'Git review',
      layoutClassName: 'lg:col-span-4 lg:row-span-2',
      type: 'Git',
    },
  ],
}

export const NAVIGATION_POC_SNAPSHOT: PersistenceSnapshot = {
  databasePath: 'demo://navigation-poc',
  lastActiveProjectId: 'demo-project-aide',
  lastActiveWorkspaceId: 'demo-workspace-aide-nav',
  migrationStrategy: 'Navigation-first POC fallback snapshot',
  schemaVersion: 0,
  projects: demoProjects,
  workspaces: demoWorkspaces,
}

export function getWorkspaceScene(workspaceId: string | null): WorkspaceScene {
  if (!workspaceId) {
    return defaultWorkspaceScene
  }

  return workspaceScenes[workspaceId] ?? defaultWorkspaceScene
}

export function resolveWorkspacePaneId(
  workspaceId: string | null,
  activePaneId: string | null,
): string | null {
  const scene = getWorkspaceScene(workspaceId)

  if (scene.panes.some((pane) => pane.id === activePaneId)) {
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
): PersistenceSnapshot {
  if (snapshot && snapshot.projects.length > 0) {
    return snapshot
  }

  return NAVIGATION_POC_SNAPSHOT
}
