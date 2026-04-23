import type { FocusEvent, ReactNode } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import SidebarTree from './SidebarTree'
import TopBar from './TopBar'

const SIDEBAR_PIN_STORAGE_KEY = 'aide.sidebar.pinned'
const SIDEBAR_COLLAPSE_DELAY_MS = 140

interface AppShellProps {
  readonly activeSurfaceId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onCreatePane: () => void
  readonly surfaces: readonly WorkspaceSurfaceRecord[]
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
  activeSurfaceId,
  projects,
  workspaces,
  activeProject,
  activeWorkspace,
  onCreatePane,
  surfaces,
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

      const bounds = sidebarShell.getBoundingClientRect()
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
    isSidebarPinnedOpen,
    sidebarContainsActiveElement,
  ])

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
        className="flex h-full"
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
          onSelectProject={onSelectProject}
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
          activeSurfaceId={activeSurfaceId}
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          onCreatePane={onCreatePane}
          surfaces={surfaces}
          onSelectPane={onSelectPane}
        />

        <main className="relative flex min-h-0 w-full flex-1 flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  )
}
