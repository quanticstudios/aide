import type {
  FocusEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
} from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { UpdatePresentation } from '@/lib/update-presentation'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  PersistedSplitLayoutNode,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import type { SavedTask } from '../../../shared/task-library'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import FleetDrawer from './FleetDrawer'
import SidebarTree from './SidebarTree'
import TopBar from './TopBar'

const SIDEBAR_PIN_STORAGE_KEY = 'aide.sidebar.pinned'
const SIDEBAR_COLLAPSE_DELAY_MS = 140

function isCollapsedSidebarAction(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest('[data-sidebar-action]') !== null
  )
}

interface AppShellProps {
  readonly activePaneId: string | null
  readonly activeSurfaceId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
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
  readonly showProjectHints: boolean
  readonly onSelectHome: () => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onConfigureProjectSetup: (projectId: string) => void
  readonly onOpenDiagnostics: () => void
  readonly onOpenSettings: (trigger: HTMLElement) => void
  readonly onOpenTask: (task: SavedTask) => Promise<void>
  readonly onOpenUpdate: () => void
  readonly updatePresentation: UpdatePresentation
  readonly workspaceSummaries: Record<string, WorkspaceSummary>
  readonly children: ReactNode
}

export default function AppShell({
  activePaneId,
  activeSurfaceId,
  projects,
  workspaces,
  activeProject,
  activeWorkspace,
  onClosePane,
  onCreatePane,
  onResizePane,
  onSplitPane,
  surfaces,
  surfaceManagedSessionIds,
  showProjectHints,
  onSelectHome,
  onSelectPane,
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
  onConfigureProjectSetup,
  onOpenDiagnostics,
  onOpenSettings,
  onOpenTask,
  onOpenUpdate,
  updatePresentation,
  workspaceSummaries,
  children,
}: AppShellProps) {
  const sidebarShellRef = useRef<HTMLDivElement | null>(null)
  const fleetToggleRef = useRef<HTMLButtonElement | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const [isSidebarHovered, setIsSidebarHovered] = useState(false)
  const [isSidebarFocusWithin, setIsSidebarFocusWithin] = useState(false)
  const [isFleetOpen, setIsFleetOpen] = useState(false)
  const [isSidebarPinnedOpen, setIsSidebarPinnedOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(SIDEBAR_PIN_STORAGE_KEY) === 'true'
  })

  const isSidebarExpanded =
    isSidebarPinnedOpen || isSidebarHovered || isSidebarFocusWithin
  const activeManagedSessionId =
    activeWorkspace &&
    activePaneId &&
    resolveTerminalLaunchModeForPaneId(activePaneId) !== 'shell'
      ? `${activeWorkspace.id}:${activePaneId}`
      : null

  const closeFleet = useCallback((): void => {
    setIsFleetOpen(false)
    window.requestAnimationFrame(() => fleetToggleRef.current?.focus())
  }, [])

  const sidebarContainsActiveElement = useCallback((): boolean => {
    if (typeof document === 'undefined') {
      return false
    }

    const activeElement = document.activeElement

    return Boolean(
      activeElement instanceof Node &&
        sidebarShellRef.current?.contains(activeElement),
    )
  }, [])

  const blurSidebarActiveElement = useCallback((): void => {
    if (typeof document === 'undefined') {
      return
    }

    const activeElement = document.activeElement

    if (
      activeElement instanceof HTMLElement &&
      sidebarShellRef.current?.contains(activeElement)
    ) {
      activeElement.blur()
    }
  }, [])

  const clearPendingCollapse = useCallback((): void => {
    if (collapseTimerRef.current === null) {
      return
    }

    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }, [])

  const scheduleSidebarCollapse = useCallback((): void => {
    clearPendingCollapse()
    collapseTimerRef.current = window.setTimeout(() => {
      setIsSidebarHovered(false)
    }, SIDEBAR_COLLAPSE_DELAY_MS)
  }, [clearPendingCollapse])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      SIDEBAR_PIN_STORAGE_KEY,
      isSidebarPinnedOpen ? 'true' : 'false',
    )
  }, [isSidebarPinnedOpen])

  useEffect(
    () => () => {
      if (collapseTimerRef.current === null) {
        return
      }

      window.clearTimeout(collapseTimerRef.current)
      collapseTimerRef.current = null
    },
    [],
  )

  useEffect(() => {
    if (typeof window === 'undefined' || isSidebarPinnedOpen) {
      return
    }

    const handlePointerMove = (event: MouseEvent) => {
      const sidebarShell = sidebarShellRef.current

      if (!sidebarShell) {
        return
      }

      if (isCollapsedSidebarAction(event.target)) {
        clearPendingCollapse()
        setIsSidebarHovered(false)
        return
      }

      const interactionSurface = isSidebarExpanded
        ? sidebarShell.querySelector<HTMLElement>(
            '[data-sidebar-surface="expanded"]',
          )
        : sidebarShell
      const bounds = interactionSurface?.getBoundingClientRect()

      if (!bounds) {
        return
      }
      const isInsideBounds =
        event.clientX >= bounds.left &&
        event.clientX <= bounds.right &&
        event.clientY >= bounds.top &&
        event.clientY <= bounds.bottom

      if (isInsideBounds) {
        clearPendingCollapse()
        setIsSidebarHovered(true)
        return
      }

      const hasSidebarFocus = sidebarContainsActiveElement()

      if (!hasSidebarFocus) {
        setIsSidebarFocusWithin(false)
        clearPendingCollapse()
        setIsSidebarHovered(false)
        return
      }

      blurSidebarActiveElement()
      setIsSidebarFocusWithin(false)
      clearPendingCollapse()
      setIsSidebarHovered(false)
    }

    window.addEventListener('mousemove', handlePointerMove)

    return () => {
      window.removeEventListener('mousemove', handlePointerMove)
    }
  }, [
    clearPendingCollapse,
    blurSidebarActiveElement,
    isSidebarExpanded,
    isSidebarPinnedOpen,
    sidebarContainsActiveElement,
  ])

  function handleSidebarFocus(event: FocusEvent<HTMLDivElement>): void {
    clearPendingCollapse()

    if (isCollapsedSidebarAction(event.target)) {
      setIsSidebarFocusWithin(false)
      return
    }

    setIsSidebarFocusWithin(true)
  }

  function handleSidebarBlur(event: FocusEvent<HTMLDivElement>): void {
    const nextTarget = event.relatedTarget

    if (
      nextTarget instanceof Node &&
      sidebarShellRef.current?.contains(nextTarget)
    ) {
      return
    }

    setIsSidebarFocusWithin(false)

    if (!isSidebarPinnedOpen) {
      scheduleSidebarCollapse()
    }
  }

  function handleSidebarMouseEnter(
    event: ReactMouseEvent<HTMLDivElement>,
  ): void {
    clearPendingCollapse()

    if (isCollapsedSidebarAction(event.target)) {
      setIsSidebarHovered(false)
      return
    }

    setIsSidebarHovered(true)
  }

  function handleSidebarMouseLeave(): void {
    const hasSidebarFocus = sidebarContainsActiveElement()

    if (isSidebarPinnedOpen) {
      return
    }

    if (hasSidebarFocus) {
      blurSidebarActiveElement()
    }

    setIsSidebarFocusWithin(false)
    scheduleSidebarCollapse()
  }

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <div
        className={`relative flex h-full shrink-0 ${isSidebarPinnedOpen ? 'w-72' : 'w-12'}`}
        data-expanded={isSidebarExpanded ? 'true' : 'false'}
        data-testid="sidebar-shell"
        onBlurCapture={handleSidebarBlur}
        onFocusCapture={handleSidebarFocus}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        ref={sidebarShellRef}
      >
        <SidebarTree
          activeProjectId={
            activeWorkspace?.projectId ?? activeProject?.id ?? null
          }
          activeWorkspaceId={activeWorkspace?.id ?? null}
          isExpanded={isSidebarExpanded}
          isPinnedOpen={isSidebarPinnedOpen}
          onCreateProject={onCreateProject}
          onCreateWorkspace={onCreateWorkspace}
          onConfigureProjectSetup={onConfigureProjectSetup}
          onSelectHome={onSelectHome}
          onOpenSettings={onOpenSettings}
          onSelectProject={onSelectProject}
          onSelectPane={onSelectPane}
          onSelectWorkspace={onSelectWorkspace}
          onTogglePinnedOpen={() =>
            setIsSidebarPinnedOpen((current) => !current)
          }
          projects={projects}
          showProjectHints={showProjectHints}
          summaries={workspaceSummaries}
          workspaces={workspaces}
        />
      </div>

      <div className="flex min-w-0 w-full flex-1 flex-col overflow-hidden">
        <TopBar
          activePaneId={activePaneId}
          activeSurfaceId={activeSurfaceId}
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          fleetToggleRef={fleetToggleRef}
          isFleetAvailable={Boolean(activeManagedSessionId)}
          isFleetOpen={isFleetOpen}
          onClosePane={onClosePane}
          onCreatePane={onCreatePane}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenTask={onOpenTask}
          onOpenUpdate={onOpenUpdate}
          onToggleFleet={() =>
            isFleetOpen ? closeFleet() : setIsFleetOpen(true)
          }
          onResizePane={onResizePane}
          onSplitPane={onSplitPane}
          surfaces={surfaces}
          surfaceManagedSessionIds={surfaceManagedSessionIds}
          updatePresentation={updatePresentation}
          onSelectPane={onSelectPane}
        />

        <main className="relative flex min-h-0 w-full flex-1 overflow-hidden">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {children}
          </div>
          {isFleetOpen ? (
            <FleetDrawer
              onClose={closeFleet}
              sessionId={activeManagedSessionId}
            />
          ) : null}
        </main>
      </div>
    </div>
  )
}
