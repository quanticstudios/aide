import type { FocusEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import type { WorkspaceLayoutPresetId } from '@/lib/workspace-layout-presets'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import AppSidebar from './AppSidebar'
import ProjectWorkspaceTree from './ProjectWorkspaceTree'
import TopBar from './TopBar'

const SIDEBAR_PIN_STORAGE_KEY = 'aide.sidebar.pinned'
const SIDEBAR_COLLAPSE_DELAY_MS = 140

interface AppShellProps {
  readonly activePaneId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly onApplyLayoutPreset: (presetId: WorkspaceLayoutPresetId) => void
  readonly paneIds: readonly string[]
  readonly showProjectHints: boolean
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly workspaceSummaries: Record<string, WorkspaceSummary>
  readonly children: ReactNode
}

export default function AppShell({
  activePaneId,
  projects,
  workspaces,
  activeProject,
  activeWorkspace,
  isDemoMode,
  onApplyLayoutPreset,
  paneIds,
  showProjectHints,
  onSelectPane,
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
  workspaceSummaries,
  children,
}: AppShellProps) {
  const sidebarShellRef = useRef<HTMLDivElement | null>(null)
  const collapseTimerRef = useRef<number | null>(null)
  const [isSidebarHovered, setIsSidebarHovered] = useState(false)
  const [isSidebarFocusWithin, setIsSidebarFocusWithin] = useState(false)
  const [isSidebarPinnedOpen, setIsSidebarPinnedOpen] = useState(() => {
    if (typeof window === 'undefined') {
      return false
    }

    return window.localStorage.getItem(SIDEBAR_PIN_STORAGE_KEY) === 'true'
  })

  const isSidebarExpanded =
    isSidebarPinnedOpen || isSidebarHovered || isSidebarFocusWithin

  function clearPendingCollapse(): void {
    if (collapseTimerRef.current === null) {
      return
    }

    window.clearTimeout(collapseTimerRef.current)
    collapseTimerRef.current = null
  }

  function scheduleSidebarCollapse(): void {
    clearPendingCollapse()
    collapseTimerRef.current = window.setTimeout(() => {
      setIsSidebarHovered(false)
    }, SIDEBAR_COLLAPSE_DELAY_MS)
  }

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

  function handleSidebarFocus(): void {
    clearPendingCollapse()
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

  function handleSidebarMouseEnter(): void {
    clearPendingCollapse()
    setIsSidebarHovered(true)
  }

  function handleSidebarMouseLeave(): void {
    if (isSidebarPinnedOpen || isSidebarFocusWithin) {
      return
    }

    scheduleSidebarCollapse()
  }

  return (
    <div className="flex h-full w-full bg-background text-foreground">
      <div
        className="flex h-full"
        data-expanded={isSidebarExpanded ? 'true' : 'false'}
        data-testid="sidebar-shell"
        onBlurCapture={handleSidebarBlur}
        onFocusCapture={handleSidebarFocus}
        onMouseEnter={handleSidebarMouseEnter}
        onMouseLeave={handleSidebarMouseLeave}
        ref={sidebarShellRef}
      >
        <AppSidebar
          activeProjectId={activeProject?.id ?? null}
          isDemoMode={isDemoMode}
          onCreateProject={onCreateProject}
          onSelectProject={onSelectProject}
          projects={projects}
          showProjectHints={showProjectHints}
        />

        <ProjectWorkspaceTree
          activeProjectId={
            activeWorkspace?.projectId ?? activeProject?.id ?? null
          }
          activeWorkspaceId={activeWorkspace?.id ?? null}
          isExpanded={isSidebarExpanded}
          isPinnedOpen={isSidebarPinnedOpen}
          onSelectProject={onSelectProject}
          onTogglePinnedOpen={() =>
            setIsSidebarPinnedOpen((current) => !current)
          }
          onSelectWorkspace={onSelectWorkspace}
          projects={projects}
          summaries={workspaceSummaries}
          workspaces={workspaces}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          activePaneId={activePaneId}
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          isDemoMode={isDemoMode}
          onApplyLayoutPreset={onApplyLayoutPreset}
          paneIds={paneIds}
          onSelectPane={onSelectPane}
          onCreateWorkspace={onCreateWorkspace}
        />

        <main className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
