import { Button } from '@heroui/react'
import { FolderOpen, Plus, X } from 'lucide-react'
import { useMemo } from 'react'
import { getPaneSlideWidth, getPaneTrackStyle } from '@/lib/pane-camera'
import {
  createFallbackPaneMetadata,
  getPaneCatalogEntry,
  getPaneCatalogEntryForTemplate,
  getPaneTemplateId,
  resolvePaneMetadata,
} from '@/lib/pane-catalog'
import { getPaneFrameClassName } from '@/lib/pane-frame'
import { createFallbackPane, renderPaneFromRegistry } from '@/lib/pane-registry'
import { getSessionStateDotClass } from '@/lib/session-state-dot'
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
  PersistenceSnapshot,
  ProjectRecord,
  SurfaceLayoutRecord,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../../../shared/preview'
import { useManagedSessionState } from '../hooks/useManagedSessionState'
import type {
  PreviewBrowserControl,
  PreviewPresentation,
} from './PreviewBrowserHost'

interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeSurfaceId: string | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly actionError: string | null
  readonly onAddView: (paneId: string, templateViewId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onClosePane: (paneId: string) => void
  readonly onOpenJevSettings: (trigger: HTMLElement) => void
  readonly onPreviewBrowserControl: (control: PreviewBrowserControl) => void
  readonly onPreviewCloseTab: (
    workspace: WorkspaceRecord,
    tabId: string,
  ) => void
  readonly onPreviewNavigate: (
    workspace: WorkspaceRecord,
    tabId: string,
    url: string,
  ) => void
  readonly onPreviewOpenTab: (workspace: WorkspaceRecord, url: string) => void
  readonly onPreviewPresentationChange: (
    presentation: PreviewPresentation | null,
  ) => void
  readonly onPreviewSelectTab: (
    workspace: WorkspaceRecord,
    tabId: string,
  ) => void
  readonly allWorkspaces: readonly WorkspaceRecord[]
  readonly projects: readonly ProjectRecord[]
  readonly onRemoveView: (paneId: string, viewIndex: number) => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSwitchView: (paneId: string, viewIndex: number) => void
  readonly previewSnapshot: WorkspacePreviewSnapshot | null
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
        <div className="rounded-full border border-border bg-surface p-4 text-muted-foreground">
          <FolderOpen className="size-6" />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Navigation shell
          </p>
          <h1 className="text-2xl font-semibold tracking-[-0.374px]">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {error ? (
          <div className="w-full rounded-md border border-accent-red bg-accent-red-soft px-4 py-3 text-sm text-accent-red">
            {error}
          </div>
        ) : null}
        <Button
          className="rounded-pill px-[22px] py-[11px]"
          onPress={onAction}
          variant="primary"
        >
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
  onClosePane: (paneId: string) => void
  onOpenJevSettings: (trigger: HTMLElement) => void
  onPreviewBrowserControl: (control: PreviewBrowserControl) => void
  onPreviewCloseTab: (workspace: WorkspaceRecord, tabId: string) => void
  onPreviewNavigate: (
    workspace: WorkspaceRecord,
    tabId: string,
    url: string,
  ) => void
  onPreviewOpenTab: (workspace: WorkspaceRecord, url: string) => void
  onPreviewPresentationChange: (
    presentation: PreviewPresentation | null,
  ) => void
  onPreviewSelectTab: (workspace: WorkspaceRecord, tabId: string) => void
  paneId: string
  previewSnapshot: WorkspacePreviewSnapshot | null
  workspace: WorkspaceRecord
}) {
  const pane = createFallbackPane(args.paneId)

  return renderPaneFromRegistry({
    activePaneId: args.activePaneId,
    onClosePane: args.onClosePane,
    onOpenJevSettings: args.onOpenJevSettings,
    onPreviewBrowserControl: args.onPreviewBrowserControl,
    onPreviewCloseTab: args.onPreviewCloseTab,
    onPreviewNavigate: args.onPreviewNavigate,
    onPreviewOpenTab: args.onPreviewOpenTab,
    onPreviewPresentationChange: args.onPreviewPresentationChange,
    onPreviewSelectTab: args.onPreviewSelectTab,
    pane,
    project: args.activeProject,
    previewSnapshot: args.previewSnapshot,
    workspace: args.workspace,
  })
}

