import { FolderKanban, Plus } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { ProjectRecord } from '../../../shared/persistence'

interface AppSidebarProps {
  readonly projects: readonly ProjectRecord[]
  readonly activeProjectId: string | null
  readonly isDemoMode: boolean
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
  isDemoMode,
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
            <button
              aria-label={project.name}
              className={cn(
                'group relative flex size-12 items-center justify-center rounded-2xl border text-sm font-semibold tracking-[0.12em] transition-all',
                isActive
                  ? 'border-primary/60 bg-primary/12 text-primary shadow-[0_0_0_1px_rgba(94,234,212,0.12)]'
                  : 'border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground',
              )}
              key={project.id}
              onClick={() => onSelectProject(project.id)}
              title={`${index + 1}. ${project.name}`}
              type="button"
            >
              <span>{getProjectGlyph(project.name)}</span>
              <span
                className={cn(
                  'absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full border border-border bg-background text-[9px] font-medium text-muted-foreground transition-all duration-120 ease-out',
                  showProjectHints
                    ? 'scale-100 opacity-100'
                    : 'scale-75 opacity-0',
                )}
              >
                {index + 1}
              </span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col items-center gap-2">
        {!isDemoMode ? (
          <Button
            className="size-10 rounded-2xl"
            onClick={onCreateProject}
            size="icon"
            title="Create project"
            type="button"
            variant="ghost"
          >
            <Plus className="size-4" />
          </Button>
        ) : null}

        <div className="rounded-2xl border border-border px-2 py-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {projects.length}
        </div>
      </div>
    </aside>
  )
}
