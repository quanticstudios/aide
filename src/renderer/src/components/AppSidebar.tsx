import { Folder, GitBranch, LayoutGrid, Pin, PinOff, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  SidebarSeparator,
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
  readonly isDemoMode: boolean
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onSidebarHoverEnd: () => void
  readonly onSidebarHoverStart: () => void
  readonly onSidebarPinToggle: () => void
  readonly sidebarPinned: boolean
}

export default function AppSidebar({
  projects,
  workspaces,
  activeProjectId,
  activeWorkspaceId,
  isDemoMode,
  onSelectProject,
  onSelectWorkspace,
  onCreateProject,
  onCreateWorkspace,
  onSidebarHoverEnd,
  onSidebarHoverStart,
  onSidebarPinToggle,
  sidebarPinned,
}: AppSidebarProps) {
  return (
    <Sidebar
      className="border-r border-sidebar-border bg-sidebar/95 backdrop-blur"
      collapsible="icon"
      onMouseEnter={onSidebarHoverStart}
      onMouseLeave={onSidebarHoverEnd}
    >
      <SidebarHeader className="gap-3 border-b border-sidebar-border/80 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 group-data-[collapsible=icon]:hidden">
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-sidebar-foreground/60">
              aide
            </p>
            <p className="truncate text-sm font-semibold text-sidebar-foreground">
              Navigation POC
            </p>
          </div>

          <button
            aria-label={sidebarPinned ? 'Unpin sidebar' : 'Pin sidebar'}
            className="flex size-8 items-center justify-center rounded-md text-sidebar-foreground/70 transition hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            onClick={onSidebarPinToggle}
            type="button"
          >
            {sidebarPinned ? (
              <PinOff className="size-4" />
            ) : (
              <Pin className="size-4" />
            )}
          </button>
        </div>

        <div className="flex items-center gap-2 group-data-[collapsible=icon]:hidden">
          <Badge
            className="rounded-full px-2 py-0 text-[10px] uppercase tracking-[0.18em]"
            variant="secondary"
          >
            {isDemoMode ? 'Demo data' : 'Live data'}
          </Badge>
          <span className="text-xs text-sidebar-foreground/60">
            Hover expands, pin locks.
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Projects</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {projects.map((project, index) => {
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
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {project.name}
                          </span>
                          <span className="rounded-full border border-sidebar-border px-1.5 py-0.5 font-mono text-[10px] text-sidebar-foreground/55">
                            {index + 1}
                          </span>
                        </div>
                        <span className="flex items-center gap-1 truncate font-mono text-[11px] text-muted-foreground">
                          <GitBranch className="size-3 shrink-0" />
                          {project.defaultBranch}
                          <span className="text-sidebar-foreground/40">·</span>
                          {projectWorkspaces.length} workspaces
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
                              <span className="ml-auto size-2 rounded-full bg-emerald-400/80" />
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                        {!isDemoMode ? (
                          <SidebarMenuSubItem>
                            <SidebarMenuSubButton
                              className="text-muted-foreground hover:text-primary"
                              onClick={onCreateWorkspace}
                            >
                              <Plus />
                              <span>Add workspace</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ) : null}
                      </SidebarMenuSub>
                    ) : null}
                  </SidebarMenuItem>
                )
              })}

              {!isDemoMode ? (
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
              ) : null}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />

      <SidebarFooter>
        <div className="flex items-center justify-between gap-2 group-data-[collapsible=icon]:justify-center">
          <SidebarTrigger className="mx-0" />
          <p className="text-xs text-sidebar-foreground/55 group-data-[collapsible=icon]:hidden">
            Spatial navigation first.
          </p>
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
