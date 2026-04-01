import { Button, Chip, Tooltip } from '@heroui/react'
import { FolderKanban, Plus } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { ProjectRecord } from '../../../shared/persistence'

interface AppSidebarProps {
  readonly projects: readonly ProjectRecord[]
  readonly activeProjectId: string | null
  readonly onSelectProject: (projectId: string) => void
  readonly onCreateProject: () => void
  readonly showProjectHints: boolean
}

function getProjectGlyph(projectName: string): string {
  const [first = '', second = ''] = projectName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  return (
    `${first}${second}`.slice(0, 2).toUpperCase() ||
    projectName.slice(0, 2).toUpperCase()
  )
}

export default function AppSidebar({
  projects,
  activeProjectId,
  onSelectProject,
  onCreateProject,
  showProjectHints,
}: AppSidebarProps) {
  return (
    <aside className="flex h-full w-[4.5rem] flex-col items-center border-r border-border bg-card/70 px-2 py-3">
      <div className="flex size-10 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground shadow-sm">
        <FolderKanban className="size-4" />
      </div>

      <div className="mt-6 flex flex-1 flex-col items-center gap-3">
        {projects.map((project, index) => {
          const isActive = project.id === activeProjectId

          return (
            <Tooltip delay={120} key={project.id}>
              <Tooltip.Trigger>
                <Button
                  aria-label={project.name}
                  data-testid={`project-rail-button-${project.id}`}
                  className={cn(
                    'group relative flex size-12 items-center justify-center rounded-2xl border text-sm font-semibold tracking-[0.12em] transition-all',
                    isActive
                      ? 'border-primary/60 bg-primary/12 text-primary shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                      : 'border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground',
                  )}
                  onPress={() => onSelectProject(project.id)}
                  variant="ghost"
                >
                  <span>{getProjectGlyph(project.name)}</span>
                  <span
                    data-testid={`project-rail-hint-shell-${project.id}`}
                    className={cn(
                      'absolute -right-1.5 -top-1.5 transition-all duration-120 ease-out',
                      showProjectHints
                        ? 'visible scale-100 opacity-100'
                        : 'invisible scale-75 opacity-0',
                    )}
                  >
                    <Chip
                      className="h-4 min-w-4 border border-border bg-background px-0 text-[9px] font-medium text-muted-foreground"
                      color="default"
                      data-testid={`project-rail-hint-${project.id}`}
                      size="sm"
                      variant="secondary"
                    >
                      {index + 1}
                    </Chip>
                  </span>
                </Button>
              </Tooltip.Trigger>
              <Tooltip.Content className="rounded-xl border border-border bg-overlay/98 px-2.5 py-1.5 text-xs text-foreground shadow-[var(--overlay-shadow)]">
                {index + 1}. {project.name}
              </Tooltip.Content>
            </Tooltip>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button
          aria-label="Open project"
          className="size-10 rounded-2xl"
          isIconOnly
          onPress={onCreateProject}
          size="md"
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>

        <Chip
          className="rounded-2xl border border-border bg-background px-2 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
          color="default"
          size="sm"
          variant="secondary"
        >
          {projects.length}
        </Chip>
      </div>
    </aside>
  )
}
