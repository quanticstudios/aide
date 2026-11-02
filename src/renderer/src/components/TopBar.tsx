import { Button, Dropdown, Header, Toolbar, Tooltip } from '@heroui/react'
import {
  Columns2,
  Expand,
  LifeBuoy,
  type LucideIcon,
  PanelBottom,
  PanelLeftClose,
  PanelLeftOpen,
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
import {
  useManagedSessionState,
  useManagedSessionTitle,
} from '../hooks/useManagedSessionState'
import { getProjectColorClassName, ProjectIconView } from './ProjectIcon'
import TaskLibraryControl from './TaskLibraryControl'
import TaskNotificationToasts from './TaskNotificationToasts'
import UpdateIndicator from './UpdateIndicator'
import IconTooltip from './ui/icon-tooltip'

interface TopBarProps {
  readonly activePaneId: string | null
  readonly canResizePane: boolean
  readonly activeSurfaceId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isSidebarOpen: boolean
  readonly isTerminalAvailable: boolean
  readonly showProjectName: boolean
  readonly isTerminalOpen: boolean
  readonly onClosePane: (paneId: string) => void
  readonly onCloseSurface: (surfaceId: string) => void
  readonly onCreatePane: () => void
  readonly onOpenDiagnostics: () => void
  readonly onOpenTask: (task: SavedTask) => Promise<void>
  readonly onOpenUpdate: () => void
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
  const label = useManagedSessionTitle(managedSessionId) ?? surface.title

  return (
    <div
      className="group/surface-tab relative flex shrink-0 items-center"
      data-active={isActive ? 'true' : undefined}
    >
      <Button
        aria-label={label}
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
        <span className="max-w-48 truncate" title={label}>
          {label}
        </span>
        {managedSessionId ? (
          <span
            className={`size-2 shrink-0 rounded-full ${getSessionStateDotClass(sessionState)}`}
          />
        ) : null}
      </Button>
      <Button
        aria-label={`Close ${label}`}
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

// invariant: these match the strip's scroll-pl-4 and scroll-pr-6, where the edge fades sit.
const PANE_STRIP_START_INSET = 16
const PANE_STRIP_END_INSET = 24

/** The pane strip's scroll position that shows the whole active tab with a tab, not a sliver, at its start. */
export function paneStripScrollLeft(
  tabs: readonly { left: number; width: number }[],
  activeIndex: number,
  strip: {
    endInset: number
    scrollLeft: number
    startInset: number
    viewWidth: number
  },
): number {
  const active = tabs[activeIndex]
  if (!active) return strip.scrollLeft
  const lowest = active.left + active.width + strip.endInset - strip.viewWidth
  const highest = active.left - strip.startInset
  const aligned = tabs
    .map((tab) => tab.left - strip.startInset)
    .filter((left) => left >= lowest && left <= highest)
  const best = aligned.length
    ? aligned.reduce((closest, left) =>
        Math.abs(left - strip.scrollLeft) < Math.abs(closest - strip.scrollLeft)
          ? left
          : closest,
      )
    : highest
  return Math.max(best, 0)
}

const SPLIT_ACTIONS = [
  {
    icon: Columns2,
    label: 'Split horizontally',
    menuLabel: 'Split horizontal with',
    type: 'split-horizontal',
  },
  {
    icon: Rows2,
    label: 'Split vertically',
    menuLabel: 'Split vertical with',
    type: 'split-vertical',
  },
] as const

const PANE_ACTION_BUTTON_CLASS =
  'size-8 rounded border border-transparent bg-transparent transition-colors disabled:opacity-40'
const NEUTRAL_TONE_CLASS =
  'text-muted-foreground hover:bg-surface-tertiary hover:text-foreground'

function SplitPaneMenu({
  isDisabled,
  onSplit,
  split,
  viewOptions,
}: {
  readonly isDisabled: boolean
  readonly onSplit: (paneType: string) => void
  readonly split: (typeof SPLIT_ACTIONS)[number]
  readonly viewOptions: ReturnType<typeof listCreatablePaneCatalogEntries>
}) {
  const [isOpen, setIsOpen] = useState(false)
  const Icon = split.icon

  // invariant: the menu cannot outlive the pane it would split, including for the current commit.
  if (isDisabled && isOpen) {
    setIsOpen(false)
  }

  return (
    <Tooltip closeDelay={0} delay={350} isDisabled={isOpen}>
      <Tooltip.Trigger className="flex shrink-0" role="none" tabIndex={-1}>
        {/* why: the top bar row clips overflow, so the menu has to portal out of it. */}
        <Dropdown isOpen={isOpen} onOpenChange={setIsOpen}>
          <Dropdown.Trigger
            aria-label={split.label}
            className={cn(
              PANE_ACTION_BUTTON_CLASS,
              NEUTRAL_TONE_CLASS,
              'grid place-items-center',
              isOpen && 'bg-surface-tertiary text-foreground',
            )}
            isDisabled={isDisabled}
          >
            <Icon aria-hidden="true" className="size-4" />
          </Dropdown.Trigger>
          <Dropdown.Popover
            className="w-48 rounded-lg floating-surface p-1"
            placement="bottom end"
          >
            <Dropdown.Menu
              aria-label={split.menuLabel}
              className="outline-none"
              onAction={(key) => onSplit(String(key))}
            >
              <Dropdown.Section>
                <Header className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {split.menuLabel}
                </Header>
                {viewOptions.map((view) => {
                  const ViewIcon = view.icon

                  return (
                    <Dropdown.Item
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-surface-tertiary data-[focused]:bg-surface-tertiary"
                      id={view.id}
                      key={view.id}
                      textValue={view.defaultMetadata.type}
                    >
                      <ViewIcon className="size-3.5 text-muted-foreground" />
                      <span>{view.defaultMetadata.type}</span>
                    </Dropdown.Item>
                  )
                })}
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </Tooltip.Trigger>
      <Tooltip.Content
        className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md"
        placement="bottom"
      >
        {split.label}
      </Tooltip.Content>
    </Tooltip>
  )
}

/** Split, resize and close controls for the active pane; each split opens a pane-type menu. */
export function PaneActionBar({
  activePaneId,
  canResizePane,
  onClosePane,
  onResizePane,
  onSplitPane,
  projectKind,
}: {
  readonly activePaneId: string | null
  readonly canResizePane: boolean
  readonly onClosePane: (paneId: string) => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSplitPane: (
    paneId: string,
    splitType: PersistedSplitLayoutNode['type'],
    targetPaneType?: string,
  ) => void
  readonly projectKind: ProjectRecord['kind']
}) {
  const viewOptions = listCreatablePaneCatalogEntries(projectKind)
  const isDisabled = !activePaneId

  const actions: ReadonlyArray<{
    readonly icon: LucideIcon
    readonly label: string
    readonly onPress: () => void
    readonly requiresSplit?: boolean
    readonly tone: 'neutral' | 'destructive'
  }> = [
    {
      icon: Shrink,
      label: 'Shrink pane',
      onPress: () => activePaneId && onResizePane(activePaneId, -0.25),
      requiresSplit: true,
      tone: 'neutral',
    },
    {
      icon: Expand,
      label: 'Grow pane',
      onPress: () => activePaneId && onResizePane(activePaneId, 0.25),
      requiresSplit: true,
      tone: 'neutral',
    },
    {
      icon: X,
      label: 'Close pane',
      onPress: () => activePaneId && onClosePane(activePaneId),
      tone: 'destructive',
    },
  ]

  return (
    <div className="flex shrink-0 flex-row items-center gap-0.5">
      {SPLIT_ACTIONS.map((split) => (
        <SplitPaneMenu
          isDisabled={isDisabled}
          key={split.type}
          onSplit={(paneType) => {
            if (activePaneId) onSplitPane(activePaneId, split.type, paneType)
          }}
          split={split}
          viewOptions={viewOptions}
        />
      ))}
      {actions.map((action) => {
        const Icon = action.icon
        const toneClass =
          action.tone === 'destructive'
            ? 'text-accent-red hover:bg-accent-red-soft hover:text-accent-red'
            : NEUTRAL_TONE_CLASS

        return (
          <IconTooltip key={action.label} label={action.label}>
            <Button
              aria-label={action.label}
              className={cn(PANE_ACTION_BUTTON_CLASS, toneClass)}
              isDisabled={
                isDisabled || (action.requiresSplit && !canResizePane)
              }
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
  )
}

export default function TopBar({
  activePaneId,
  activeSurfaceId,
  canResizePane,
  activeProject,
  activeWorkspace,
  isSidebarOpen,
  isTerminalAvailable,
  isTerminalOpen,
  showProjectName,
  onClosePane,
  onCloseSurface,
  onCreatePane,
  onOpenDiagnostics,
  onOpenTask,
  onOpenUpdate,
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
  const stripRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const strip = stripRef.current
    if (!activeSurfaceId || !strip) return
    const reveal = () => {
      const elements = [
        ...strip.querySelectorAll<HTMLElement>('.group\\/surface-tab'),
      ]
      const activeIndex = elements.findIndex(
        (element) => element.dataset.active,
      )
      if (activeIndex === -1) return
      const origin = strip.getBoundingClientRect().left - strip.scrollLeft
      const tabs = elements.map((element) => {
        const rect = element.getBoundingClientRect()
        return { left: rect.left - origin, width: rect.width }
      })
      const left = paneStripScrollLeft(tabs, activeIndex, {
        endInset: PANE_STRIP_END_INSET,
        scrollLeft: strip.scrollLeft,
        startInset: PANE_STRIP_START_INSET,
        viewWidth: strip.clientWidth,
      })
      // why: near the end the aligned position can lie past the scroll range, so the strip grows its end padding to reach it.
      const toolbar = strip.firstElementChild as HTMLElement | null
      if (toolbar) toolbar.style.paddingRight = ''
      const shortfall = left - (strip.scrollWidth - strip.clientWidth)
      if (toolbar && shortfall > 0) {
        toolbar.style.paddingRight = `${PANE_STRIP_END_INSET + shortfall}px`
      }
      strip.scrollLeft = left
    }
    reveal()
    const observer = new ResizeObserver(reveal)
    observer.observe(strip)
    return () => observer.disconnect()
  }, [activeSurfaceId])

  return (
    <header className="flex h-14 shrink-0 items-center border-b border-border bg-background px-3">
      <div className="flex h-full w-full items-center gap-3 overflow-hidden">
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
          className="flex min-w-0 max-w-[40%] shrink-0 items-center gap-2"
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
          <p className="display min-w-0 truncate whitespace-nowrap text-[13px] text-foreground">
            {showProjectName && activeWorkspace && activeProject ? (
              <span className="text-muted-foreground">
                {activeProject.name}
                <span aria-hidden="true" className="px-1.5">
                  /
                </span>
              </span>
            ) : null}
            {activeWorkspace?.name ?? activeProject?.name ?? 'No workspace'}
          </p>
        </div>

        <div
          className="min-w-0 flex-1 scroll-pr-6 scroll-pl-4 overflow-x-auto py-1 [mask-image:linear-gradient(to_right,transparent_0.75rem,black_1rem,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none]"
          onWheel={(event) => {
            if (event.deltaX === 0)
              event.currentTarget.scrollLeft += event.deltaY
          }}
          ref={stripRef}
        >
          <Toolbar
            aria-label="Pane selector"
            className="workspace-strip inline-flex min-w-max gap-1 bg-transparent pl-4 pr-6"
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
          canResizePane={canResizePane}
          onClosePane={onClosePane}
          onResizePane={onResizePane}
          onSplitPane={onSplitPane}
          projectKind={activeProject?.kind ?? 'git'}
        />
        <TaskLibraryControl onOpenTask={onOpenTask} />
        <TaskNotificationToasts activePaneId={activePaneId} />
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
          <span className="max-[1439px]:sr-only" data-testid="app-version">
            aIDE v{version}
          </span>
        </Button>
      </div>
    </header>
  )
}
