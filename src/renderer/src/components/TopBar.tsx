import { Button, Chip, Kbd, Tooltip } from '@heroui/react'
import { GitBranch, Plus } from 'lucide-react'

import { getWorkspaceScene, resolveWorkspacePaneId } from '@/lib/navigation-poc'
import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface TopBarProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly onSelectPane: (paneId: string) => void
  readonly onCreateWorkspace: () => void
}

export default function TopBar({
  activePaneId,
  activeProject,
  activeWorkspace,
  isDemoMode,
  onSelectPane,
  onCreateWorkspace,
}: TopBarProps) {
  const workspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)
  const resolvedPaneId = resolveWorkspacePaneId(
    activeWorkspace?.id ?? null,
    activePaneId,
  )

  return (
    <header className="border-b border-border bg-background/95 px-3 py-2 backdrop-blur">
      <div className="flex items-center gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card px-2 py-1">
          <p className="max-w-[7rem] truncate text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {activeWorkspace?.name ?? activeProject?.name ?? 'No workspace'}
          </p>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <GitBranch className="size-3.5" />
            <span>
              {activeWorkspace?.branchName ??
                activeProject?.defaultBranch ??
                'Waiting'}
            </span>
          </div>
        </div>

        <nav className="workspace-strip flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
          {workspaceScene.panes.map((pane, index) => {
            const isActive = pane.id === resolvedPaneId

            return (
              <Tooltip delay={120} key={pane.id}>
                <Tooltip.Trigger>
                  <button
                    className={cn(
                      'workspace-strip-item group flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all',
                      isActive
                        ? 'border-primary/60 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                        : 'border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground',
                    )}
                    onClick={() => onSelectPane(pane.id)}
                    type="button"
                  >
                    <Chip
                      className="h-5 min-w-5 border border-border bg-background px-0 text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                      color="default"
                      size="sm"
                      variant="secondary"
                    >
                      {index + 1}
                    </Chip>
                    <span className="text-[12px] font-medium leading-none">
                      {pane.type}
                    </span>
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content className="rounded-xl border border-border bg-overlay/98 px-2.5 py-1.5 text-xs text-foreground shadow-[var(--overlay-shadow)]">
                  {pane.label}
                </Tooltip.Content>
              </Tooltip>
            )
          })}

          {activeProject && !isDemoMode ? (
            <Button
              className="size-8 shrink-0 rounded-lg"
              isIconOnly
              onPress={onCreateWorkspace}
              size="sm"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {isDemoMode ? (
            <Chip
              className="text-[10px] uppercase tracking-[0.18em]"
              color="default"
              size="sm"
              variant="secondary"
            >
              Demo
            </Chip>
          ) : null}

          <div className="flex items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              H
            </Kbd>
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              L
            </Kbd>
          </div>
        </div>
      </div>
    </header>
  )
}
