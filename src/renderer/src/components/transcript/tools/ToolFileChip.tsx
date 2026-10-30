import { useContext } from 'react'
import { WorkspaceIdContext } from '../../../lib/workspace-id'
import { FileChip } from '../../MarkdownLink'

/** A file a tool touched, as the same chip replies use; plain text outside a workspace. */
export default function ToolFileChip({
  line = null,
  path,
}: {
  readonly line?: number | null
  readonly path: string
}) {
  const workspaceId = useContext(WorkspaceIdContext)
  const label = line ? `${path}:${line}` : path

  return workspaceId ? (
    <FileChip file={{ line, path }} workspaceId={workspaceId}>
      {label}
    </FileChip>
  ) : (
    <span className="font-mono text-[12px] text-foreground">{label}</span>
  )
}
