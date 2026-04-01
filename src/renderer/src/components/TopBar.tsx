import { Button, Chip, Kbd, Toolbar } from '@heroui/react'
import { GitBranch, Plus } from 'lucide-react'

import { getWorkspaceScene, resolveWorkspacePane } from '@/lib/navigation-poc'
import { cn } from '@/lib/utils'
import type { WorkspaceLayoutPresetId } from '@/lib/workspace-layout-presets'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface TopBarProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly paneIds: readonly string[]
  readonly onApplyLayoutPreset: (presetId: WorkspaceLayoutPresetId) => void
  readonly onSelectPane: (paneId: string) => void
  readonly onCreateWorkspace: () => void
}

export default function TopBar({
  activePaneId,
  activeProject,
  activeWorkspace,
  isDemoMode,
  paneIds,
  onApplyLayoutPreset,
  onSelectPane,
  onCreateWorkspace,
}: TopBarProps) {
  const workspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)
  const visiblePaneIds =
    paneIds.length > 0
      ? paneIds
      : isDemoMode
        ? workspaceScene.panes.map((pane) => pane.id)
        : []

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
            {visiblePaneIds.map((paneId, index) => {
              const pane = resolveWorkspacePane(
                activeWorkspace?.id ?? null,
                paneId,
              )
              const isActive = paneId === activePaneId

              if (!pane) {
                return null
              }

              return (
                <Button
                  aria-label={pane.label}
                  className={cn(
                    'workspace-strip-item h-8 shrink-0 rounded-lg px-2.5 text-left text-[12px] font-medium transition-all',
                    isActive
                      ? 'border-primary/60 bg-primary/12 text-foreground shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                      : 'border-transparent bg-transparent text-muted-foreground hover:border-primary/25 hover:bg-surface-secondary hover:text-foreground',
                  )}
                  key={paneId}
                  onPress={() => onSelectPane(paneId)}
                  variant={isActive ? 'secondary' : 'ghost'}
                >
                  <span className="grid size-5 place-items-center rounded-full border border-border/80 bg-background text-[10px] font-medium leading-none text-muted-foreground">
                    {index + 1}
                  </span>
                  <span>{pane.type}</span>
                </Button>
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
          </Toolbar>
        </div>

        <div className="hidden shrink-0 items-center gap-2 lg:flex">
          <div className="flex items-center gap-1">
            <Button
              onPress={() => onApplyLayoutPreset('columns')}
              size="sm"
              variant="ghost"
            >
              Columns
            </Button>
            <Button
              onPress={() => onApplyLayoutPreset('focus')}
              size="sm"
              variant="ghost"
            >
              Focus
            </Button>
            <Button
              onPress={() => onApplyLayoutPreset('stack')}
              size="sm"
              variant="ghost"
            >
              Stack
            </Button>
          </div>

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
