import { Button, Chip, ScrollShadow, Surface } from '@heroui/react'
import { FolderOpen, Plus } from 'lucide-react'

import { getWorkspaceScene, resolveWorkspacePaneId } from '@/lib/navigation-poc'
import { getPaneSlideWidth, getPaneTrackStyle } from '@/lib/pane-camera'
import { cn } from '@/lib/utils'
import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from '@/lib/workspace-camera'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
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
}

const paneAccentClassNames = {
  amber:
    'border-amber-400/30 bg-amber-500/6 shadow-[inset_0_1px_0_rgba(251,191,36,0.08)]',
  blue: 'border-blue-400/30 bg-blue-500/6 shadow-[inset_0_1px_0_rgba(96,165,250,0.08)]',
  emerald:
    'border-emerald-400/30 bg-emerald-500/6 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)]',
  rose: 'border-rose-400/30 bg-rose-500/6 shadow-[inset_0_1px_0_rgba(251,113,133,0.08)]',
  violet:
    'border-violet-400/30 bg-violet-500/6 shadow-[inset_0_1px_0_rgba(167,139,250,0.08)]',
} as const

const paneViewSections = [
  'Primary workspace surface',
  'Focused context block',
  'Linked review target',
  'Next split candidate',
] as const

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

export default function WorkspaceCanvas({
  activePaneId,
  activeProject,
  activeWorkspace,
  onCreateProject,
  onCreateWorkspace,
  projectWorkspaces,
  shellError,
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
            const workspaceScene = getWorkspaceScene(workspace.id)
            const isActiveWorkspace = workspace.id === activeWorkspace.id
            const resolvedPaneId = resolveWorkspacePaneId(
              workspace.id,
              isActiveWorkspace ? activePaneId : null,
            )
            const paneCount = Math.max(workspaceScene.panes.length, 1)
            const activePaneIndex = Math.max(
              workspaceScene.panes.findIndex(
                (pane) => pane.id === resolvedPaneId,
              ),
              0,
            )
            const paneTrackStyle = getPaneTrackStyle(paneCount, activePaneIndex)
            const paneSlideWidth = getPaneSlideWidth(paneCount)

            return (
              <section
                className="workspace-slide flex min-h-0 shrink-0 flex-col overflow-hidden"
                key={workspace.id}
                style={{ height: workspaceSlideHeight }}
              >
                <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
                  <div
                    className="pane-slider-track flex min-h-0 shrink-0 items-stretch transition-transform duration-200 ease-out"
                    style={paneTrackStyle}
                  >
                    {workspaceScene.panes.map((pane, index) => {
                      const isActive = pane.id === resolvedPaneId

                      if (pane.type === 'Terminal') {
                        return (
                          <article
                            className="pane-slide flex h-full min-h-0 shrink-0 self-stretch p-4"
                            key={pane.id}
                            style={{ width: paneSlideWidth }}
                          >
                            {isActiveWorkspace && isActive ? (
                              <TerminalPane
                                paneId={pane.id}
                                workspace={workspace}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-xl border border-border/50 bg-[#0f131b] text-sm text-muted-foreground">
                                Terminal session hidden until this pane is
                                focused.
                              </div>
                            )}
                          </article>
                        )
                      }

                      return (
                        <article
                          className="pane-slide flex h-full min-h-0 shrink-0 self-stretch p-4"
                          key={pane.id}
                          style={{ width: paneSlideWidth }}
                        >
                          <div
                            className={cn(
                              'flex h-full min-h-0 flex-col overflow-hidden rounded-2xl p-5 text-left lg:p-6',
                              paneAccentClassNames[pane.accent],
                              isActive ? 'opacity-100' : 'opacity-86',
                            )}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2">
                                <Chip
                                  className="rounded-full px-2 text-[10px] uppercase tracking-[0.18em]"
                                  color="default"
                                  size="sm"
                                  variant="secondary"
                                >
                                  {pane.type}
                                </Chip>
                                <span className="rounded-full border border-border/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                                  {index + 1}
                                </span>
                              </div>

                              <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                {isActive ? 'Focused pane' : 'Pane'}
                              </span>
                            </div>

                            <div className="mt-6 flex min-h-0 flex-1 flex-col">
                              {pane.type === 'Preview' &&
                              isActive &&
                              isActiveWorkspace ? (
                                <div className="mt-5 min-h-0 flex-1">
                                  <PreviewPane />
                                </div>
                              ) : (
                                <>
                                  <div>
                                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                      View
                                    </p>
                                    <h2 className="mt-2 text-2xl font-semibold tracking-tight text-foreground lg:text-3xl">
                                      {pane.label}
                                    </h2>
                                    <p className="mt-3 max-w-md text-sm leading-6 text-muted-foreground">
                                      {pane.description}
                                    </p>
                                  </div>

                                  <div className="mt-5 grid min-h-0 flex-1 gap-3 lg:grid-cols-[minmax(0,1fr)_18rem]">
                                    <Surface
                                      className="flex min-h-0 flex-col rounded-2xl border border-border/60 p-4"
                                      variant="secondary"
                                    >
                                      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                        Active view
                                      </p>
                                      <ScrollShadow
                                        className="mt-4 min-h-0 flex-1 rounded-xl border border-border/60 bg-surface-tertiary/70 p-4"
                                        hideScrollBar
                                        size={28}
                                      >
                                        <div className="space-y-3">
                                          {paneViewSections.map((section) => (
                                            <Surface
                                              className="rounded-xl border border-border/50 p-3"
                                              key={section}
                                              variant="tertiary"
                                            >
                                              <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">
                                                {section}
                                              </p>
                                              <p className="mt-2 text-sm text-foreground/90">
                                                {pane.label} stays inside the
                                                pane while navigation keeps the
                                                shell spatial and predictable.
                                              </p>
                                            </Surface>
                                          ))}
                                        </div>
                                      </ScrollShadow>
                                    </Surface>

                                    <div className="flex min-h-0 flex-col gap-3">
                                      <Surface
                                        className="rounded-2xl border border-border/60 p-4 text-sm text-muted-foreground"
                                        variant="tertiary"
                                      >
                                        {workspaceScene.headline}
                                      </Surface>
                                      <Surface
                                        className="rounded-2xl border border-border/60 p-4 font-mono text-xs text-muted-foreground"
                                        variant="secondary"
                                      >
                                        {workspace.worktreePath}
                                      </Surface>
                                      <Surface
                                        className="rounded-2xl border border-border/60 p-4"
                                        variant="secondary"
                                      >
                                        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                          Navigation
                                        </p>
                                        <div className="mt-3 flex flex-wrap gap-2">
                                          <Chip size="sm" variant="secondary">
                                            Pane H/L
                                          </Chip>
                                          <Chip size="sm" variant="secondary">
                                            Workspace Alt J/K
                                          </Chip>
                                        </div>
                                      </Surface>
                                    </div>
                                  </div>
                                </>
                              )}

                              <div className="mt-auto flex items-center justify-between gap-4 pt-6 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                                <span className="truncate">
                                  {workspace.name}
                                </span>
                                <span className="flex items-center gap-2">
                                  <span className="size-2 rounded-full bg-foreground/30" />
                                  {pane.type}
                                </span>
                              </div>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}
