import { Button, Kbd, Toolbar } from '@heroui/react'
import { GitBranch, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'

interface TopBarProps {
  readonly activeSurfaceId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onCreatePane: () => void
  readonly surfaces: readonly WorkspaceSurfaceRecord[]
  readonly onSelectPane: (paneId: string) => void
}

export default function TopBar({
  activeSurfaceId,
  activeProject,
  activeWorkspace,
  onCreatePane,
  surfaces,
  onSelectPane,
}: TopBarProps) {
  const visibleSurfaces = surfaces

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

        <div className="min-w-0 flex-1 overflow-x-auto">
          <Toolbar
            aria-label="Pane selector"
            className="workspace-strip inline-flex min-w-max rounded-xl border border-border/80 bg-surface/80 p-1"
            isAttached
          >
            {visibleSurfaces.map((surface, index) => {
              const isActive = surface.id === activeSurfaceId

              return (
                <Button
                  aria-label={surface.title}
                  className={cn(
                    'workspace-strip-item h-8 shrink-0 rounded-lg px-2.5 text-left text-[12px] font-medium transition-all',
                    isActive
                      ? 'border-primary/60 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                      : 'border-transparent bg-transparent text-muted-foreground hover:border-primary/25 hover:bg-surface-secondary hover:text-foreground',
                  )}
                  key={surface.id}
                  onMouseDown={(event) => {
                    event.preventDefault()
                  }}
                  onPress={() => onSelectPane(surface.id)}
                  variant={isActive ? 'secondary' : 'ghost'}
                >
                  <span className="grid size-5 place-items-center rounded-full border border-border/80 bg-background text-[10px] font-medium leading-none text-muted-foreground">
                    {index + 1}
                  </span>
                  <span>{surface.title}</span>
                </Button>
              )
            })}

            {activeWorkspace ? (
              <Button
                aria-label="Add pane"
                className="size-8 shrink-0 rounded-lg"
                isIconOnly
                onPress={onCreatePane}
                size="sm"
                variant="ghost"
              >
                <Plus className="size-4" />
              </Button>
            ) : null}
          </Toolbar>
        </div>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
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
