import { type ReactNode, useState } from 'react'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import AppSidebar from './AppSidebar'
import TopBar from './TopBar'

interface AppShellProps {
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly children: ReactNode
}

export default function AppShell({
  projects,
  workspaces,
  activeProject,
  activeWorkspace,
  isDemoMode,
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
  children,
}: AppShellProps) {
  const [sidebarHovered, setSidebarHovered] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)

  return (
    <SidebarProvider
      className="h-full"
      defaultOpen={false}
      onOpenChange={setSidebarPinned}
      open={sidebarPinned || sidebarHovered}
    >
      <AppSidebar
        activeProjectId={activeProject?.id ?? null}
        activeWorkspaceId={activeWorkspace?.id ?? null}
        isDemoMode={isDemoMode}
        onCreateProject={onCreateProject}
        onCreateWorkspace={onCreateWorkspace}
        onSidebarHoverEnd={() => setSidebarHovered(false)}
        onSidebarHoverStart={() => setSidebarHovered(true)}
        onSidebarPinToggle={() => setSidebarPinned((value) => !value)}
        onSelectProject={onSelectProject}
        onSelectWorkspace={onSelectWorkspace}
        projects={projects}
        sidebarPinned={sidebarPinned}
        workspaces={workspaces}
      />

      <SidebarInset>
        <TopBar
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          isDemoMode={isDemoMode}
          onCreateWorkspace={onCreateWorkspace}
          onSelectWorkspace={onSelectWorkspace}
          workspaces={workspaces}
        />

        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
