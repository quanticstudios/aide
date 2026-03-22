import type { ReactNode } from 'react'

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
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
  children,
}: AppShellProps) {
  return (
    <SidebarProvider className="h-full" defaultOpen={false}>
      <AppSidebar
        activeProjectId={activeProject?.id ?? null}
        activeWorkspaceId={activeWorkspace?.id ?? null}
        onCreateProject={onCreateProject}
        onCreateWorkspace={onCreateWorkspace}
        onSelectProject={onSelectProject}
        onSelectWorkspace={onSelectWorkspace}
        projects={projects}
        workspaces={workspaces}
      />

      <SidebarInset>
        <TopBar
          activeProject={activeProject}
          activeWorkspace={activeWorkspace}
          onCreateWorkspace={onCreateWorkspace}
          onSelectWorkspace={onSelectWorkspace}
          workspaces={workspaces}
        />

        <main className="flex flex-1 flex-col overflow-hidden">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}
