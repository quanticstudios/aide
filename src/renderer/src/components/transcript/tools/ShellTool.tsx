import { Terminal } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolOutput from './ToolOutput'
import { readToolInput } from './tool-kind'

const commandOf = (tool: ManagedSessionToolCall) =>
  tool.command ?? readToolInput(tool, 'command') ?? ''

function ShellToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const command = commandOf(tool)

  return (
    <>
      {command ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-foreground">
          <span className="select-none text-muted-foreground">$ </span>
          {command}
        </pre>
      ) : null}
      {tool.output ? <ToolOutput output={tool.output} /> : null}
    </>
  )
}

export const shellTool: ToolRenderer = {
  Body: ShellToolBody,
  icon: Terminal,
  summary: commandOf,
}
