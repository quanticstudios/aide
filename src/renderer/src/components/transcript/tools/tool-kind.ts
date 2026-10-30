import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'

export type ToolKind =
  | 'shell'
  | 'read'
  | 'edit'
  | 'search'
  | 'web-fetch'
  | 'web-search'
  | 'todo'
  | 'subagent'
  | 'mcp'
  | 'other'

const KINDS_BY_NAME: Record<string, ToolKind> = {
  agent: 'subagent',
  bash: 'shell',
  bashoutput: 'shell',
  edit: 'edit',
  glob: 'search',
  grep: 'search',
  killbash: 'shell',
  killshell: 'shell',
  ls: 'search',
  multiedit: 'edit',
  notebookedit: 'edit',
  read: 'read',
  shell: 'shell',
  task: 'subagent',
  todowrite: 'todo',
  tool: 'mcp',
  'web search': 'web-search',
  webfetch: 'web-fetch',
  websearch: 'web-search',
  write: 'edit',
}

/** Which renderer a tool call gets, from the names Claude and Codex report. */
export function toolKind(toolName: string): ToolKind {
  const kind = KINDS_BY_NAME[toolName.toLowerCase()]
  if (kind) return kind
  // why: Claude names MCP tools `mcp__server__tool`; Codex reports `server.tool`.
  return toolName.startsWith('mcp__') || toolName.includes('.')
    ? 'mcp'
    : 'other'
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

const CLAUSES: Record<ToolKind, (count: number) => string> = {
  edit: (count) => `edited ${plural(count, 'file')}`,
  mcp: (count) => `called ${plural(count, 'MCP tool')}`,
  other: (count) => `used ${plural(count, 'other tool')}`,
  read: (count) => `read ${plural(count, 'file')}`,
  search: (count) => `ran ${plural(count, 'search', 'searches')}`,
  shell: (count) => `ran ${plural(count, 'command')}`,
  subagent: (count) => `ran ${plural(count, 'subagent')}`,
  todo: () => 'updated the task list',
  'web-fetch': (count) => `fetched ${plural(count, 'web page')}`,
  'web-search': (count) => `ran ${plural(count, 'web search', 'web searches')}`,
}

/** Plain-words summary of a run of tool calls, such as "Read 3 files, ran 2 commands, edited 1 file". */
export function summarizeToolGroup(toolNames: readonly string[]): string {
  const counts = new Map<ToolKind, number>()
  for (const name of toolNames) {
    const kind = toolKind(name)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  const summary = [...counts]
    .map(([kind, count]) => CLAUSES[kind](count))
    .join(', ')
  return summary.charAt(0).toUpperCase() + summary.slice(1)
}

/** The string at `key` of a tool call's input, if there is one. */
export function readToolInput(
  tool: ManagedSessionToolCall,
  key: string,
): string | undefined {
  const value =
    tool.input && typeof tool.input === 'object'
      ? (tool.input as Record<string, unknown>)[key]
      : undefined
  return typeof value === 'string' && value ? value : undefined
}
