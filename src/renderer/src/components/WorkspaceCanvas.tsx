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

import {
  createFallbackPaneMetadata,
  getPaneCatalogEntry,
  listCreatablePaneCatalogEntries,
  resolvePaneMetadata,
} from '@/lib/pane-catalog'
import type { PreviewTarget } from '../../../shared/domain'

import { getPaneFrameClassName } from '@/lib/pane-frame'
import { createFallbackPane, renderPaneFromRegistry } from '@/lib/pane-registry'
import { cn } from '@/lib/utils'
import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from '@/lib/workspace-camera'
import {
  collectWorkspaceLayoutPaneIds,
  resolveWorkspaceLayoutRoot,
} from '@/lib/workspace-layout'
import {
  resolveSurfaceLayout,
  resolveWorkspaceSurfaces,
} from '@/lib/workspace-surfaces'
import type {
  PersistedLayoutNode,
  PersistedSplitLayoutNode,
  PersistenceSnapshot,
  ProjectRecord,
  SurfaceLayoutRecord,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activePreviewTarget: PreviewTarget | null
  readonly activeSurfaceId: string | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly actionError: string | null
  readonly onAddView: (paneId: string, templateViewId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onClosePane: (paneId: string) => void
  readonly onLoadPreviewTarget: (
    workspace: WorkspaceRecord,
    url: string,
  ) => void
  readonly projectWorkspaces: readonly WorkspaceRecord[]
  readonly onRemoveView: (paneId: string, viewIndex: number) => void
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
  readonly onSwitchView: (paneId: string, viewIndex: number) => void
  readonly previewTargets: readonly PreviewTarget[]
  readonly shellError: string | null
  readonly surfaceLayouts: Record<string, SurfaceLayoutRecord>
  readonly workspaceLayouts: Record<string, WorkspaceLayoutRecord>
  readonly workspaceSurfaces: Record<string, WorkspaceSurfaceRecord[]>
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
  onClosePane: (paneId: string) => void
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  paneId: string
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}) {
  const pane = createFallbackPane(args.paneId)

  return renderPaneFromRegistry({
    activePaneId: args.activePaneId,
    activePreviewTarget: args.activePreviewTarget,
    onClosePane: args.onClosePane,
    onLoadPreviewTarget: args.onLoadPreviewTarget,
    onSelectPreviewTarget: args.onSelectPreviewTarget,
    pane,
    project: args.activeProject,
    previewTargets: args.previewTargets,
    workspace: args.workspace,
  })
}

