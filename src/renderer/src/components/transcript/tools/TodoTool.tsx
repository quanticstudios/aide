import { ListChecks } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import TaskListBlock from '../TaskListBlock'
import type { ToolRenderer } from '.'

function TodoToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  return (
    <TaskListBlock
      isRunning={tool.status === 'running'}
      tasks={tool.tasks ?? []}
    />
  )
}

export const todoTool: ToolRenderer = {
  Body: TodoToolBody,
  icon: ListChecks,
  summary: (tool) => {
    const tasks = tool.tasks ?? []
    const done = tasks.filter((task) => task.status === 'completed').length
    return `${done}/${tasks.length} tasks done`
  },
}
