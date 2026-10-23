import { Check, ChevronRight, Circle, LoaderCircle } from 'lucide-react'
import { memo } from 'react'
import type { ManagedSessionTask } from '../../../../shared/managed-session'
import { cn } from '../../lib/utils'

export default memo(function TaskListBlock({
  isRunning,
  tasks,
}: {
  readonly isRunning: boolean
  readonly tasks: readonly ManagedSessionTask[]
}) {
  const completed = tasks.filter((task) => task.status === 'completed').length

  return (
    <details
      className="group/tasks overflow-hidden rounded-lg border border-[var(--border-soft)] bg-surface-1"
      data-testid="managed-task-list"
      open={isRunning}
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground">
        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-open/tasks:rotate-90" />
        Tasks
        <span className="ml-auto text-[11px] font-medium tabular-nums text-muted-foreground">
          {completed}/{tasks.length}
        </span>
      </summary>
      <ul className="space-y-1 border-t border-[var(--border-soft)] px-3 py-2">
        {tasks.map((task) => (
          <li
            className={cn(
              'flex items-center gap-2 text-[13px]',
              task.status === 'in_progress'
                ? 'font-medium text-foreground'
                : 'text-muted-foreground',
              task.status === 'completed' && 'line-through',
            )}
            data-testid={`managed-task-${task.status}`}
            key={task.subject}
          >
            {task.status === 'completed' ? (
              <Check className="size-3.5 shrink-0 text-accent-green" />
            ) : task.status === 'in_progress' ? (
              <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary-on-dark" />
            ) : (
              <Circle className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate">{task.subject}</span>
          </li>
        ))}
      </ul>
    </details>
  )
})
