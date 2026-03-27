import { Chip, Description, Kbd, Label, ListBox, Surface } from '@heroui/react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Key } from 'react'

import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type { WorkspaceRecord } from '../../../shared/persistence'

interface WorkspaceSwitcherOverlayProps {
  readonly activeWorkspaceId: string | null
  readonly mode: 'overview' | 'workspace-switcher'
  readonly onRequestClose?: () => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly projectName: string | null
  readonly summaries: Record<string, WorkspaceSummary>
  readonly visible: boolean
  readonly workspaces: readonly WorkspaceRecord[]
}

export default function WorkspaceSwitcherOverlay({
  activeWorkspaceId,
  mode,
  onRequestClose,
  onSelectWorkspace,
  projectName,
  summaries,
  visible,
  workspaces,
}: WorkspaceSwitcherOverlayProps) {
  if (workspaces.length === 0) {
    return null
  }

  const handleWorkspaceSelection = (workspaceId: string) => {
    onSelectWorkspace(workspaceId)
    onRequestClose?.()
  }

  const isOverviewMode = mode === 'overview'
  const overlayTitle = isOverviewMode ? 'Overview' : 'Workspace switcher'
  const overlaySubtitle = isOverviewMode
    ? 'Jump across projects and workspaces.'
    : (projectName ?? 'Current project')

  return (
    <div
      aria-hidden={!visible}
      className={cn(
        'absolute z-20 transform-gpu origin-center will-change-[transform,opacity] transition-[opacity,transform] duration-120 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
        isOverviewMode
          ? 'inset-0 flex items-center justify-center p-6'
          : 'right-4 top-1/2 w-72 -translate-y-1/2',
        visible
          ? 'pointer-events-auto visible'
          : 'pointer-events-none invisible',
        visible
          ? 'scale-100 opacity-100'
          : isOverviewMode
            ? 'scale-[0.98] opacity-0'
            : 'translate-x-3 -translate-y-1/2 scale-[0.98] opacity-0',
      )}
      data-mode={mode}
      data-testid="workspace-switcher-overlay"
    >
      {isOverviewMode ? (
        <div
          aria-label="Close overview"
          className="absolute inset-0 bg-background/72 backdrop-blur-sm"
          onClick={onRequestClose}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' ||
              event.key === ' ' ||
              event.key === 'Escape'
            ) {
              event.preventDefault()
              onRequestClose?.()
            }
          }}
          role="button"
          tabIndex={0}
        />
      ) : null}

      <Surface
        className={cn(
          'relative rounded-2xl border border-border/90 bg-overlay/98 p-3 shadow-[var(--overlay-shadow)]',
          isOverviewMode ? 'w-full max-w-2xl' : '',
        )}
        onClick={
          isOverviewMode ? (event) => event.stopPropagation() : undefined
        }
        variant="secondary"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {overlayTitle}
            </p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {overlaySubtitle}
            </p>
          </div>

          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {isOverviewMode ? (
              <>
                <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
                  Ctrl
                </Kbd>
                <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
                  Tab
                </Kbd>
              </>
            ) : (
              <>
                <ArrowUp className="size-3" />
                <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
                  K
                </Kbd>
                <ArrowDown className="ml-1 size-3" />
                <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
                  J
                </Kbd>
              </>
            )}
          </div>
        </div>

        <ListBox
          aria-label={overlayTitle}
          className="space-y-1"
          onAction={(key: Key) => handleWorkspaceSelection(String(key))}
          onSelectionChange={(keys) => {
            if (!isOverviewMode || keys === 'all') {
              return
            }

            const [workspaceId] = Array.from(keys)

            if (!workspaceId || workspaceId === activeWorkspaceId) {
              return
            }

            handleWorkspaceSelection(String(workspaceId))
          }}
          selectedKeys={new Set(activeWorkspaceId ? [activeWorkspaceId] : [])}
          selectionMode="single"
        >
          {workspaces.map((workspace, index) => (
            <ListBox.Item
              className="rounded-xl border border-border/80 bg-surface px-3 py-2 text-muted-foreground transition-all data-[focused=true]:border-primary/45 data-[selected=true]:border-primary/60 data-[selected=true]:bg-surface-tertiary data-[selected=true]:text-foreground data-[selected=true]:shadow-[var(--surface-shadow)]"
              id={workspace.id}
              key={workspace.id}
              onPress={() => handleWorkspaceSelection(workspace.id)}
              textValue={workspace.name}
            >
              {(() => {
                const summary = summaries[workspace.id]
                const isCurrent = workspace.id === activeWorkspaceId

                return (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Label className="truncate text-sm font-medium">
                          {summary?.workspaceName ?? workspace.name}
                        </Label>
                        {isCurrent ? (
                          <Chip size="sm" variant="secondary">
                            Current
                          </Chip>
                        ) : null}
                      </div>
                      <Description className="truncate font-mono text-[11px] text-muted-foreground">
                        {summary?.branchName ?? workspace.branchName}
                      </Description>
                      {isOverviewMode ? (
                        <Description className="truncate text-[11px] text-muted-foreground/90">
                          {summary?.projectName ??
                            projectName ??
                            'Unknown project'}
                        </Description>
                      ) : null}
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
