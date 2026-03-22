import { GitBranch, Plus } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

interface TopBarProps {
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly workspaces: readonly WorkspaceRecord[]
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onCreateWorkspace: () => void
}

export default function TopBar({
  activeProject,
  activeWorkspace,
  workspaces,
  onSelectWorkspace,
  onCreateWorkspace,
}: TopBarProps) {
  const projectWorkspaces = activeProject
    ? workspaces.filter((ws) => ws.projectId === activeProject.id)
    : []

  return (
    <header className="flex h-10 items-center gap-4 border-b border-border bg-background px-4">
      <span className="shrink-0 text-sm font-bold text-muted-foreground">
        aide
      </span>

      <nav className="flex h-full flex-1 items-stretch overflow-x-auto">
        {projectWorkspaces.map((ws) => (
          <button
            className={cn(
              'flex items-center border-b-2 border-transparent px-3 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
              ws.id === activeWorkspace?.id && 'border-primary text-foreground',
            )}
            key={ws.id}
            onClick={() => onSelectWorkspace(ws.id)}
            type="button"
          >
            {ws.name}
          </button>
        ))}

        {activeProject ? (
          <Button
            className="my-auto ml-1 size-6"
            onClick={onCreateWorkspace}
            size="icon"
            title="New workspace"
            variant="ghost"
          >
            <Plus className="size-3.5" />
          </Button>
        ) : null}
      </nav>

      <Badge
        className="shrink-0 gap-1.5 font-mono text-[11px]"
        variant="secondary"
      >
        {activeProject ? (
          <>
            <span>{activeProject.name}</span>
            <span className="text-muted-foreground">/</span>
            <GitBranch className="size-3" />
            <span>
              {activeWorkspace?.branchName ?? activeProject.defaultBranch}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">No project</span>
        )}
      </Badge>
    </header>
  )
}
