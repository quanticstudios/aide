import { Globe } from 'lucide-react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import { MarkdownLink } from '../../MarkdownLink'
import type { ToolRenderer } from '.'
import ToolOutput from './ToolOutput'
import { readToolInput } from './tool-kind'

export interface WebLink {
  readonly title: string
  readonly url: string
}

/** Reads the `Links: [{title, url}]` list Claude's WebSearch result starts with. */
export function parseWebSearchLinks(output: string): WebLink[] {
  const json = /^Links: (\[.*\])$/m.exec(output)?.[1]
  if (!json) return []
  try {
    const links: unknown = JSON.parse(json)
    return Array.isArray(links)
      ? links.flatMap((link) =>
          link && typeof link.url === 'string' && /^https?:\/\//.test(link.url)
            ? [
                {
                  title: typeof link.title === 'string' ? link.title : link.url,
                  url: link.url,
                },
              ]
            : [],
        )
      : []
  } catch {
    return []
  }
}

const targetOf = (tool: ManagedSessionToolCall) =>
  readToolInput(tool, 'url') ??
  readToolInput(tool, 'query') ??
  tool.command ??
  ''

function WebToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const url = readToolInput(tool, 'url')
  const prompt = readToolInput(tool, 'prompt')
  const links = url ? [] : parseWebSearchLinks(tool.output ?? '')

  return (
    <div className="space-y-1 text-[12.5px]">
      {url ? (
        <p className="truncate">
          <MarkdownLink href={url}>{url}</MarkdownLink>
        </p>
      ) : null}
      {prompt ? <p className="text-muted-foreground">{prompt}</p> : null}
      {links.length > 0 ? (
        <ul className="space-y-0.5" data-testid="tool-call-links">
          {links.map((link) => (
            <li className="truncate" key={link.url}>
              <MarkdownLink href={link.url}>{link.title}</MarkdownLink>
            </li>
          ))}
        </ul>
      ) : null}
      {url && tool.output ? <ToolOutput output={tool.output} /> : null}
    </div>
  )
}

export const webTool: ToolRenderer = {
  Body: WebToolBody,
  icon: Globe,
  summary: targetOf,
}
