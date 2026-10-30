import { FileText } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolFileChip from './ToolFileChip'
import { readToolInput } from './tool-kind'

const pathOf = (tool: ManagedSessionToolCall) =>
  readToolInput(tool, 'file_path') ?? tool.files?.[0]?.path ?? ''

function lineOf(tool: ManagedSessionToolCall, key: string): number | null {
  const value =
    tool.input && typeof tool.input === 'object'
      ? (tool.input as Record<string, unknown>)[key]
      : undefined
  return typeof value === 'number' && value > 0 ? value : null
}

/** The lines a Read call asked for, as "lines 10–59", "from line 10" or "whole file". */
export function readRange(tool: ManagedSessionToolCall): string {
  const offset = lineOf(tool, 'offset')
  const limit = lineOf(tool, 'limit')
  if (limit) return `lines ${offset ?? 1}–${(offset ?? 1) + limit - 1}`
  return offset ? `from line ${offset}` : 'whole file'
}

function ReadToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  return (
    <p className="flex items-center gap-2 text-[12px] text-muted-foreground">
      <ToolFileChip line={lineOf(tool, 'offset')} path={pathOf(tool)} />
      {readRange(tool)}
    </p>
  )
}

export const readTool: ToolRenderer = {
  Body: ReadToolBody,
  icon: FileText,
  summary: (tool) => `${pathOf(tool)} · ${readRange(tool)}`,
}
