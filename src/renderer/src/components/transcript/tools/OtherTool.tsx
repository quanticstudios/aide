import { Wrench } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolOutput from './ToolOutput'
import { readToolInput } from './tool-kind'

function OtherToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  return (
    <>
      {tool.input !== undefined ? (
        <pre className="overflow-auto rounded-md bg-surface-2 px-2 py-1.5 font-mono text-[12px] leading-[1.5] text-foreground">
          {JSON.stringify(tool.input, null, 2)}
        </pre>
      ) : null}
      {tool.output ? <ToolOutput output={tool.output} /> : null}
    </>
  )
}

export const otherTool: ToolRenderer = {
  Body: OtherToolBody,
  icon: Wrench,
  summary: (tool) =>
    readToolInput(tool, 'description') ?? tool.files?.[0]?.path ?? '',
}
