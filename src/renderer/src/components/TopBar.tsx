import { GitBranch, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
              <button
                className={cn(
                  'workspace-strip-item group flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-all',
                  isActive
                    ? 'border-primary/60 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                    : 'border-border bg-card text-muted-foreground hover:border-primary/35 hover:text-foreground',
                )}
                key={pane.id}
                onClick={() => onSelectPane(pane.id)}
                type="button"
              >
                <span className="rounded-full border border-border px-1.5 py-0 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="text-[12px] font-medium leading-none">
                  {pane.type}
                </span>
              </button>
            )
          })}

          {activeProject && !isDemoMode ? (
            <Button
              className="size-8 shrink-0 rounded-lg"
              onClick={onCreateWorkspace}
              size="icon"
              title="Create workspace"
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
          ) : null}
        </nav>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          {isDemoMode ? (
            <Badge
              className="text-[10px] uppercase tracking-[0.18em]"
              variant="outline"
            >
              Demo
            </Badge>
          ) : null}

          <div className="rounded-full border border-border px-3 py-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
            Pane H/L
          </div>
        </div>
      </div>
    </header>
  )
}