function PaneActionBar({
  onClosePane,
  onResizePane,
  onSplitPane,
  paneId,
}: {
  readonly onClosePane: (paneId: string) => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly paneId: string
}) {
  const [pickerMode, setPickerMode] = useState<
    'split-horizontal' | 'split-vertical' | null
  >(null)
  const pickerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pickerMode) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setPickerMode(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pickerMode])

  const viewOptions = listCreatablePaneCatalogEntries()

  const actions: ReadonlyArray<{
    readonly icon: LucideIcon
    readonly label: string
    readonly onPress: () => void
  }> = [
    {
      icon: Columns2,
      label: 'Split horizontally',
      onPress: () => setPickerMode('split-horizontal'),
    },
    {
      icon: Rows2,
      label: 'Split vertically',
      onPress: () => setPickerMode('split-vertical'),
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
      icon: X,
      label: 'Close pane',
      onPress: () => onClosePane(paneId),
    },
  ]

  const pickerLabel =
    pickerMode === 'split-horizontal'
      ? 'Split horizontal with'
      : 'Split vertical with'

  return (
    <div
      className="absolute right-6 top-4 z-10 -translate-y-1/2 opacity-0 transition-opacity group-hover/pane:opacity-100"
      onMouseDown={(event) => event.stopPropagation()}
      role="presentation"
      ref={pickerRef}
    >
      <div className="flex flex-row items-center rounded-full border border-[#3a3a44] bg-[#28282f] px-0.5 shadow-[0_18px_44px_rgba(0,0,0,0.42)]">
        {actions.map((action) => {
          const Icon = action.icon

          return (
            <Tooltip delay={550} key={action.label}>
              <Tooltip.Trigger>
                <Button
                  aria-label={action.label}
                  className="size-6 rounded-full border border-transparent bg-transparent text-[#b0b0bc] transition-colors hover:border-primary/35 hover:bg-primary/8 hover:text-white"
                  isIconOnly
                  onPress={action.onPress}
                  size="sm"
                  variant="ghost"
                >
                  <Icon className="size-3.5" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content
                className="rounded-xl border border-[#3a3a44] bg-[#28282f] px-2.5 py-1.5 text-xs text-foreground shadow-[var(--overlay-shadow)]"
                placement="bottom"
              >
                {action.label}
              </Tooltip.Content>
            </Tooltip>
          )
        })}
      </div>

      {pickerMode ? (
        <>
          <button
            aria-label="Close pane picker"
            className="fixed inset-0 z-10"
            onClick={() => setPickerMode(null)}
            type="button"
          />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-48 rounded-xl border border-[#3a3a44] bg-[#28282f] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.5)]">
            <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-[#8a8a96]">
              {pickerLabel}
            </p>
            {viewOptions.map((view) => {
              const Icon = view.icon

              return (
                <button
                  className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-[#e4e4e8] transition-colors hover:bg-primary/12 hover:text-white"
                  key={view.type}
                  onClick={() => {
                    onSplitPane(paneId, pickerMode, view.type)
                    setPickerMode(null)
                  }}
                  type="button"
                >
                  <Icon className="size-3.5 text-[#b0b0bc]" />
                  <span>{view.defaultMetadata.type}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

function PaneTabBar({
  activeViewIndex,
  onRemoveView,
  onSwitchView,
  viewIds,
}: {
  readonly activeViewIndex: number
  readonly onRemoveView: (viewIndex: number) => void
  readonly onSwitchView: (viewIndex: number) => void
  readonly viewIds: readonly string[]
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-1 pb-1">
      {viewIds.map((viewId, index) => {
        const { metadata, resolvedType } = createFallbackPaneMetadata(viewId)
        const entry = resolvedType ? getPaneCatalogEntry(resolvedType) : null
        const isActive = index === activeViewIndex
        const Icon = entry?.icon

        return (
          <button
            className={cn(
              'group/tab flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-foreground'
                : 'text-muted-foreground hover:bg-surface-secondary hover:text-foreground',
            )}
            key={viewId}
            onClick={() => onSwitchView(index)}
            type="button"
          >
            {Icon ? <Icon className="size-3" /> : null}
            <span className="truncate">{metadata.type}</span>
            <button
              aria-label={`Close ${metadata.type} view`}
              className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/tab:opacity-100"
              onClick={(event) => {
                event.stopPropagation()
                onRemoveView(index)
              }}
              type="button"
            >
              <X className="size-2.5" />
            </button>
          </button>
        )
      })}
    </div>
  )
}

function renderLayoutNode(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  activePreviewTarget: PreviewTarget | null

  isInteractive: boolean
  node: PersistedLayoutNode
  nodeLookup: Map<string, PersistedLayoutNode>
  onAddView: (paneId: string, templateViewId: string) => void
  onClosePane: (paneId: string) => void
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onRemoveView: (paneId: string, viewIndex: number) => void
  onResizePane: (paneId: string, delta: number) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  onSelectPane: (paneId: string) => void
  onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  onSwitchView: (paneId: string, viewIndex: number) => void
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}) {
  if (args.node.type === 'pane') {
    const paneId = args.node.paneId
    const isActive = args.node.paneId === args.activePaneId
    const viewIds = args.node.viewIds
    const activeViewIndex = args.node.activeViewIndex
    const activeViewId = viewIds[activeViewIndex] ?? viewIds[0] ?? paneId

    return (
      <article
        className={`${getPaneFrameClassName(isActive)} group/pane relative cursor-pointer`}
        data-active-pane={isActive ? 'true' : 'false'}
        data-pane-id={paneId}
        key={args.node.id}
        onMouseDown={() => {
          if (args.isInteractive) {
            args.onSelectPane(paneId)
          }
        }}
      >
        {args.isInteractive ? (
          <PaneActionBar
            onClosePane={args.onClosePane}
            onResizePane={args.onResizePane}
            onSplitPane={args.onSplitPane}
            paneId={paneId}
          />
        ) : null}
        {viewIds.length > 1 ? (
          <PaneTabBar
            activeViewIndex={activeViewIndex}
            onRemoveView={(viewIndex) => args.onRemoveView(paneId, viewIndex)}
            onSwitchView={(viewIndex) => args.onSwitchView(paneId, viewIndex)}
            viewIds={viewIds}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[calc(theme(borderRadius.2xl)-1px)]">
          {resolvePaneContent({
            activePaneId: args.activePaneId,
            activeProject: args.activeProject,
            activePreviewTarget: args.activePreviewTarget,
            onClosePane: args.onClosePane,
            onLoadPreviewTarget: args.onLoadPreviewTarget,
            onSelectPreviewTarget: args.onSelectPreviewTarget,
            paneId: activeViewId,
            previewTargets: args.previewTargets,
            workspace: args.workspace,
          })}
        </div>
      </article>
    )
  }

  const resolvedChildren = args.node.children
    .map((childId, index) => {
      const childNode = args.nodeLookup.get(childId)

      if (!childNode) {
        return null
      }

      return {
        childId,
        node: childNode,
        weight: args.node.sizeWeights[index] ?? 1,
      }
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)

  if (resolvedChildren.length === 0) {
    return null
  }

  if (resolvedChildren.length === 1) {
    const only = resolvedChildren[0]
    if (!only) {
      return null
    }

    return (
      <div className="flex min-h-0 min-w-0 flex-1" key={args.node.id}>
        {renderLayoutNode({
          ...args,
          node: only.node,
        })}
      </div>
    )
  }

  return (
    <section
      className={cn(
        'flex min-h-0 min-w-0 flex-1 gap-4',
        args.node.type === 'split-horizontal' ? 'flex-row' : 'flex-col',
      )}
      key={args.node.id}
    >
      {resolvedChildren.map((entry) => (
        <div
          className="flex min-h-0 min-w-0"
          key={entry.childId}
          style={{
            flexBasis: 0,
            flexGrow: entry.weight,
            flexShrink: 1,
          }}
        >
          {renderLayoutNode({
            ...args,
            node: entry.node,
          })}
        </div>
      ))}
    </section>
  )
}

export default function WorkspaceCanvas({
  activePaneId,
  activeProject,
  activePreviewTarget,
  activeSurfaceId,
  activeWorkspace,
  actionError,
  onAddView,
  onCreateProject,
  onCreateWorkspace,
  onClosePane,
  onLoadPreviewTarget,
  onRemoveView,
  onResizePane,
  onSelectPreviewTarget,
  onSelectPane,
  onSplitPane,
  onSwitchView,
  previewTargets,
  projectWorkspaces,
  shellError,
  surfaceLayouts,
  workspaceLayouts,
  workspaceSurfaces,
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
  const surfaceSnapshot: PersistenceSnapshot = {
    databasePath: '',
    lastActivePaneIdsBySurface: {},
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveSurfaceIdsByWorkspace: {},
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: '',
    projects: [],
    schemaVersion: 0,
    surfaceLayouts,
    workspaceLayouts,
    workspaceSurfaces,
    workspaces: [],
  }
  const activePaneLabel =
    (activeWorkspace && activeSurfaceId
      ? resolveWorkspaceSurfaces(surfaceSnapshot, activeWorkspace.id).find(
          (surface) => surface.id === activeSurfaceId,
        )?.title
      : null) ??
    (activePaneId ? resolvePaneMetadata(activePaneId).label : null) ??
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
    <section className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-background">
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
      <div
        className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden p-4"
        data-testid="workspace-viewport"
      >
        <div
          className="workspace-slider flex min-h-0 min-w-0 w-full flex-1 flex-col items-stretch transition-transform duration-200 ease-out"
          style={workspaceTrackStyle}
        >
          {projectWorkspaces.map((workspace) => {
            const isActiveWorkspace = workspace.id === activeWorkspace.id
            const surfaces = resolveWorkspaceSurfaces(
              surfaceSnapshot,
              workspace.id,
            )
            const visibleSurfaceId = isActiveWorkspace
              ? activeSurfaceId
              : (surfaces[0]?.id ?? null)

            return (
              <section
                className="workspace-slide flex min-h-0 min-w-0 w-full shrink-0 flex-col overflow-hidden"
                data-active-workspace={isActiveWorkspace ? 'true' : 'false'}
                key={workspace.id}
                style={{ height: workspaceSlideHeight }}
              >
                <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                  {activeProject && surfaces.length > 0 ? (
                    <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                      {(() => {
                        const activeSurface =
                          surfaces.find(
                            (surface) => surface.id === visibleSurfaceId,
                          ) ?? surfaces[0]

                        if (!activeSurface) {
                          return null
                        }

                        const layout = resolveSurfaceLayout(
                          surfaceSnapshot,
                          workspace.id,
                          activeSurface.id,
                        )
                        const rootNode = resolveWorkspaceLayoutRoot(layout)
                        const paneCount =
                          collectWorkspaceLayoutPaneIds(layout).length
                        const nodeLookup = new Map(
                          layout?.nodes.map((node) => [node.id, node]),
                        )

                        return (
                          <div
                            className="flex min-h-0 min-w-0 w-full flex-1"
                            data-active-surface="true"
                            key={activeSurface.id}
                          >
                            {rootNode && paneCount > 0 ? (
                              renderLayoutNode({
                                activePaneId: isActiveWorkspace
                                  ? activePaneId
                                  : null,
                                activeProject,
                                activePreviewTarget: isActiveWorkspace
                                  ? activePreviewTarget
                                  : null,
                                isInteractive: isActiveWorkspace,
                                node: rootNode,
                                nodeLookup,
                                onAddView,
                                onClosePane,
                                onLoadPreviewTarget,
                                onRemoveView,
                                onResizePane,
                                onSelectPreviewTarget,
                                onSelectPane,
                                onSplitPane,
                                onSwitchView,
                                previewTargets: isActiveWorkspace
                                  ? previewTargets
                                  : [],
                                workspace,
                              })
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-2xl border border-destructive/30 bg-card text-sm text-muted-foreground">
                                Surface layout is missing a valid root node.
                              </div>
                            )}
                          </div>
                        )
                      })()}
                    </div>
                  ) : activeProject ? (
                    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-border/70 bg-card/60 p-8 text-center">
                      <div className="max-w-md space-y-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Empty workspace
                        </p>
                        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                          {workspace.name} starts blank
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Add a pane to create the first full-size destination
                          in this workspace. Split actions only apply inside an
                          existing destination.
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
