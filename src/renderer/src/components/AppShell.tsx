import type { ReactNode } from 'react'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import AppSidebar from './AppSidebar'
import TopBar from './TopBar'

interface AppShellProps {
  readonly activePaneId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
  readonly showProjectHints: boolean
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly children: ReactNode
}

export default function AppShell({
  activePaneId,
  projects,
  activeProject,
  activeWorkspace,
  isDemoMode,
  showProjectHints,
  onSelectPane,
  onSelectProject,
  onCreateProject,
  onCreateWorkspace,
  children,
}: AppShellProps) {
  return (
    <div className="grid h-full w-full grid-cols-[4.5rem_minmax(0,1fr)] bg-background text-foreground">
      <AppSidebar
        activeProjectId={activeProject?.id ?? null}
        isDemoMode={isDemoMode}
        onCreateProject={onCreateProject}
        onSelectProject={onSelectProject}
        projects={projects}
        showProjectHints={showProjectHints}
      />

      <div className="flex min-w-0 flex-col overflow-hidden">
        <TopBar
          activePaneId={activePaneId}
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          isDemoMode={isDemoMode}
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
