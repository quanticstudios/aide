import type { ReactNode } from 'react'

import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import AppSidebar from './AppSidebar'
import ProjectWorkspaceTree from './ProjectWorkspaceTree'
import TopBar from './TopBar'

interface AppShellProps {
  readonly activePaneId: string | null
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly isDemoMode: boolean
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
  return (
    <div className="grid h-full w-full grid-cols-[4.5rem_18rem_minmax(0,1fr)] bg-background text-foreground">
      <AppSidebar
        activeProjectId={activeProject?.id ?? null}
        isDemoMode={isDemoMode}
        onCreateProject={onCreateProject}
        onSelectProject={onSelectProject}
        projects={projects}
        showProjectHints={showProjectHints}
      />

      <ProjectWorkspaceTree
        activeProjectId={activeProject?.id ?? null}
        activeWorkspaceId={activeWorkspace?.id ?? null}
        onSelectProject={onSelectProject}
        onSelectWorkspace={onSelectWorkspace}
        projects={projects}
        summaries={workspaceSummaries}
        workspaces={workspaces}
      />

      <div className="flex min-w-0 flex-col overflow-hidden">
        <TopBar
          activePaneId={activePaneId}
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          isDemoMode={isDemoMode}
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
