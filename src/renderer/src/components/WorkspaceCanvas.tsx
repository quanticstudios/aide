import { Button, Tooltip } from '@heroui/react'
import {
  Columns2,
  Expand,
  FolderOpen,
  type LucideIcon,
  Plus,
  Rows2,
  Shrink,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type { PreviewTarget } from '../../../shared/domain'
import { listPaneCatalogEntries } from '@/lib/pane-catalog'

import { getWorkspaceScene, resolveWorkspacePane } from '@/lib/navigation-poc'
import { getPaneFrameClassName } from '@/lib/pane-frame'
import { createFallbackPane, renderPaneFromRegistry } from '@/lib/pane-registry'
import { cn } from '@/lib/utils'
import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from '@/lib/workspace-camera'
import {
  collectWorkspaceLayoutPaneIds,
  resolveWorkspaceLayout,
  resolveWorkspaceLayoutRoot,
} from '@/lib/workspace-layout'
import type {
  PersistedLayoutNode,
  PersistedSplitLayoutNode,
  ProjectRecord,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activePreviewTarget: PreviewTarget | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly actionError: string | null
  readonly isDemoMode: boolean
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onClosePane: (paneId: string) => void
  readonly onLoadPreviewTarget: (
    workspace: WorkspaceRecord,
    url: string,
  ) => void
  readonly projectWorkspaces: readonly WorkspaceRecord[]
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSelectPreviewTarget: (
    workspace: WorkspaceRecord,
    targetId: string,
  ) => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly previewTargets: readonly PreviewTarget[]
  readonly shellError: string | null
  readonly workspaceLayouts: Record<string, WorkspaceLayoutRecord>
}

function EmptyState({
  actionLabel,
  error,
  description,
  onAction,
  title,
}: {
  readonly actionLabel: string
  readonly error: string | null
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
        {error ? (
          <div className="w-full rounded-2xl border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
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
  activePreviewTarget: PreviewTarget | null
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  paneId: string
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}) {
  const scene = getWorkspaceScene(args.workspace.id)
  const pane =
    resolveWorkspacePane(args.workspace.id, args.paneId) ??
    createFallbackPane(args.paneId)

  return renderPaneFromRegistry({
    activePaneId: args.activePaneId,
    activePreviewTarget: args.activePreviewTarget,
    onLoadPreviewTarget: args.onLoadPreviewTarget,
    onSelectPreviewTarget: args.onSelectPreviewTarget,
    pane,
    project: args.activeProject,
    previewTargets: args.previewTargets,
    scene,
    workspace: args.workspace,
  })
}

function PaneActionBar({
  canClosePane,
  onClosePane,
  onResizePane,
  onSplitPane,
  paneId,
}: {
  readonly canClosePane: boolean
  readonly onClosePane: (paneId: string) => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly paneId: string
}) {
  const [pendingSplitType, setPendingSplitType] = useState<
    PersistedSplitLayoutNode['type'] | null
  >(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pendingSplitType) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setPendingSplitType(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pendingSplitType])

  const paneOptions = listPaneCatalogEntries()

  const actions: ReadonlyArray<{
    readonly disabled?: boolean
    readonly icon: LucideIcon
    readonly label: string
    readonly onPress: () => void
  }> = [
    {
      icon: Columns2,
      label: 'Split horizontally',
      onPress: () => setPendingSplitType('split-horizontal'),
    },
    {
      icon: Rows2,
      label: 'Split vertically',
      onPress: () => setPendingSplitType('split-vertical'),
    },
    {
      icon: Expand,
      label: 'Grow pane',
      onPress: () => onResizePane(paneId, 0.25),
    },
    {
      icon: Shrink,
      label: 'Shrink pane',
      onPress: () => onResizePane(paneId, -0.25),
    },
    {
      disabled: !canClosePane,
      icon: X,
      label: 'Close pane',
      onPress: () => onClosePane(paneId),
    },
  ]

  return (
    <div
      className="absolute right-3 top-3 z-10"
      onMouseDown={(event) => event.stopPropagation()}
      role="presentation"
      ref={pickerRef}
    >
      <div className="flex flex-row rounded-full border border-border/80 bg-background/94 p-0.5 shadow-[0_18px_44px_rgba(0,0,0,0.42)] backdrop-blur">
        {actions.map((action) => {
          const Icon = action.icon

          return (
            <Tooltip delay={550} key={action.label}>
              <Tooltip.Trigger>
                <Button
                  aria-label={action.label}
                  className="size-6 rounded-full border border-transparent bg-transparent text-muted-foreground transition-colors hover:border-primary/35 hover:bg-primary/8 hover:text-foreground data-[disabled=true]:border-transparent data-[disabled=true]:bg-transparent data-[disabled=true]:text-muted-foreground/45"
                  isDisabled={action.disabled ?? false}
                  isIconOnly
                  onPress={action.onPress}
                  size="sm"
                  variant="ghost"
                >
                  <Icon className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content
                className="rounded-xl border border-border bg-overlay/98 px-2.5 py-1.5 text-xs text-foreground shadow-[var(--overlay-shadow)]"
                placement="bottom"
              >
                {action.label}
              </Tooltip.Content>
            </Tooltip>
          )
        })}
      </div>

      {pendingSplitType ? (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setPendingSplitType(null)}
          />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-48 rounded-xl border border-border bg-background/95 p-1 shadow-[0_20px_60px_rgba(0,0,0,0.34)] backdrop-blur">
            <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Split with
            </p>
            {paneOptions.map((pane) => {
              const Icon = pane.icon

              return (
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-foreground/80 transition-colors hover:bg-surface-secondary hover:text-foreground"
                  key={pane.type}
                  onClick={() => {
                    onSplitPane(paneId, pendingSplitType, pane.type)
                    setPendingSplitType(null)
                  }}
                  type="button"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span>{pane.defaultMetadata.type}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function nodeContainsPane(
  nodeLookup: Map<string, PersistedLayoutNode>,
  node: PersistedLayoutNode,
  paneId: string | null,
): boolean {
  if (!paneId) {
    return false
  }

  if (node.type === 'pane') {
    return node.paneId === paneId
  }

  return node.children.some((childId) => {
    const childNode = nodeLookup.get(childId)

    return childNode ? nodeContainsPane(nodeLookup, childNode, paneId) : false
  })
}

function renderLayoutNode(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  activePreviewTarget: PreviewTarget | null
  canClosePane: boolean
  isInteractive: boolean
  node: PersistedLayoutNode
  nodeLookup: Map<string, PersistedLayoutNode>
  onClosePane: (paneId: string) => void
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onResizePane: (paneId: string, delta: number) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  onSelectPane: (paneId: string) => void
  onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
  ) => void
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}) {
  if (args.node.type === 'pane') {
    const paneId = args.node.paneId
    const isActive = args.node.paneId === args.activePaneId

    return (
      <article
        className={`${getPaneFrameClassName(isActive)} relative cursor-pointer`}
        data-pane-id={paneId}
        key={args.node.id}
        onMouseDown={() => {
          if (args.isInteractive) {
            args.onSelectPane(paneId)
          }
        }}
      >
        {isActive && args.isInteractive ? (
          <PaneActionBar
            canClosePane={args.canClosePane}
            onClosePane={args.onClosePane}
            onResizePane={args.onResizePane}
            onSplitPane={args.onSplitPane}
            paneId={paneId}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[calc(theme(borderRadius.2xl)-1px)]">
          {resolvePaneContent({
            activePaneId: args.activePaneId,
            activeProject: args.activeProject,
            activePreviewTarget: args.activePreviewTarget,
            onLoadPreviewTarget: args.onLoadPreviewTarget,
            onSelectPreviewTarget: args.onSelectPreviewTarget,
            paneId,
            previewTargets: args.previewTargets,
            workspace: args.workspace,
          })}
        </div>
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
              activePreviewTarget: args.activePreviewTarget,
              canClosePane: args.canClosePane,
              isInteractive: args.isInteractive,
              node: childNode,
              nodeLookup: args.nodeLookup,
              onClosePane: args.onClosePane,
              onLoadPreviewTarget: args.onLoadPreviewTarget,
              onResizePane: args.onResizePane,
              onSelectPreviewTarget: args.onSelectPreviewTarget,
              onSelectPane: args.onSelectPane,
              onSplitPane: args.onSplitPane,
              previewTargets: args.previewTargets,
              workspace: args.workspace,
            })}
          </div>
        )
      })}
    </section>
  )
}

function renderPaneTrack(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  activePreviewTarget: PreviewTarget | null
  canClosePane: boolean
  node: PersistedSplitLayoutNode
  nodeLookup: Map<string, PersistedLayoutNode>
  onClosePane: (paneId: string) => void
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onResizePane: (paneId: string, delta: number) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  onSelectPane: (paneId: string) => void
  onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
  ) => void
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}) {
  const childNodes = args.node.children
    .map((childId) => args.nodeLookup.get(childId) ?? null)
    .filter((childNode): childNode is PersistedLayoutNode => childNode !== null)
  const activeIndex = Math.max(
    childNodes.findIndex((childNode) =>
      nodeContainsPane(args.nodeLookup, childNode, args.activePaneId),
    ),
    0,
  )

  return (
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div
        className="flex min-h-0 min-w-0 flex-1 transition-transform duration-200 ease-out"
        style={{
          transform: `translateX(-${activeIndex * 100}%)`,
          width: `${Math.max(childNodes.length, 1) * 100}%`,
        }}
      >
        {childNodes.map((childNode) => (
          <div
            className="flex min-h-0 min-w-0 w-full shrink-0"
            key={childNode.id}
          >
            {renderLayoutNode({
              activePaneId: args.activePaneId,
              activeProject: args.activeProject,
              activePreviewTarget: args.activePreviewTarget,
              canClosePane: args.canClosePane,
              isInteractive: true,
              node: childNode,
              nodeLookup: args.nodeLookup,
              onClosePane: args.onClosePane,
              onLoadPreviewTarget: args.onLoadPreviewTarget,
              onResizePane: args.onResizePane,
              onSelectPreviewTarget: args.onSelectPreviewTarget,
              onSelectPane: args.onSelectPane,
              onSplitPane: args.onSplitPane,
              previewTargets: args.previewTargets,
              workspace: args.workspace,
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function WorkspaceCanvas({
  activePaneId,
  activeProject,
  activePreviewTarget,
  activeWorkspace,
  actionError,
  isDemoMode,
  onCreateProject,
  onCreateWorkspace,
  onClosePane,
  onLoadPreviewTarget,
  onResizePane,
  onSelectPreviewTarget,
  onSelectPane,
  onSplitPane,
  previewTargets,
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
    resolveWorkspacePane(activeWorkspace?.id ?? null, activePaneId)?.label ??
    (isDemoMode ? activeWorkspaceScene.panes[0]?.label : null) ??
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
        actionLabel="Open project"
        description="Open a Git repository to track it here and create a root workspace for its main worktree."
        error={actionError}
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
        error={actionError}
        onAction={onCreateWorkspace}
        title={`No workspace in ${activeProject.name}`}
      />
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      {actionError ? (
        <div className="px-4 pt-4">
          <div className="rounded-2xl border border-destructive/40 bg-card px-4 py-3 text-sm text-destructive">
            {actionError}
          </div>
        </div>
      ) : null}
      <div className="sr-only">
        <span data-testid="active-workspace-name">{activeWorkspace.name}</span>
        <span data-testid="active-pane-name">{activePaneLabel}</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="workspace-slider flex min-h-0 min-w-0 flex-1 flex-col items-stretch transition-transform duration-200 ease-out"
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
            const paneCount = collectWorkspaceLayoutPaneIds(layout).length
            const nodeLookup = new Map(
              layout?.nodes.map((node) => [node.id, node]),
            )

            return (
              <section
                className="workspace-slide flex min-h-0 min-w-0 w-full shrink-0 flex-col overflow-hidden"
                key={workspace.id}
                style={{ height: workspaceSlideHeight }}
              >
                <div className="flex min-h-0 flex-1 overflow-hidden p-4">
                  {activeProject && rootNode && paneCount > 0 ? (
                    rootNode.type === 'split-horizontal' &&
                    isActiveWorkspace ? (
                      renderPaneTrack({
                        activePaneId,
                        activeProject,
                        activePreviewTarget,
                        canClosePane: paneCount > 1,
                        node: rootNode,
                        nodeLookup,
                        onClosePane,
                        onLoadPreviewTarget,
                        onResizePane,
                        onSelectPreviewTarget,
                        onSelectPane,
                        onSplitPane,
                        previewTargets,
                        workspace,
                      })
                    ) : (
                      renderLayoutNode({
                        activePaneId: isActiveWorkspace ? activePaneId : null,
                        activeProject,
                        activePreviewTarget: isActiveWorkspace
                          ? activePreviewTarget
                          : null,
                        canClosePane: paneCount > 1,
                        isInteractive: isActiveWorkspace,
                        node: rootNode,
                        nodeLookup,
                        onClosePane,
                        onLoadPreviewTarget,
                        onResizePane,
                        onSelectPreviewTarget,
                        onSelectPane,
                        onSplitPane,
                        previewTargets: isActiveWorkspace ? previewTargets : [],
                        workspace,
                      })
                    )
                  ) : activeProject && !isDemoMode ? (
                    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-border/70 bg-card/60 p-8 text-center">
                      <div className="max-w-md space-y-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Empty workspace
                        </p>
                        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                          {workspace.name} starts blank
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          This workspace does not open placeholder panes
                          anymore. Pane creation should start from explicit user
                          choice.
                        </p>
                      </div>
                    </div>
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
