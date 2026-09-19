import { Terminal as TerminalIcon, X } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { UpdatePresentation } from '@/lib/update-presentation'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  PersistedSplitLayoutNode,
  ProjectAppearance,
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import type {
  JevGateOverrides,
  JevGateSnapshot,
} from '../../../shared/jev-gates'
import { isTerminalDrawerToggle } from '../../../shared/shortcuts'
import type { SavedTask } from '../../../shared/task-library'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import FleetDrawer from './FleetDrawer'
import SidebarTree from './SidebarTree'
import TopBar from './TopBar'

const SIDEBAR_PIN_STORAGE_KEY = 'aide.sidebar.pinned'
const TERMINAL_DRAWER_STORAGE_KEY = 'aide.terminalDrawer.open'
/* A fixed pane id keeps one PTY per workspace across open/close; the main
   process replays its buffer on remount. */
const TERMINAL_DRAWER_PANE_ID = 'drawer-terminal'
const LazyTerminalPane = lazy(() => import('./TerminalPane'))

interface AppShellProps {
  readonly activePaneId: string | null
  readonly activeSurfaceId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isSidebarOpen: boolean
  readonly onToggleSidebar: () => void
  readonly isFleetOpen: boolean
  readonly onFleetOpenChange: (isOpen: boolean) => void
  readonly onClosePane: (paneId: string) => void
  readonly onCloseSurface: (surfaceId: string) => void
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
  readonly onCreateChat: (projectId: string, workspaceId?: string) => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onRenameWorkspace: (
    workspaceId: string,
    name: string,
  ) => Promise<string | null>
  readonly onUpdateProjectAppearance: (
    projectId: string,
    input: ProjectAppearance,
  ) => Promise<string | null>
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: (projectId?: string) => void
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
  isSidebarOpen,
  onToggleSidebar,
  isFleetOpen,
  onFleetOpenChange,
  onClosePane,
  onCloseSurface,
  onCreatePane,
  onResizePane,
  onSplitPane,
  surfaces,
  surfaceManagedSessionIds,
  showProjectHints,
  onCreateChat,
  onSelectPane,
  onSelectProject,
  onSelectWorkspace,
  onRenameWorkspace,
  onUpdateProjectAppearance,
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
  const jevGateWorkspaceId = activeWorkspace?.id ?? null
  const [jevGates, setJevGates] = useState<JevGateSnapshot | null>(null)
  const fleetToggleRef = useRef<HTMLButtonElement | null>(null)
  const sidebarToggleRef = useRef<HTMLButtonElement | null>(null)
  const sidebarShellRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!jevGateWorkspaceId) {
      setJevGates(null)
      return
    }
    let isCurrent = true
    void window.aide
      ?.getJevGates(jevGateWorkspaceId)
      .then((snapshot) => {
        if (isCurrent) setJevGates(snapshot)
      })
      .catch(() => {
        if (isCurrent) setJevGates(null)
      })
    return () => {
      isCurrent = false
    }
  }, [jevGateWorkspaceId])

  const updateJevGates = useCallback(
    (overrides: JevGateOverrides) => {
      if (!jevGateWorkspaceId) return
      void window.aide
        ?.updateJevGates('workspace', jevGateWorkspaceId, overrides)
        .then(setJevGates)
        .catch(() => undefined)
    },
    [jevGateWorkspaceId],
  )
  const [isTerminalOpen, setIsTerminalOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(TERMINAL_DRAWER_STORAGE_KEY) === 'true'
  })
  const [hasMountedTerminal, setHasMountedTerminal] = useState(isTerminalOpen)
  const terminalDrawerRef = useRef<HTMLElement | null>(null)
  const isSidebarExpanded = isSidebarOpen
  useLayoutEffect(() => {
    if (
      !isSidebarOpen &&
      sidebarShellRef.current?.contains(document.activeElement)
    ) {
      sidebarToggleRef.current?.focus({ preventScroll: true })
    }
  }, [isSidebarOpen])
  const activeManagedSessionId =
    activeWorkspace &&
    activePaneId &&
    resolveTerminalLaunchModeForPaneId(activePaneId) !== 'shell'
      ? `${activeWorkspace.id}:${activePaneId}`
      : null

  const closeFleet = useCallback((): void => {
    onFleetOpenChange(false)
    window.requestAnimationFrame(() => fleetToggleRef.current?.focus())
  }, [onFleetOpenChange])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(
      SIDEBAR_PIN_STORAGE_KEY,
      isSidebarOpen ? 'true' : 'false',
    )
  }, [isSidebarOpen])

  useEffect(() => {
    window.localStorage.setItem(
      TERMINAL_DRAWER_STORAGE_KEY,
      isTerminalOpen ? 'true' : 'false',
    )

    if (!isTerminalOpen) {
      return
    }

    setHasMountedTerminal(true)
    const frame = window.requestAnimationFrame(() => {
      terminalDrawerRef.current
        ?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea')
        ?.focus()
    })

    return () => window.cancelAnimationFrame(frame)
  }, [isTerminalOpen])

  useEffect(() => {
    if (!activeWorkspace) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        !isTerminalDrawerToggle({
          alt: event.altKey,
          code: event.code,
          control: event.ctrlKey,
          key: event.key,
          meta: event.metaKey,
        })
      ) {
        return
      }

      event.preventDefault()
      setIsTerminalOpen((current) => !current)
    }

    window.addEventListener('keydown', handleKeyDown, true)

    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [activeWorkspace])

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <div
        aria-hidden={!isSidebarExpanded}
        className="relative flex h-full shrink-0 overflow-hidden transition-[width] duration-200 ease-[var(--ease-out-strong)]"
        data-expanded={isSidebarExpanded ? 'true' : 'false'}
        data-testid="sidebar-shell"
        ref={sidebarShellRef}
        id="workspace-sidebar"
        inert={!isSidebarExpanded}
        style={{ width: isSidebarExpanded ? '18rem' : 0 }}
      >
        <SidebarTree
          activeProjectId={
            activeWorkspace?.projectId ?? activeProject?.id ?? null
          }
          activeWorkspaceId={activeWorkspace?.id ?? null}
          isExpanded={isSidebarExpanded}
          jevGates={jevGates}
          onCreateChat={onCreateChat}
          onCreateProject={onCreateProject}
          onCreateWorkspace={onCreateWorkspace}
          onConfigureProjectSetup={onConfigureProjectSetup}
          onOpenSettings={onOpenSettings}
          onSelectProject={onSelectProject}
          onSelectPane={onSelectPane}
          onSelectWorkspace={onSelectWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onUpdateJevGates={updateJevGates}
          onUpdateProjectAppearance={onUpdateProjectAppearance}
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
          isSidebarOpen={isSidebarExpanded}
          isTerminalAvailable={Boolean(activeWorkspace)}
          isTerminalOpen={isTerminalOpen}
          sidebarToggleRef={sidebarToggleRef}
          onClosePane={onClosePane}
          onCloseSurface={onCloseSurface}
          onCreatePane={onCreatePane}
          onOpenDiagnostics={onOpenDiagnostics}
          onOpenTask={onOpenTask}
          onOpenUpdate={onOpenUpdate}
          onToggleFleet={() =>
            isFleetOpen ? closeFleet() : onFleetOpenChange(true)
          }
          onToggleSidebar={onToggleSidebar}
          onToggleTerminal={() => setIsTerminalOpen((current) => !current)}
          onResizePane={onResizePane}
          onSplitPane={onSplitPane}
          surfaces={surfaces}
          surfaceManagedSessionIds={surfaceManagedSessionIds}
          updatePresentation={updatePresentation}
          onSelectPane={onSelectPane}
        />

        <main className="relative flex min-h-0 w-full flex-1 overflow-hidden">
          <div
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
            data-testid="workspace-content"
          >
            {children}
            {hasMountedTerminal && activeWorkspace ? (
              <section
                aria-hidden={!isTerminalOpen}
                aria-label="Terminal drawer"
                className="terminal-drawer"
                data-open={isTerminalOpen}
                data-testid="terminal-drawer"
                inert={!isTerminalOpen}
                ref={terminalDrawerRef}
              >
                <div className="terminal-drawer-body bg-background">
                  <div className="flex h-8 shrink-0 items-center justify-between px-3 text-xs font-semibold text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <TerminalIcon aria-hidden="true" className="size-3.5" />
                      Terminal
                      <span className="ml-1 font-mono text-[11px] font-normal text-muted-foreground/70">
                        {activeWorkspace.name}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <kbd className="keycap">Ctrl</kbd>
                      <kbd className="keycap">`</kbd>
                      <button
                        aria-label="Close terminal drawer"
                        className="btn-icon flex size-6 items-center justify-center rounded-md"
                        onClick={() => setIsTerminalOpen(false)}
                        type="button"
                      >
                        <X aria-hidden="true" className="size-3.5" />
                      </button>
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 px-2 pb-2">
                    <Suspense
                      fallback={
                        <div
                          aria-live="polite"
                          className="grid h-full place-items-center text-xs text-muted-foreground"
                        >
                          Opening terminal…
                        </div>
                      }
                    >
                      <LazyTerminalPane
                        key={activeWorkspace.id}
                        onShellExit={() => setIsTerminalOpen(false)}
                        paneId={TERMINAL_DRAWER_PANE_ID}
                        workspace={activeWorkspace}
                      />
                    </Suspense>
                  </div>
                </div>
              </section>
            ) : null}
          </div>
          <div className="fleet-drawer-shell" data-open={isFleetOpen}>
            <FleetDrawer
              isOpen={isFleetOpen}
              jevGates={jevGates?.effective ?? null}
              onClose={closeFleet}
              sessionId={activeManagedSessionId}
            />
          </div>
        </main>
      </div>
    </div>
  )
}