function PaneTab({
  isActive,
  onRemove,
  onSwitch,
  viewId,
  workspaceId,
}: {
  readonly isActive: boolean
  readonly onRemove: () => void
  readonly onSwitch: () => void
  readonly viewId: string
  readonly workspaceId: string
}) {
  const { metadata, resolvedType } = createFallbackPaneMetadata(viewId)
  const entry = resolvedType ? getPaneCatalogEntry(resolvedType) : null
  const Icon = entry?.icon

  const templateId = getPaneTemplateId(viewId)
  const templateEntry = getPaneCatalogEntryForTemplate(templateId)
  const isManagedPane =
    templateEntry?.terminalMode === 'agent' ||
    templateEntry?.terminalMode === 'claude' ||
    templateEntry?.terminalMode === 'codex'

  const sessionId = useMemo(
    () => (isManagedPane ? `${workspaceId}:${viewId}` : null),
    [isManagedPane, viewId, workspaceId],
  )
  const sessionState = useManagedSessionState(sessionId)
  return (
    <div
      className={cn(
        'group/tab flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold transition-colors',
        isActive
          ? 'bg-surface-elevated text-foreground'
          : 'text-muted-foreground hover:bg-surface-secondary hover:text-foreground',
      )}
    >
      <button
        aria-current={isActive ? 'page' : undefined}
        className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        onClick={onSwitch}
        type="button"
      >
        {Icon ? <Icon className="size-3" /> : null}
        <span className="truncate">{metadata.type}</span>
        {isManagedPane ? (
          <span
            className={`size-2 rounded-full ${getSessionStateDotClass(sessionState)}`}
          />
        ) : null}
      </button>
      <button
        aria-label={`Close ${metadata.type} view`}
        className="ml-0.5 rounded p-0.5 opacity-0 transition-opacity hover:bg-destructive/15 hover:text-destructive group-hover/tab:opacity-100"
        onClick={onRemove}
        type="button"
      >
        <X className="size-2.5" />
      </button>
    </div>
  )
}

function PaneTabBar({
  activeViewIndex,
  onRemoveView,
  onSwitchView,
  viewIds,
  workspaceId,
}: {
  readonly activeViewIndex: number
  readonly onRemoveView: (viewIndex: number) => void
  readonly onSwitchView: (viewIndex: number) => void
  readonly viewIds: readonly string[]
  readonly workspaceId: string
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto px-1 pb-1">
      {viewIds.map((viewId, index) => (
        <PaneTab
          isActive={index === activeViewIndex}
          key={viewId}
          onRemove={() => onRemoveView(index)}
          onSwitch={() => onSwitchView(index)}
          viewId={viewId}
          workspaceId={workspaceId}
        />
      ))}
    </div>
  )
}

