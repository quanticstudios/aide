import { Surface } from '@heroui/react'
import { ArrowDown, ArrowUp } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { WorkspaceRecord } from '../../../shared/persistence'

interface WorkspaceSwitcherOverlayProps {
  readonly activeWorkspaceId: string | null
  readonly projectName: string | null
  readonly visible: boolean
  readonly workspaces: readonly WorkspaceRecord[]
}

export default function WorkspaceSwitcherOverlay({
  activeWorkspaceId,
  projectName,
  visible,
  workspaces,
}: WorkspaceSwitcherOverlayProps) {
  if (workspaces.length === 0) {
    return null
  }

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'pointer-events-none absolute right-4 top-1/2 z-20 w-72 -translate-y-1/2 transform-gpu origin-center will-change-[transform,opacity] transition-[opacity,transform] duration-120 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
        visible
          ? 'scale-100 opacity-100'
          : 'translate-x-3 -translate-y-1/2 scale-[0.98] opacity-0',
      )}
    >
      <Surface
        className="rounded-2xl border border-border/90 bg-overlay/98 p-3 shadow-[var(--overlay-shadow)]"
        variant="secondary"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Workspace switcher
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {projectName ?? 'Current project'}
            </p>
          </div>

          <div className="flex items-center gap-1 rounded-full border border-border px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <ArrowUp className="size-3" />
            k
            <ArrowDown className="ml-1 size-3" />j
          </div>
        </div>

        <div className="space-y-1">
          {workspaces.map((workspace, index) => {
            const isActive = workspace.id === activeWorkspaceId

            return (
              <div
                className={cn(
                  'flex items-center justify-between rounded-xl border px-3 py-2 transition-all',
                  isActive
                    ? 'border-primary/60 bg-surface-tertiary text-foreground shadow-[var(--surface-shadow)]'
                    : 'border-border/80 bg-surface text-muted-foreground',
                )}
                key={workspace.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {workspace.name}
                  </p>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
                    {workspace.branchName}
                  </p>
                </div>

                <span className="ml-3 shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                  {index + 1}
                </span>
              </div>
            )
          })}
        </div>
      </Surface>
    </div>
  )
}
