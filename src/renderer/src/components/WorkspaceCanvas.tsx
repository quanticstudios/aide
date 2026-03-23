import { FolderOpen, GitBranch, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { getWorkspaceScene } from '@/lib/navigation-poc'
import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface WorkspaceCanvasProps {
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly shellError: string | null
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
}

const paneAccentClassNames = {
  amber:
    'border-amber-400/30 bg-amber-500/5 shadow-[inset_0_1px_0_rgba(251,191,36,0.08)]',
  blue: 'border-blue-400/30 bg-blue-500/5 shadow-[inset_0_1px_0_rgba(96,165,250,0.08)]',
  emerald:
    'border-emerald-400/30 bg-emerald-500/5 shadow-[inset_0_1px_0_rgba(52,211,153,0.08)]',
  rose: 'border-rose-400/30 bg-rose-500/5 shadow-[inset_0_1px_0_rgba(251,113,133,0.08)]',
  violet:
    'border-violet-400/30 bg-violet-500/5 shadow-[inset_0_1px_0_rgba(167,139,250,0.08)]',
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
  activeProject,
  activeWorkspace,
  isDemoMode,
  shellError,
  onCreateProject,
  onCreateWorkspace,
}: WorkspaceCanvasProps) {
  const workspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)

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
    <section className="flex h-full flex-col bg-background">
      <header className="border-b border-border bg-card px-6 py-5 shadow-[0_1px_3px_rgba(0,0,0,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
              Active workspace
            </p>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {activeWorkspace.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeProject.name}
              </p>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              {workspaceScene.description}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isDemoMode ? (
              <Badge
                className="gap-1.5 font-mono text-[11px]"
                variant="outline"
              >
                Demo data
              </Badge>
            ) : null}
            <Badge
              className="gap-1.5 font-mono text-[11px]"
              variant="secondary"
            >
              <GitBranch className="size-3" />
              {activeWorkspace.branchName}
            </Badge>
            {!isDemoMode ? (
              <Button
                onClick={onCreateWorkspace}
                size="sm"
                type="button"
                variant="ghost"
              >
                <Plus className="size-4" />
                New workspace
              </Button>
            ) : null}
          </div>
        </div>

        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {activeWorkspace.worktreePath}
        </p>
      </header>

      <div className="flex flex-1 flex-col overflow-hidden p-6">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-primary">
              Navigation first
            </p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">
              {workspaceScene.headline}
            </h2>
          </div>

          <p className="max-w-md text-right text-xs leading-5 text-muted-foreground">
            The panes are placeholders. The point of this POC is that moving
            between workspaces feels spatial and immediate.
          </p>
        </div>

        <div className="grid flex-1 auto-rows-[minmax(8rem,1fr)] grid-cols-1 gap-4 overflow-auto lg:grid-cols-12">
          {workspaceScene.panes.map((pane) => (
            <article
              className={cn(
                'flex min-h-32 flex-col justify-between rounded-2xl border p-4',
                paneAccentClassNames[pane.accent],
                pane.layoutClassName,
              )}
              key={pane.id}
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <Badge
                    className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.18em]"
                    variant="secondary"
                  >
                    {pane.type}
                  </Badge>
                  <span className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Placeholder
                  </span>
                </div>

                <div>
                  <h3 className="text-lg font-semibold tracking-tight">
                    {pane.label}
                  </h3>
                  <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                    {pane.description}
                  </p>
                </div>
              </div>

              <div className="mt-6 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                <span className="size-2 rounded-full bg-foreground/30" />
                Workspace-owned surface
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  )
}