function renderLayoutNode(args: {
  activePaneId: string | null
  activeProject: ProjectRecord
  isInteractive: boolean
  isSolePane?: boolean
  node: PersistedLayoutNode
  nodeLookup: Map<string, PersistedLayoutNode>
  onAddView: (paneId: string, templateViewId: string) => void
  onClosePane: (paneId: string) => void
  onOpenJevSettings: (trigger: HTMLElement) => void
  onRemoveView: (paneId: string, viewIndex: number) => void
  onPreviewBrowserControl: (control: PreviewBrowserControl) => void
  onPreviewCloseTab: (workspace: WorkspaceRecord, tabId: string) => void
  onPreviewNavigate: (
    workspace: WorkspaceRecord,
    tabId: string,
    url: string,
  ) => void
  onPreviewOpenTab: (workspace: WorkspaceRecord, url: string) => void
  onPreviewPresentationChange: (
    presentation: PreviewPresentation | null,
  ) => void
  onPreviewSelectTab: (workspace: WorkspaceRecord, tabId: string) => void
  onSelectPane: (paneId: string) => void
  onSwitchView: (paneId: string, viewIndex: number) => void
  previewSnapshot: WorkspacePreviewSnapshot | null
  workspace: WorkspaceRecord
}) {
  if (args.node.type === 'pane') {
    const paneId = args.node.paneId
    const isActive = args.node.paneId === args.activePaneId
    const viewIds = args.node.viewIds
    const activeViewIndex = args.node.activeViewIndex
    const activeViewId = viewIds[activeViewIndex] ?? viewIds[0] ?? paneId

    const isSolePane = args.isSolePane ?? false

    return (
      <article
        className={`${getPaneFrameClassName(isActive, isSolePane)} relative cursor-pointer`}
        data-active-pane={isActive ? 'true' : 'false'}
        data-pane-id={paneId}
        key={args.node.id}
        onMouseDown={() => {
          if (args.isInteractive) {
            args.onSelectPane(paneId)
          }
        }}
      >
        {viewIds.length > 1 ? (
          <PaneTabBar
            activeViewIndex={activeViewIndex}
            onRemoveView={(viewIndex) => args.onRemoveView(paneId, viewIndex)}
            onSwitchView={(viewIndex) => args.onSwitchView(paneId, viewIndex)}
            viewIds={viewIds}
            workspaceId={args.workspace.id}
          />
        ) : null}
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-[calc(theme(borderRadius.lg)-1px)]">
          {resolvePaneContent({
            activePaneId: isActive ? activeViewId : null,
            activeProject: args.activeProject,
            onClosePane: args.onClosePane,
            onOpenJevSettings: args.onOpenJevSettings,
            onPreviewBrowserControl: args.onPreviewBrowserControl,
            onPreviewCloseTab: args.onPreviewCloseTab,
            onPreviewNavigate: args.onPreviewNavigate,
            onPreviewOpenTab: args.onPreviewOpenTab,
            onPreviewPresentationChange: args.onPreviewPresentationChange,
            onPreviewSelectTab: args.onPreviewSelectTab,
            paneId: activeViewId,
            previewSnapshot: args.previewSnapshot,
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
  activeSurfaceId,
  activeWorkspace,
  actionError,
  onAddView,
  onCreateProject,
  onCreateWorkspace,
  onClosePane,
  onOpenJevSettings,
  onRemoveView,
  onPreviewBrowserControl,
  onPreviewCloseTab,
  onPreviewNavigate,
  onPreviewOpenTab,
  onPreviewPresentationChange,
  onPreviewSelectTab,
  onSelectPane,
  onSwitchView,
  previewSnapshot,
  allWorkspaces,
  projects,
  shellError,
  surfaceLayouts,
  workspaceLayouts,
  workspaceSurfaces,
}: WorkspaceCanvasProps) {
  const workspaceCount = Math.max(allWorkspaces.length, 1)
  const activeWorkspaceIndex = Math.max(
    allWorkspaces.findIndex(
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
    catalogRevision: 0,
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
    workspaceLayoutRevisions: {},
    workspaceLayouts,
    workspaceSurfaces,
    workspaceSurfaceRevisions: {},
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
        <div className="max-w-xl rounded-lg border border-accent-red bg-accent-red-soft p-6 text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-accent-red">
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
        description="Open a folder to start working."
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
    <section className="flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-1">
      {actionError ? (
        <div className="px-4 pt-4">
          <div className="rounded-md border border-accent-red bg-accent-red-soft px-4 py-3 text-sm text-accent-red">
            {actionError}
          </div>
        </div>
      ) : null}
      <div className="sr-only">
        <span data-testid="active-workspace-name">{activeWorkspace.name}</span>
        <span data-testid="active-pane-name">{activePaneLabel}</span>
      </div>
      <div
        className="relative flex min-h-0 min-w-0 w-full flex-1 overflow-hidden"
        data-testid="workspace-viewport"
      >
        {allWorkspaces.length > 1 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-1/2 z-10 flex -translate-y-1/2 flex-col items-center gap-1.5"
            data-testid="workspace-stack-indicator"
          >
            {allWorkspaces.map((workspace, index) => {
              const isActive = index === activeWorkspaceIndex
              return (
                <span
                  className={cn(
                    'size-1.5 rounded-full bg-[var(--border-strong)] transition-colors duration-200',
                    isActive && 'bg-primary',
                  )}
                  data-active={isActive ? 'true' : 'false'}
                  data-testid={`workspace-stack-dot-${workspace.id}`}
                  key={workspace.id}
                />
              )
            })}
          </div>
        ) : null}
        <div
          className="workspace-slider flex min-h-0 min-w-0 w-full flex-1 flex-col items-stretch transition-transform duration-200 ease-[var(--ease-out-strong)]"
          style={workspaceTrackStyle}
        >
          {allWorkspaces.map((workspace) => {
            const isActiveWorkspace = workspace.id === activeWorkspace.id
            const workspaceProject =
              workspace.projectId === activeProject?.id
                ? activeProject
                : (projects.find((p) => p.id === workspace.projectId) ?? null)
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
                  {workspaceProject && surfaces.length > 0 ? (
                    (() => {
                      const surfaceCount = surfaces.length
                      const activeSurfaceIndex = Math.max(
                        surfaces.findIndex(
                          (surface) => surface.id === visibleSurfaceId,
                        ),
                        0,
                      )
                      const surfaceTrackStyle = getPaneTrackStyle(
                        surfaceCount,
                        activeSurfaceIndex,
                      )
                      const surfaceSlideWidth = getPaneSlideWidth(surfaceCount)

                      return (
                        <div className="flex min-h-0 min-w-0 w-full flex-1 overflow-hidden">
                          <div
                            className="surface-slider flex h-full shrink-0 transition-transform duration-200 ease-[var(--ease-out-strong)]"
                            style={surfaceTrackStyle}
                          >
                            {surfaces.map((surface, surfaceIndex) => {
                              const isActiveSurface =
                                surfaceIndex === activeSurfaceIndex
                              const isInteractiveSurface =
                                isActiveWorkspace && isActiveSurface
                              const layout = resolveSurfaceLayout(
                                surfaceSnapshot,
                                workspace.id,
                                surface.id,
                              )
                              const rootNode =
                                resolveWorkspaceLayoutRoot(layout)
                              const paneCount =
                                collectWorkspaceLayoutPaneIds(layout).length
                              const nodeLookup = new Map(
                                layout?.nodes.map((node) => [node.id, node]),
                              )

                              return (
                                <div
                                  className="flex min-h-0 min-w-0 h-full shrink-0 overflow-hidden"
                                  data-active-surface={
                                    isActiveSurface ? 'true' : 'false'
                                  }
                                  key={surface.id}
                                  style={{ width: surfaceSlideWidth }}
                                >
                                  {rootNode && paneCount > 0 ? (
                                    renderLayoutNode({
                                      activePaneId: isInteractiveSurface
                                        ? activePaneId
                                        : null,
                                      activeProject: workspaceProject,
                                      isInteractive: isInteractiveSurface,
                                      isSolePane: rootNode.type === 'pane',
                                      node: rootNode,
                                      nodeLookup,
                                      onAddView,
                                      onClosePane,
                                      onOpenJevSettings,
                                      onRemoveView,
                                      onPreviewBrowserControl,
                                      onPreviewCloseTab,
                                      onPreviewNavigate,
                                      onPreviewOpenTab,
                                      onPreviewPresentationChange,
                                      onPreviewSelectTab,
                                      onSelectPane,
                                      onSwitchView,
                                      previewSnapshot: isInteractiveSurface
                                        ? previewSnapshot
                                        : null,
                                      workspace,
                                    })
                                  ) : (
                                    <div className="flex h-full w-full items-center justify-center rounded-lg border border-accent-red bg-accent-red-soft text-sm text-muted-foreground">
                                      Surface layout is missing a valid root
                                      node.
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()
                  ) : workspaceProject ? (
                    <div className="flex h-full w-full items-center justify-center rounded-lg border border-border bg-surface p-8 text-center">
                      <div className="max-w-md space-y-3">
                        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                          Empty workspace
                        </p>
                        <h2 className="text-2xl font-semibold tracking-[-0.374px] text-foreground">
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
                    <div className="flex h-full w-full items-center justify-center rounded-lg border border-accent-red bg-accent-red-soft text-sm text-muted-foreground">
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
