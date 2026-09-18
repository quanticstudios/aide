import { Chip, Description, Kbd, Label, ListBox, Surface } from '@heroui/react'
import type { Key } from 'react'

import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type { WorkspaceRecord } from '../../../shared/persistence'
import WorkspaceStateBadges from './WorkspaceStateBadges'

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
        'absolute z-20 transform-gpu origin-center will-change-[transform,opacity] transition-[opacity,transform] duration-120 ease-[cubic-bezier(0.16,1,0.3,1)]',
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
          className="absolute inset-0 bg-black/50"
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
          'relative rounded-xl border border-border bg-surface p-3 shadow-[0_20px_60px_rgba(0,0,0,0.4)]',
          isOverviewMode ? 'w-full max-w-4xl' : '',
        )}
        onClick={
          isOverviewMode ? (event) => event.stopPropagation() : undefined
        }
        variant="secondary"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <p className="eyebrow">{overlayTitle}</p>
            <p className="display mt-1 text-sm text-foreground">
              {overlaySubtitle}
            </p>
          </div>

          <div className="flex items-center gap-1">
            {isOverviewMode ? (
              <>
                <Kbd className="keycap">Ctrl</Kbd>
                <Kbd className="keycap">Tab</Kbd>
              </>
            ) : (
              <>
                <Kbd className="keycap">Alt</Kbd>
                <Kbd className="keycap">Space</Kbd>
              </>
            )}
          </div>
        </div>

        <ListBox
          aria-label={overlayTitle}
          className={cn(
            isOverviewMode
              ? 'grid max-h-[60vh] grid-cols-2 gap-2 overflow-y-auto md:grid-cols-3'
              : 'space-y-1',
          )}
          onAction={(key: Key) => handleWorkspaceSelection(String(key))}
          onSelectionChange={(keys) => {
            if (!isOverviewMode || keys === 'all') {
              return
            }

            const [workspaceId] = Array.from(keys)

            if (!workspaceId) {
              return
            }

            handleWorkspaceSelection(String(workspaceId))
          }}
          selectedKeys={new Set(activeWorkspaceId ? [activeWorkspaceId] : [])}
          selectionMode="single"
        >
          {workspaces.map((workspace, index) => (
            <ListBox.Item
              className={cn(
                isOverviewMode
                  ? 'overview-card rounded-lg p-3 text-muted-foreground data-[selected=true]:is-active data-[selected=true]:text-foreground'
                  : 'rounded-sm border border-transparent bg-transparent px-3 py-2 text-muted-foreground transition-colors hover:bg-surface-secondary data-[focused=true]:bg-surface-secondary data-[selected=true]:bg-surface-tertiary data-[selected=true]:text-foreground',
              )}
              id={workspace.id}
              key={workspace.id}
              onPress={() => handleWorkspaceSelection(workspace.id)}
              textValue={workspace.name}
            >
              {(() => {
                const summary = summaries[workspace.id]
                const isCurrent = workspace.id === activeWorkspaceId

                if (isOverviewMode) {
                  return (
                    <div className="flex min-w-0 flex-col gap-1.5">
                      <span className="eyebrow truncate">
                        {summary?.projectName ??
                          projectName ??
                          'Unknown project'}
                      </span>
                      <Label className="display truncate text-sm text-foreground">
                        {summary?.workspaceName ?? workspace.name}
                      </Label>
                      <Description className="truncate font-mono text-[11px] text-muted-foreground">
                        {summary?.branchName ?? workspace.branchName}
                      </Description>
                      <div className="mt-1 flex items-center justify-between gap-2 border-t border-border pt-2">
                        {summary ? (
                          <WorkspaceStateBadges
                            isCurrent={isCurrent}
                            summary={summary}
                          />
                        ) : (
                          <span className="eyebrow">Idle</span>
                        )}
                        <span className="eyebrow shrink-0 tabular-nums">
                          {index + 1}
                        </span>
                      </div>
                    </div>
                  )
                }

                return (
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-2">
                        <Label className="truncate text-sm font-semibold">
                          {summary?.workspaceName ?? workspace.name}
                        </Label>
                      </div>
                      <Description className="truncate font-mono text-[11px] text-muted-foreground">
                        {summary?.branchName ?? workspace.branchName}
                      </Description>
                    </div>

                    {summary ? (
                      <WorkspaceStateBadges
                        isCurrent={isCurrent}
                        summary={summary}
                      />
                    ) : (
                      <Chip
                        className="eyebrow ml-3 shrink-0 rounded-full border border-border bg-surface-tertiary px-2"
                        color="default"
                        size="sm"
                        variant="secondary"
                      >
                        {index + 1}
                      </Chip>
                    )}
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
