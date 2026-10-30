import { Search } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolFileChip from './ToolFileChip'
import { readToolInput } from './tool-kind'

export interface SearchMatch {
  readonly line: number | null
  readonly path: string | null
  readonly text: string
}

const MATCH = /^(\S[^:]*):(\d+)[:-](.*)$/
const PATH = /^[^\s:]*[/.][^\s:]*$/

/** Reads Grep and Glob output: `path:line:text` matches, bare paths, and anything else as a note. */
export function parseSearchMatches(output: string): SearchMatch[] {
  return output
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const match = MATCH.exec(line)
      if (match?.[1] && match[2])
        return { line: Number(match[2]), path: match[1], text: match[3] ?? '' }
      return PATH.test(line)
        ? { line: null, path: line, text: '' }
        : { line: null, path: null, text: line }
    })
}

function SearchToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const matches = parseSearchMatches(tool.output ?? '')

  return matches.length > 0 ? (
    <ul
      className="max-h-80 space-y-0.5 overflow-auto text-[12px]"
      data-testid="tool-call-matches"
    >
      {matches.map((match, index) => (
        <li
          className="flex min-w-0 items-center gap-2"
          // biome-ignore lint/suspicious/noArrayIndexKey: output lines can repeat and have no other identity.
          key={index}
        >
          {match.path ? (
            <ToolFileChip line={match.line} path={match.path} />
          ) : null}
          {match.text ? (
            <span className="truncate font-mono text-muted-foreground">
              {match.text}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  ) : null
}

export const searchTool: ToolRenderer = {
  Body: SearchToolBody,
  icon: Search,
  summary: (tool) => {
    const pattern = readToolInput(tool, 'pattern') ?? ''
    const path = readToolInput(tool, 'path')
    return path ? `${pattern} in ${path}` : pattern
  },
}
