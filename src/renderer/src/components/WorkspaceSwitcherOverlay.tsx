import { Chip, Description, Kbd, Label, ListBox, Surface } from '@heroui/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Key } from 'react'

import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type { WorkspaceRecord } from '../../../shared/persistence'

interface WorkspaceSwitcherOverlayProps {
  readonly activeWorkspaceId: string | null
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly projectName: string | null
  readonly summaries: Record<string, WorkspaceSummary>
  readonly visible: boolean
  readonly workspaces: readonly WorkspaceRecord[]
}

export default function WorkspaceSwitcherOverlay({
  activeWorkspaceId,
  onSelectWorkspace,
  projectName,
  summaries,
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
        'absolute right-4 top-1/2 z-20 w-72 -translate-y-1/2 transform-gpu origin-center will-change-[transform,opacity] transition-[opacity,transform] duration-120 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
        visible ? 'pointer-events-auto' : 'pointer-events-none',
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

          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            <ArrowUp className="size-3" />
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              K
            </Kbd>
            <ArrowDown className="ml-1 size-3" />
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              J
            </Kbd>
          </div>
        </div>

        <ListBox
          aria-label="Workspace switcher"
          className="space-y-1"
          onAction={(key: Key) => onSelectWorkspace(String(key))}
          selectedKeys={new Set(activeWorkspaceId ? [activeWorkspaceId] : [])}
          selectionMode="single"
        >
          {workspaces.map((workspace, index) => (
            <ListBox.Item
              className="rounded-xl border border-border/80 bg-surface px-3 py-2 text-muted-foreground transition-all data-[focused=true]:border-primary/45 data-[selected=true]:border-primary/60 data-[selected=true]:bg-surface-tertiary data-[selected=true]:text-foreground data-[selected=true]:shadow-[var(--surface-shadow)]"
              id={workspace.id}
              key={workspace.id}
              textValue={workspace.name}
            >
              {(() => {
                const summary = summaries[workspace.id]

                return (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Label className="truncate text-sm font-medium">
                        {summary?.workspaceName ?? workspace.name}
                      </Label>
                      <Description className="truncate font-mono text-[11px] text-muted-foreground">
                        {summary?.branchName ?? workspace.branchName}
                      </Description>
                    </div>

                    <Chip
                      className="ml-3 shrink-0 rounded-full border border-border px-2 text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
                      color="default"
                      size="sm"
                      variant="secondary"
                    >
                      {summary
                        ? `${summary.status} · ${summary.jobCount}`
                        : index + 1}
                    </Chip>
                  </div>
                )
              })()}
            </ListBox.Item>
          ))}
        </ListBox>
      </Surface>
    </div>
  )
}
