import { Button, Chip, ScrollShadow, Surface } from '@heroui/react'
import {
  ChevronRight,
  GitBranch,
  LayoutGrid,
  PanelLeftClose,
} from 'lucide-react'
import { useEffect, useState } from 'react'

import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import WorkspaceStateBadges from './WorkspaceStateBadges'

interface ProjectWorkspaceTreeProps {
  readonly activeProjectId: string | null
  readonly activeWorkspaceId: string | null
  readonly isExpanded: boolean
  readonly isPinnedOpen: boolean
  readonly onSelectProject: (projectId: string) => void
  readonly onTogglePinnedOpen: () => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly projects: readonly ProjectRecord[]
  readonly summaries: Record<string, WorkspaceSummary>
  readonly workspaces: readonly WorkspaceRecord[]
}

export default function ProjectWorkspaceTree({
  activeProjectId,
  activeWorkspaceId,
  isExpanded,
  isPinnedOpen,
  onSelectProject,
  onTogglePinnedOpen,
  onSelectWorkspace,
  projects,
  summaries,
  workspaces,
}: ProjectWorkspaceTreeProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<
    Record<string, boolean>
  >({})

  useEffect(() => {
    if (!activeProjectId) {
      return
    }

    setExpandedProjectIds((current) => ({
      ...current,
      [activeProjectId]: true,
    }))
  }, [activeProjectId])

  return (
    <aside
      className={cn(
        'flex h-full flex-col overflow-hidden border-r border-border bg-card/55 transition-[width,opacity] duration-180 ease-out',
        isExpanded ? 'w-72 opacity-100' : 'w-0 opacity-0',
      )}
      data-expanded={isExpanded ? 'true' : 'false'}
      data-testid="workspace-tree-panel"
    >
      {isExpanded ? (
        <>
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
                Workspace tree
              </p>
              <p className="mt-1 text-sm text-foreground/90">
                Project groups and active workspace targets.
              </p>
            </div>

            <Button
              aria-label={isPinnedOpen ? 'Unpin sidebar' : 'Pin sidebar open'}
              className={cn(
                'size-8 shrink-0 rounded-xl',
                isPinnedOpen && 'border-primary/50 bg-primary/10 text-primary',
              )}
              isIconOnly
              onPress={onTogglePinnedOpen}
              size="sm"
              variant="ghost"
            >
              <PanelLeftClose className="size-4" />
            </Button>
          </div>

          <ScrollShadow className="min-h-0 flex-1" hideScrollBar size={36}>
            <div className="space-y-3 p-3">
              {projects.map((project) => {
                const projectWorkspaces = workspaces.filter(
                  (workspace) => workspace.projectId === project.id,
                )
                const isActiveProject = project.id === activeProjectId
                const isProjectExpanded =
                  expandedProjectIds[project.id] ?? isActiveProject

                function toggleProject(): void {
                  setExpandedProjectIds((current) => ({
                    ...current,
                    [project.id]: !(current[project.id] ?? isActiveProject),
                  }))
                }

                return (
                  <Surface
                    className={cn(
                      'rounded-2xl border border-border/70 p-3',
                      isActiveProject
                        ? 'bg-surface-secondary'
                        : 'bg-surface/70',
                    )}
                    key={project.id}
                    variant={isActiveProject ? 'secondary' : 'tertiary'}
                  >
                    <div className="flex items-center gap-2">
                      <button
                        aria-label={`Toggle ${project.name} workspaces`}
                        aria-expanded={isProjectExpanded}
                        className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border/70 bg-background/50 text-muted-foreground transition-colors hover:text-foreground"
                        onClick={toggleProject}
                        type="button"
                      >
                        <ChevronRight
                          className={cn(
                            'size-4 transition-transform',
                            isProjectExpanded ? 'rotate-90' : 'rotate-0',
                          )}
                        />
                      </button>

                      <button
                        aria-current={isActiveProject ? 'true' : undefined}
                        className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                        onClick={() => onSelectProject(project.id)}
                        type="button"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-foreground">
                            {project.name}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                            <GitBranch className="size-3" />
                            <span className="truncate">
                              {project.defaultBranch}
                            </span>
                          </div>
                        </div>

                        <Chip size="sm" variant="secondary">
                          {projectWorkspaces.length}
                        </Chip>
                      </button>
                    </div>

                    <div
                      className={cn(
                        'mt-3 space-y-2',
                        !isProjectExpanded && 'hidden',
                      )}
                    >
                      {projectWorkspaces.map((workspace) => {
                        const isActiveWorkspace =
                          workspace.id === activeWorkspaceId
                        const summary = summaries[workspace.id]

                        return (
                          <Button
                            className={cn(
                              'h-auto w-full justify-between rounded-xl px-3 py-3',
                              isActiveWorkspace
                                ? 'border-primary/50 bg-primary/10'
                                : 'border-border/60 bg-background/35',
                            )}
                            key={workspace.id}
                            onPress={() => onSelectWorkspace(workspace.id)}
                            variant={isActiveWorkspace ? 'secondary' : 'ghost'}
                          >
                            <div className="flex min-w-0 items-start gap-3 text-left">
                              <div className="mt-0.5 rounded-lg border border-border/70 bg-background/60 p-1.5 text-muted-foreground">
                                <LayoutGrid className="size-3.5" />
                              </div>
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {summary?.workspaceName ?? workspace.name}
                                </p>
                                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                                  {summary?.branchName ?? workspace.branchName}
                                </p>
                              </div>
                            </div>

                            {summary ? (
                              <WorkspaceStateBadges
                                isCurrent={isActiveWorkspace}
                                summary={summary}
                              />
                            ) : null}
                          </Button>
                        )
                      })}
                    </div>
                  </Surface>
                )
              })}
            </div>
          </ScrollShadow>
        </>
      ) : null}
    </aside>
  )
}
