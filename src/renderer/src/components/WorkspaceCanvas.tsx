import { FolderOpen, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getWorkspaceScene, resolveWorkspacePaneId } from '@/lib/navigation-poc'
import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
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
        <Button onClick={onAction} size="sm" type="button">
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
  shellError,
}: WorkspaceCanvasProps) {
  const workspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)
  const resolvedPaneId = resolveWorkspacePaneId(
    activeWorkspace?.id ?? null,
    activePaneId,
  )
  const activePaneIndex = Math.max(
    workspaceScene.panes.findIndex((pane) => pane.id === resolvedPaneId),
    0,
  )

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
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="pane-slider-track flex h-full min-h-0 w-full transition-transform duration-200 ease-out"
          style={{ transform: `translateX(-${activePaneIndex * 100}%)` }}
        >
          {workspaceScene.panes.map((pane, index) => {
            const isActive = pane.id === resolvedPaneId

            return (
              <article
                className="pane-slide h-full min-h-0 min-w-full flex-[0_0_100%] p-4"
                key={pane.id}
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
                      <Badge
                        className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.18em]"
                        variant="secondary"
                      >
                        {pane.type}
                      </Badge>
                      <span className="rounded-full border border-border/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {index + 1}
                      </span>
                    </div>

                    <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      {isActive ? 'Focused pane' : 'Pane'}
                    </span>
                  </div>

                  <div className="mt-6 flex min-h-0 flex-1 flex-col">
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

                    <div className="mt-5 grid gap-2 text-sm text-muted-foreground">
                      <div className="rounded-xl border border-border/60 bg-background/25 px-3 py-2">
                        {workspaceScene.headline}
                      </div>
                      <div className="rounded-xl border border-border/60 bg-background/25 px-3 py-2 font-mono text-xs">
                        {activeWorkspace.worktreePath}
                      </div>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-4 pt-6 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                      <span className="truncate">{activeWorkspace.name}</span>
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
}
