import { Plug } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolOutput from './ToolOutput'
import { readToolInput } from './tool-kind'

/** Server, tool and arguments of an MCP call, from Claude's `mcp__server__tool` name or a Codex item. */
export function readMcpCall(tool: ManagedSessionToolCall): {
  arguments: unknown
  server: string
  tool: string
} {
  if (tool.toolName.startsWith('mcp__')) {
    const [, server = '', ...name] = tool.toolName.split('__')
    return { arguments: tool.input, server, tool: name.join('__') }
  }
  const [server = '', ...name] = tool.toolName.split('.')
  return {
    arguments:
      tool.input && typeof tool.input === 'object'
        ? (tool.input as Record<string, unknown>).arguments
        : undefined,
    server: readToolInput(tool, 'server') ?? server,
    tool: readToolInput(tool, 'tool') ?? name.join('.'),
  }
}

function McpToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const call = readMcpCall(tool)

  return (
    <>
      <p className="text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">{call.server}</span> ·{' '}
        <span className="font-mono">{call.tool}</span>
      </p>
      {call.arguments !== undefined ? (
        <pre
          className="overflow-auto rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[12px] leading-[1.5] text-foreground"
          data-testid="tool-call-arguments"
        >
          {JSON.stringify(call.arguments, null, 2)}
        </pre>
      ) : null}
      {tool.output ? <ToolOutput output={tool.output} /> : null}
    </>
  )
}

export const mcpTool: ToolRenderer = {
  Body: McpToolBody,
  icon: Plug,
  summary: (tool) => {
    const call = readMcpCall(tool)
    return `${call.server} · ${call.tool}`
  },
}
