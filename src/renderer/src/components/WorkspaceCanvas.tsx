import { FolderOpen, GitBranch, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface WorkspaceCanvasProps {
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly shellError: string | null
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
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
  shellError,
  onCreateProject,
  onCreateWorkspace,
}: WorkspaceCanvasProps) {
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
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className="gap-1.5 font-mono text-[11px]"
              variant="secondary"
            >
              <GitBranch className="size-3" />
              {activeWorkspace.branchName}
            </Badge>
            <Button
              onClick={onCreateWorkspace}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
              New workspace
            </Button>
          </div>
        </div>

        <p className="mt-3 font-mono text-xs text-muted-foreground">
          {activeWorkspace.worktreePath}
        </p>
      </header>

      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-2xl text-center">
          <p className="text-xs uppercase tracking-[0.2em] text-primary">
            Navigation first
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">
            This workspace owns the full main region.
          </h2>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            The shell is now centered on project and workspace movement. Pane
            composition, richer tool surfaces, and deeper interactions land
            after the navigation model feels obvious and fast.
          </p>
        </div>
      </div>
    </section>
  )
}
