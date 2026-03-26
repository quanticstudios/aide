import { Button } from '@heroui/react'
import { FolderOpen, Plus } from 'lucide-react'

import { getWorkspaceScene } from '@/lib/navigation-poc'
import { getPaneFrameClassName } from '@/lib/pane-frame'
import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from '@/lib/workspace-camera'
import {
  resolveWorkspaceLayout,
  resolveWorkspaceLayoutRoot,
} from '@/lib/workspace-layout'
import type {
  PersistedLayoutNode,
  ProjectRecord,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import PlaceholderWorkspaceView from './PlaceholderWorkspaceView'
import PreviewPane from './PreviewPane'
import TerminalPane from './TerminalPane'

interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly projectWorkspaces: readonly WorkspaceRecord[]
  readonly shellError: string | null
  readonly workspaceLayouts: Record<string, WorkspaceLayoutRecord>
}

function EmptyState({
  actionLabel,
  description,
  onAction,
  title,
}: {
  readonly actionLabel: string
  readonly description: string
  readonly onAction: () => void
  readonly title: string
}) {
  return (
    <section className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <div className="rounded-full border border-border bg-card p-4 text-muted-foreground">
          <FolderOpen className="size-6" />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Navigation shell
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onPress={onAction} size="sm" variant="primary">
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      </div>
    </section>
  )
}

function resolvePaneContent(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  paneId: string
  workspace: WorkspaceRecord
}) {
  const scene = getWorkspaceScene(args.workspace.id)
  const pane = scene.panes.find(
    (candidate) => candidate.id === args.paneId,
  ) ?? {
    accent: 'blue' as const,
    description: 'Placeholder pane metadata is missing for this layout node.',
    id: args.paneId,
    label: args.paneId,
    layoutClassName: '',
    type: 'Chat',
  }
  const isActive = pane.id === args.activePaneId

  if (pane.type === 'Terminal') {
    return isActive ? (
      <TerminalPane paneId={pane.id} workspace={args.workspace} />
    ) : (
      <div className="flex h-full w-full items-center justify-center rounded-xl border border-border/50 bg-[#0f131b] text-sm text-muted-foreground">
        Terminal session hidden until this pane is focused.
      </div>
    )
  }

  if (pane.type === 'Preview' && isActive) {
    return <PreviewPane />
  }

  return (
    <PlaceholderWorkspaceView
      pane={pane}
      project={args.activeProject}
      scene={scene}
      workspace={args.workspace}
    />
  )
}

function renderLayoutNode(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  node: PersistedLayoutNode
  nodeLookup: Map<string, PersistedLayoutNode>
  workspace: WorkspaceRecord
}) {
  if (args.node.type === 'pane') {
    const isActive = args.node.paneId === args.activePaneId

    return (
      <article
        className={getPaneFrameClassName(isActive)}
        data-pane-id={args.node.paneId}
        key={args.node.id}
      >
        {resolvePaneContent({
          activePaneId: args.activePaneId,
          activeProject: args.activeProject,
          paneId: args.node.paneId,
          workspace: args.workspace,
        })}
      </article>
    )
  }

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-1 gap-4 overflow-hidden',
        args.node.type === 'split-horizontal' ? 'flex-row' : 'flex-col',
      )}
      key={args.node.id}
    >
      {args.node.children.map((childId, index) => {
        const childNode = args.nodeLookup.get(childId)

        if (!childNode) {
          return null
        }

        return (
          <div
            className="flex min-h-0 min-w-0"
            key={childId}
            style={{
              flexBasis: 0,
              flexGrow: args.node.sizeWeights[index] ?? 1,
              flexShrink: 1,
            }}
          >
            {renderLayoutNode({
              activePaneId: args.activePaneId,
              activeProject: args.activeProject,
              node: childNode,
              nodeLookup: args.nodeLookup,
              workspace: args.workspace,
            })}
          </div>
        )
      })}
    </section>
  )
}

export default function WorkspaceCanvas({
  activePaneId,
  activeProject,
  activeWorkspace,
  onCreateProject,
  onCreateWorkspace,
  projectWorkspaces,
  shellError,
  workspaceLayouts,
}: WorkspaceCanvasProps) {
  const workspaceCount = Math.max(projectWorkspaces.length, 1)
  const activeWorkspaceIndex = Math.max(
    projectWorkspaces.findIndex(
      (workspace) => workspace.id === activeWorkspace?.id,
    ),
    0,
  )
  const workspaceTrackStyle = getWorkspaceTrackStyle(
    workspaceCount,
    activeWorkspaceIndex,
  )
  const workspaceSlideHeight = getWorkspaceSlideHeight(workspaceCount)
  const activeWorkspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)
  const activePaneLabel =
    activeWorkspaceScene.panes.find((pane) => pane.id === activePaneId)
      ?.label ??
    activeWorkspaceScene.panes[0]?.label ??
    ''

  if (shellError) {
    return (
      <section className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-xl border border-destructive/40 bg-card p-6 text-center shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-destructive">
            Shell error
          </p>
          <h1 className="mt-3 text-xl font-semibold">
            Workspace shell failed to load
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{shellError}</p>
        </div>
      </section>
    )
  }

  if (!activeProject) {
    return (
      <EmptyState
        actionLabel="Create project"
        description="Start by creating a project. Projects group the workspaces you will switch between."
        onAction={onCreateProject}
        title="No project selected"
      />
    )
  }

  if (!activeWorkspace) {
    return (
      <EmptyState
        actionLabel="Create workspace"
        description="This project is tracked, but it does not have a workspace yet. Create one to make the main region yours."
        onAction={onCreateWorkspace}
        title={`No workspace in ${activeProject.name}`}
      />
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="sr-only">
        <span data-testid="active-workspace-name">{activeWorkspace.name}</span>
        <span data-testid="active-pane-name">{activePaneLabel}</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="workspace-slider flex min-h-0 shrink-0 flex-col items-stretch transition-transform duration-200 ease-out"
          style={workspaceTrackStyle}
        >
          {projectWorkspaces.map((workspace) => {
            const isActiveWorkspace = workspace.id === activeWorkspace.id
            const workspaceSnapshot = {
              databasePath: '',
              lastActivePaneIdsByWorkspace: {},
              lastActiveProjectId: null,
              lastActiveWorkspaceIdsByProject: {},
              lastActiveWorkspaceId: null,
              migrationStrategy: '',
              schemaVersion: 0,
              projects: [],
              workspaceLayouts,
              workspaces: [],
            }
            const layout = resolveWorkspaceLayout(
              workspaceSnapshot,
              workspace.id,
            )
            const rootNode = resolveWorkspaceLayoutRoot(layout)
            const nodeLookup = new Map(
              layout?.nodes.map((node) => [node.id, node]),
            )

            return (
              <section
                className="workspace-slide flex min-h-0 shrink-0 flex-col overflow-hidden"
                key={workspace.id}
                style={{ height: workspaceSlideHeight }}
              >
                <div className="flex min-h-0 flex-1 overflow-hidden p-4">
                  {activeProject && rootNode ? (
                    renderLayoutNode({
                      activePaneId: isActiveWorkspace ? activePaneId : null,
                      activeProject,
                      node: rootNode,
                      nodeLookup,
                      workspace,
                    })
                  ) : (
                    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-destructive/30 bg-card text-sm text-muted-foreground">
                      Workspace layout is missing a valid root node.
                    </div>
                  )}
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
