import { Button, Toolbar } from '@heroui/react'
import {
  Columns2,
  Expand,
  LifeBuoy,
  type LucideIcon,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Plus,
  Rows2,
  Shrink,
  X,
} from 'lucide-react'
import type { RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'

import { listCreatablePaneCatalogEntries } from '@/lib/pane-catalog'
import { getSessionStateDotClass } from '@/lib/session-state-dot'
import type { UpdatePresentation } from '@/lib/update-presentation'
import { cn } from '@/lib/utils'
import { version } from '../../../../package.json'
import type {
  PersistedSplitLayoutNode,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import type { SavedTask } from '../../../shared/task-library'
import { useManagedSessionState } from '../hooks/useManagedSessionState'
import { getProjectColorClassName, ProjectIconView } from './ProjectIcon'
import TaskLibraryControl from './TaskLibraryControl'
import TaskNotificationToasts from './TaskNotificationToasts'
import UpdateIndicator from './UpdateIndicator'
import IconTooltip from './ui/icon-tooltip'

interface TopBarProps {
  readonly activePaneId: string | null
  readonly activeSurfaceId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly fleetToggleRef: RefObject<HTMLButtonElement | null>
  readonly isFleetAvailable: boolean
  readonly isFleetOpen: boolean
  readonly isSidebarOpen: boolean
  readonly isTerminalAvailable: boolean
  readonly isTerminalOpen: boolean
  readonly onClosePane: (paneId: string) => void
  readonly onCloseSurface: (surfaceId: string) => void
  readonly onCreatePane: () => void
  readonly onOpenDiagnostics: () => void
  readonly onOpenTask: (task: SavedTask) => Promise<void>
  readonly onOpenUpdate: () => void
  readonly onToggleFleet: () => void
  readonly onToggleSidebar: () => void
  readonly onToggleTerminal: () => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly surfaces: readonly WorkspaceSurfaceRecord[]
  readonly surfaceManagedSessionIds: Record<string, string | null>
  readonly onSelectPane: (paneId: string) => void
  readonly sidebarToggleRef: RefObject<HTMLButtonElement | null>
  readonly updatePresentation: UpdatePresentation
}

function SurfaceTab({
  index,
  isActive,
  managedSessionId,
  onClose,
  onSelect,
  surface,
}: {
  readonly index: number
  readonly isActive: boolean
  readonly managedSessionId: string | null
  readonly onClose: () => void
  readonly onSelect: () => void
  readonly surface: WorkspaceSurfaceRecord
}) {
  const sessionState = useManagedSessionState(managedSessionId)

  return (
    <div className="group/surface-tab relative flex shrink-0 items-center">
      <Button
        aria-label={surface.title}
        className={cn(
          'pane-tab workspace-strip-item h-8 rounded-md pl-2.5 pr-8 text-left text-[12px] font-semibold',
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
      <Button
        aria-label={`Close ${surface.title}`}
        className="absolute right-1 size-6 rounded opacity-0 transition-opacity hover:bg-surface-tertiary focus-visible:opacity-100 group-hover/surface-tab:opacity-100 group-focus-within/surface-tab:opacity-100"
        isIconOnly
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onPress={onClose}
        size="sm"
        variant="ghost"
      >
        <X aria-hidden="true" className="size-3.5" />
      </Button>
    </div>
  )
}

function PaneActionBar({
  activePaneId,
  onClosePane,
  onResizePane,
  onSplitPane,
  projectKind,
}: {
  readonly activePaneId: string | null
  readonly onClosePane: (paneId: string) => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly projectKind: ProjectRecord['kind']
}) {
  const [pickerMode, setPickerMode] = useState<
    'split-horizontal' | 'split-vertical' | null
  >(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  // The picker cannot outlive its target pane, including for the current commit.
  if (activePaneId === null && pickerMode !== null) {
    setPickerMode(null)
  }

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

  const viewOptions = listCreatablePaneCatalogEntries(projectKind)

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
      <div className="flex flex-row items-center gap-0.5">
        {actions.map((action) => {
          const Icon = action.icon
          const toneClass =
            action.tone === 'destructive'
              ? 'text-accent-red hover:bg-accent-red-soft hover:text-accent-red'
              : 'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'

          return (
            <IconTooltip key={action.label} label={action.label}>
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
            </IconTooltip>
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
          <div className="absolute right-0 top-full z-20 mt-1.5 w-48 rounded-lg floating-surface p-1">
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
  fleetToggleRef,
  isFleetAvailable,
  isFleetOpen,
  isSidebarOpen,
  isTerminalAvailable,
  isTerminalOpen,
  onClosePane,
  onCloseSurface,
  onCreatePane,
  onOpenDiagnostics,
  onOpenTask,
  onOpenUpdate,
  onToggleFleet,
  onToggleSidebar,
  onToggleTerminal,
  onResizePane,
  onSplitPane,
  surfaces,
  surfaceManagedSessionIds,
  onSelectPane,
  sidebarToggleRef,
  updatePresentation,
}: TopBarProps) {
  const visibleSurfaces = surfaces

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-3">
      <div className="flex w-full items-center gap-3 overflow-hidden">
        <IconTooltip label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}>
          <Button
            aria-controls="workspace-sidebar"
            aria-expanded={isSidebarOpen}
            aria-label={isSidebarOpen ? 'Close sidebar' : 'Open sidebar'}
            className="size-8 shrink-0 rounded-md"
            isIconOnly
            onPress={onToggleSidebar}
            ref={sidebarToggleRef}
            size="sm"
            variant={isSidebarOpen ? 'secondary' : 'ghost'}
          >
            {isSidebarOpen ? (
              <PanelLeftClose aria-hidden="true" className="size-4" />
            ) : (
              <PanelLeftOpen aria-hidden="true" className="size-4" />
            )}
          </Button>
        </IconTooltip>
        <div
          className="flex shrink-0 items-center gap-2"
          data-testid="workspace-heading"
        >
          {activeProject?.icon ? (
            <span
              aria-hidden="true"
              className={getProjectColorClassName(
                activeProject.color ?? 'neutral',
              )}
            >
              <ProjectIconView icon={activeProject.icon} />
            </span>
          ) : null}
          <p className="display whitespace-nowrap text-[13px] text-foreground">
            {activeWorkspace?.name ?? activeProject?.name ?? 'No workspace'}
          </p>
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto">
          <Toolbar
            aria-label="Pane selector"
            className="workspace-strip inline-flex min-w-max gap-1 bg-transparent"
          >
            {visibleSurfaces.map((surface, index) => (
              <SurfaceTab
                index={index}
                isActive={surface.id === activeSurfaceId}
                key={surface.id}
                managedSessionId={surfaceManagedSessionIds[surface.id] ?? null}
                onClose={() => onCloseSurface(surface.id)}
                onSelect={() => onSelectPane(surface.id)}
                surface={surface}
              />
            ))}

            {activeWorkspace ? (
              <IconTooltip label="Add pane">
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
              </IconTooltip>
            ) : null}
          </Toolbar>
        </div>

        <PaneActionBar
          activePaneId={activePaneId}
          onClosePane={onClosePane}
          onResizePane={onResizePane}
          onSplitPane={onSplitPane}
          projectKind={activeProject?.kind ?? 'git'}
        />
        <TaskLibraryControl onOpenTask={onOpenTask} />
        <TaskNotificationToasts />
        <IconTooltip
          label={
            <span className="flex items-center gap-2">
              {isTerminalOpen ? 'Hide terminal' : 'Show terminal'}
              <span className="flex gap-1">
                <kbd className="keycap">Ctrl</kbd>
                <kbd className="keycap">`</kbd>
              </span>
            </span>
          }
        >
          <Button
            aria-label={isTerminalOpen ? 'Close terminal' : 'Open terminal'}
            className="size-8 shrink-0 rounded-md"
            isDisabled={!isTerminalAvailable}
            isIconOnly
            onPress={onToggleTerminal}
            size="sm"
            variant={isTerminalOpen ? 'secondary' : 'ghost'}
          >
            <PanelBottom aria-hidden="true" className="size-4" />
          </Button>
        </IconTooltip>
        <IconTooltip
          label={isFleetOpen ? 'Hide agent fleet' : 'Show agent fleet'}
        >
          <Button
            aria-label={isFleetOpen ? 'Close agent fleet' : 'Open agent fleet'}
            className="size-8 shrink-0 rounded-md"
            isDisabled={!isFleetAvailable && !isFleetOpen}
            isIconOnly
            onPress={onToggleFleet}
            ref={fleetToggleRef}
            size="sm"
            variant={isFleetOpen ? 'secondary' : 'ghost'}
          >
            <PanelRight aria-hidden="true" className="size-4" />
          </Button>
        </IconTooltip>
        <UpdateIndicator
          onOpen={onOpenUpdate}
          presentation={updatePresentation}
        />
        <Button
          aria-label="Open diagnostics"
          className="h-8 shrink-0 gap-2 rounded-md px-2 text-xs"
          onPress={onOpenDiagnostics}
          size="sm"
          variant="ghost"
        >
          <LifeBuoy aria-hidden="true" className="size-4" />
          <span data-testid="app-version">aIDE v{version}</span>
        </Button>
      </div>
    </header>
  )
}
