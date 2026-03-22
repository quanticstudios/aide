import { Folder, GitBranch, LayoutGrid, Plus } from 'lucide-react'

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface AppSidebarProps {
  readonly projects: readonly ProjectRecord[]
  readonly workspaces: readonly WorkspaceRecord[]
  readonly activeProjectId: string | null
  readonly activeWorkspaceId: string | null
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
}

export default function AppSidebar({
  projects,
  workspaces,
  activeProjectId,
  activeWorkspaceId,
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
}: AppSidebarProps) {
  return (
    <Sidebar className="border-r border-sidebar-border" collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project) => {
                const isActive = project.id === activeProjectId
                const projectWorkspaces = workspaces.filter(
                  (ws) => ws.projectId === project.id,
                )

                return (
                  <SidebarMenuItem key={project.id}>
                    <SidebarMenuButton
                      isActive={isActive}
                      onClick={() => onSelectProject(project.id)}
                      size="lg"
                      tooltip={project.name}
                    >
                      <div
                        className={cn(
                          'flex size-[30px] shrink-0 items-center justify-center rounded-lg bg-secondary text-muted-foreground transition-colors',
                          isActive && 'bg-primary/10 text-primary',
                        )}
                      >
                        <Folder className="size-4" />
                      </div>
                      <div className="flex flex-col gap-0.5 overflow-hidden">
                        <span className="truncate text-sm font-medium">
                          {project.name}
                        </span>
                        <span className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                          <GitBranch className="size-3 shrink-0" />
                          {project.defaultBranch}
                        </span>
                      </div>
                    </SidebarMenuButton>

                    {isActive ? (
                      <SidebarMenuSub>
                        {projectWorkspaces.map((ws) => (
                          <SidebarMenuSubItem key={ws.id}>
                            <SidebarMenuSubButton
                              isActive={ws.id === activeWorkspaceId}
                              onClick={() => onSelectWorkspace(ws.id)}
                            >
                              <LayoutGrid />
                              <span>{ws.name}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                        <SidebarMenuSubItem>
                          <SidebarMenuSubButton
                            className="text-muted-foreground hover:text-primary"
                            onClick={onCreateWorkspace}
                          >
                            <Plus />
                            <span>Add workspace</span>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}

              <SidebarMenuItem>
                <SidebarMenuButton
                  className="mt-1 border border-dashed border-sidebar-border text-muted-foreground hover:border-primary hover:text-primary"
                  onClick={onCreateProject}
                  tooltip="New project"
                >
                  <Plus />
                  <span>New project</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarTrigger className="mx-auto" />
      </SidebarFooter>
    </Sidebar>
  )
}
