import { Button, Toolbar, Tooltip } from '@heroui/react'
import {
  Columns2,
  Expand,
  GitBranch,
  type LucideIcon,
  Plus,
  Rows2,
  Shrink,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { listCreatablePaneCatalogEntries } from '@/lib/pane-catalog'
import { getSessionStateDotClass } from '@/lib/session-state-dot'
import { cn } from '@/lib/utils'
import type { PersistedSplitLayoutNode } from '../../../shared/persistence'
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import { useManagedSessionState } from '../hooks/useManagedSessionState'

interface TopBarProps {
  readonly activePaneId: string | null
  readonly activeSurfaceId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onClosePane: (paneId: string) => void
  readonly onCreatePane: () => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly surfaces: readonly WorkspaceSurfaceRecord[]
  readonly surfaceManagedSessionIds: Record<string, string | null>
  readonly onSelectPane: (paneId: string) => void
}

function SurfaceTab({
  index,
  isActive,
  managedSessionId,
  onSelect,
  surface,
}: {
  readonly index: number
  readonly isActive: boolean
  readonly managedSessionId: string | null
  readonly onSelect: () => void
  readonly surface: WorkspaceSurfaceRecord
}) {
  const sessionState = useManagedSessionState(managedSessionId)

  return (
    <Button
      aria-label={surface.title}
      className={cn(
        'pane-tab workspace-strip-item h-8 shrink-0 rounded-md px-2.5 text-left text-[12px] font-semibold',
        isActive && 'is-active',
      )}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onPress={onSelect}
      variant={isActive ? 'secondary' : 'ghost'}
    >
      <span className="grid size-5 place-items-center rounded-full border border-border bg-surface-tertiary text-[10px] font-semibold leading-none text-muted-foreground">
        {index + 1}
      </span>
      <span>{surface.title}</span>
      {managedSessionId ? (
        <span
          className={`size-2 shrink-0 rounded-full ${getSessionStateDotClass(sessionState)}`}
        />
      ) : null}
    </Button>
  )
}

function PaneActionBar({
  activePaneId,
  onClosePane,
  onResizePane,
  onSplitPane,
}: {
  readonly activePaneId: string | null
  readonly onClosePane: (paneId: string) => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
}) {
  const [pickerMode, setPickerMode] = useState<
    'split-horizontal' | 'split-vertical' | null
  >(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!pickerMode) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setPickerMode(null)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [pickerMode])

  useEffect(() => {
    if (!activePaneId) {
      setPickerMode(null)
    }
  }, [activePaneId])

  const viewOptions = listCreatablePaneCatalogEntries()

  const isDisabled = !activePaneId

  const actions: ReadonlyArray<{
    readonly icon: LucideIcon
    readonly label: string
    readonly onPress: () => void
    readonly tone: 'neutral' | 'destructive'
  }> = [
    {
      icon: Columns2,
      label: 'Split horizontally',
      onPress: () => setPickerMode('split-horizontal'),
      tone: 'neutral',
    },
    {
      icon: Rows2,
      label: 'Split vertically',
      onPress: () => setPickerMode('split-vertical'),
      tone: 'neutral',
    },
    {
      icon: Shrink,
      label: 'Shrink pane',
      onPress: () => activePaneId && onResizePane(activePaneId, -0.25),
      tone: 'neutral',
    },
    {
      icon: Expand,
      label: 'Grow pane',
      onPress: () => activePaneId && onResizePane(activePaneId, 0.25),
      tone: 'neutral',
    },
    {
      icon: X,
      label: 'Close pane',
      onPress: () => activePaneId && onClosePane(activePaneId),
      tone: 'destructive',
    },
  ]

  const pickerLabel =
    pickerMode === 'split-horizontal'
      ? 'Split horizontal with'
      : 'Split vertical with'

  return (
    <div className="relative shrink-0" ref={containerRef}>
      <div className="flex flex-row items-center gap-0.5 rounded-md border border-border bg-surface px-1 py-1">
        {actions.map((action) => {
          const Icon = action.icon
          const toneClass =
            action.tone === 'destructive'
              ? 'text-accent-red hover:bg-accent-red-soft hover:text-accent-red'
              : 'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'

          return (
            <Tooltip delay={550} key={action.label}>
              <Tooltip.Trigger>
                <Button
                  aria-label={action.label}
                  className={cn(
                    'size-8 rounded border border-transparent bg-transparent transition-colors disabled:opacity-40',
                    toneClass,
                  )}
                  isDisabled={isDisabled}
                  isIconOnly
                  onPress={action.onPress}
                  size="sm"
                  variant="ghost"
                >
                  <Icon className="size-4" />
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content
                className="rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground"
                placement="bottom"
              >
                {action.label}
              </Tooltip.Content>
            </Tooltip>
          )
        })}
      </div>

      {pickerMode && activePaneId ? (
        <>
          <button
            aria-label="Close pane picker"
            className="fixed inset-0 z-10"
            onClick={() => setPickerMode(null)}
            type="button"
          />
          <div className="absolute right-0 top-full z-20 mt-1.5 w-48 rounded-md border border-border bg-surface-elevated p-1 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <p className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              {pickerLabel}
            </p>
            {viewOptions.map((view) => {
              const Icon = view.icon

              return (
                <button
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-surface-tertiary"
                  key={view.type}
                  onClick={() => {
                    onSplitPane(activePaneId, pickerMode, view.type)
                    setPickerMode(null)
                  }}
                  type="button"
                >
                  <Icon className="size-3.5 text-muted-foreground" />
                  <span>{view.defaultMetadata.type}</span>
                </button>
              )
            })}
          </div>
        </>
      ) : null}
    </div>
  )
}

export default function TopBar({
  activePaneId,
  activeSurfaceId,
  activeProject,
  activeWorkspace,
  onClosePane,
  onCreatePane,
  onResizePane,
  onSplitPane,
  surfaces,
  surfaceManagedSessionIds,
  onSelectPane,
}: TopBarProps) {
  const visibleSurfaces = surfaces

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-3">
      <div className="flex w-full items-center gap-3 overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
          <p className="display max-w-[7rem] truncate text-[13px] text-foreground">
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
            className="workspace-strip inline-flex min-w-max rounded-lg border border-border bg-surface p-1"
            isAttached
          >
            {visibleSurfaces.map((surface, index) => (
              <SurfaceTab
                index={index}
                isActive={surface.id === activeSurfaceId}
                key={surface.id}
                managedSessionId={surfaceManagedSessionIds[surface.id] ?? null}
                onSelect={() => onSelectPane(surface.id)}
                surface={surface}
              />
            ))}

            {activeWorkspace ? (
              <Button
                aria-label="Add pane"
                className="size-8 shrink-0 rounded-md"
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

        <PaneActionBar
          activePaneId={activePaneId}
          onClosePane={onClosePane}
          onResizePane={onResizePane}
          onSplitPane={onSplitPane}
        />
      </div>
    </header>
  )
}
