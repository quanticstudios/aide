import { FileCode } from 'lucide-react'
import { lazy, Suspense } from 'react'
import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'
import type { ToolRenderer } from '.'
import ToolFileChip from './ToolFileChip'
import { readToolInput } from './tool-kind'

export const LazyGitDiffView = lazy(async () => ({
  default: (await import('../../GitDiffView')).GitDiffView,
}))

function EditToolBody({ tool }: { readonly tool: ManagedSessionToolCall }) {
  return (
    <>
      {tool.files && tool.files.length > 0 ? (
        <ul className="space-y-0.5 text-[12px] text-muted-foreground">
          {tool.files.map((file) => (
            <li
              className="flex items-center gap-2"
              key={`${file.status}:${file.path}`}
            >
              <ToolFileChip path={file.path} />
              {file.status}
            </li>
          ))}
        </ul>
      ) : null}
      {tool.diff ? (
        <div
          className="overflow-auto rounded-md border border-border"
          data-testid="tool-call-diff"
        >
          <Suspense fallback={null}>
            <LazyGitDiffView
              filePath={tool.files?.[0]?.path ?? 'file'}
              outputFormat="line-by-line"
              patch={tool.diff}
            />
          </Suspense>
        </div>
      ) : null}
    </>
  )
}

export const editTool: ToolRenderer = {
  Body: EditToolBody,
  icon: FileCode,
  summary: (tool) => {
    const files = tool.files ?? []
    const first = files[0]?.path ?? readToolInput(tool, 'file_path') ?? ''
    return files.length > 1 ? `${first} and ${files.length - 1} more` : first
  },
}
