import { Chip, Surface } from '@heroui/react'
import { ArrowRight, FolderTree, GitBranch, Sparkles } from 'lucide-react'

import type { ResolvedPaneMetadata } from '@/lib/pane-catalog'
import {
  getPlaceholderActionsForPane,
  getPlaceholderBadgesForPane,
} from '@/lib/workspace-placeholder'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface PlaceholderWorkspaceViewProps {
  readonly pane: ResolvedPaneMetadata
  readonly project: ProjectRecord
  readonly workspace: WorkspaceRecord
}

export default function PlaceholderWorkspaceView({
  pane,
  project,
  workspace,
}: PlaceholderWorkspaceViewProps) {
  const actions = getPlaceholderActionsForPane(pane)
  const badges = getPlaceholderBadgesForPane(pane)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div>
        <div className="flex items-center gap-2">
          {badges.map((badge) => (
            <Chip key={badge} size="sm" variant="secondary">
              {badge}
            </Chip>
          ))}
        </div>

        <h2 className="mt-4 text-2xl font-semibold tracking-tight text-foreground lg:text-3xl">
          {pane.label}
        </h2>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
          {pane.description}
        </p>
      </div>

      <div className="mt-6 grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <Surface
          className="flex min-h-0 flex-col rounded-2xl border border-border/60 p-5"
          variant="secondary"
        >
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Sparkles className="size-3.5" />
            Next actions for this workspace
          </div>

          <div className="mt-5 grid gap-3">
            {actions.map((action) => (
              <Surface
                className="rounded-2xl border border-border/60 p-4"
                key={action.title}
                variant="tertiary"
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border border-border/60 bg-background/60 p-1.5 text-muted-foreground">
                    <ArrowRight className="size-3.5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {action.title}
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      {action.description}
                    </p>
                  </div>
                </div>
              </Surface>
            ))}
          </div>
        </Surface>

        <div className="flex min-h-0 flex-col gap-3">
          <Surface
            className="rounded-2xl border border-border/60 p-4"
            variant="tertiary"
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <FolderTree className="size-3.5" />
              Workspace context
            </div>
            <div className="mt-4 space-y-3 text-sm text-muted-foreground">
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                  Project
                </p>
                <p className="mt-1 text-foreground">{project.name}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                  Workspace
                </p>
                <p className="mt-1 text-foreground">{workspace.name}</p>
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">
                  Worktree
                </p>
                <p className="mt-1 break-all font-mono text-xs">
                  {workspace.worktreePath}
                </p>
              </div>
            </div>
          </Surface>

          <Surface
            className="rounded-2xl border border-border/60 p-4"
            variant="secondary"
          >
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              <GitBranch className="size-3.5" />
              Branch focus
            </div>
            <p className="mt-3 font-mono text-xs text-muted-foreground">
              {workspace.branchName}
            </p>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {pane.description}
            </p>
          </Surface>
        </div>
      </div>
    </div>
  )
}
