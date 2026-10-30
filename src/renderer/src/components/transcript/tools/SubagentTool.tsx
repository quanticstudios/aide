import { Bot } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import MarkdownContent from '../../MarkdownContent'
import type { ToolRenderer } from '.'
import { readToolInput, summarizeToolGroup } from './tool-kind'

function SubagentToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const agent = readToolInput(tool, 'subagent_type')
  const tools = tool.subagentTools ?? []

  return (
    <div className="space-y-2 text-[12.5px]">
      <p
        className="text-muted-foreground"
        data-testid="tool-call-subagent-summary"
      >
        {agent ? (
          <span className="font-medium text-foreground">{agent} · </span>
        ) : null}
        {tools.length === 0
          ? 'No tool calls'
          : `${tools.length === 1 ? '1 tool call' : `${tools.length} tool calls`}: ${summarizeToolGroup(tools)}`}
      </p>
      {tool.output ? (
        <div
          className="border-l border-border pl-3 text-[13px]"
          data-testid="tool-call-output"
        >
          <MarkdownContent text={tool.output} />
        </div>
      ) : null}
    </div>
  )
}

export const subagentTool: ToolRenderer = {
  Body: SubagentToolBody,
  icon: Bot,
  summary: (tool) =>
    readToolInput(tool, 'description') ?? readToolInput(tool, 'prompt') ?? '',
}
