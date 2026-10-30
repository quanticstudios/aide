import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import { editTool } from './EditTool'
import { mcpTool } from './McpTool'
import { otherTool } from './OtherTool'
import { readTool } from './ReadTool'
import { searchTool } from './SearchTool'
import { shellTool } from './ShellTool'
import { subagentTool } from './SubagentTool'
import { todoTool } from './TodoTool'
import { type ToolKind, toolKind } from './tool-kind'
import { webTool } from './WebTool'

/** How one kind of tool call draws its header line and its expanded body. */
export interface ToolRenderer {
  readonly icon: LucideIcon
  readonly summary: (tool: ManagedSessionToolCall) => string
  readonly Body: (props: { readonly tool: ManagedSessionToolCall }) => ReactNode
}

const RENDERERS: Record<ToolKind, ToolRenderer> = {
  edit: editTool,
  mcp: mcpTool,
  other: otherTool,
  read: readTool,
  search: searchTool,
  shell: shellTool,
  subagent: subagentTool,
  todo: todoTool,
  'web-fetch': webTool,
  'web-search': webTool,
}

export function toolRenderer(tool: ManagedSessionToolCall): ToolRenderer {
  // why: Codex shell calls and older persisted calls carry a command under any tool name.
  if (tool.tasks) return todoTool
  const kind = toolKind(tool.toolName)
  return kind === 'other' && tool.command ? shellTool : RENDERERS[kind]
}
