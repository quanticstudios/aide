import { FileCode } from 'lucide-react'
import {
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  useContext,
  useState,
} from 'react'
import type { ExtraProps } from 'react-markdown'

import {
  parseWorkspaceFilePath,
  type WorkspaceFilePath,
} from '../lib/markdown-file-paths'
import { cn } from '../lib/utils'
import { WorkspaceIdContext } from '../lib/workspace-id'

/** A workspace file that opens in the editor at its line when clicked. */
export function FileChip({
  children,
  file,
  workspaceId,
}: {
  readonly children: ReactNode
  readonly file: WorkspaceFilePath
  readonly workspaceId: string
}) {
  const [error, setError] = useState<string | null>(null)
  const location = file.line ? `${file.path}:${file.line}` : file.path
  return (
    <button
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-[5px] border border-border bg-surface-2 px-1.5 align-baseline font-mono text-[0.86em] text-foreground hover:bg-surface-3',
        error && 'text-destructive',
      )}
      onClick={() => {
        setError(null)
        window.aide
          ?.openWorkspaceFile(workspaceId, file.path, file.line)
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          )
      }}
      title={error ?? `Open ${location} in editor`}
      type="button"
    >
      <FileCode aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </button>
  )
}

/** Markdown links open in the system browser through main; workspace file paths render as chips. */
export function MarkdownLink({
  children,
  href,
}: ComponentProps<'a'> & ExtraProps) {
  const workspaceId = useContext(WorkspaceIdContext)
  const file = href ? parseWorkspaceFilePath(href) : null
  if (file && workspaceId) {
    return (
      <FileChip file={file} workspaceId={workspaceId}>
        {children}
      </FileChip>
    )
  }
  // why: react-markdown drops unsafe hrefs such as javascript:, which leaves nothing to open.
  if (!href) return <span>{children}</span>
  const open = (event: MouseEvent) => {
    event.preventDefault()
    void window.aide?.openExternal(href)
  }
  return (
    <a
      href={href}
      onAuxClick={(event) => event.button === 1 && open(event)}
      onClick={open}
      title={href}
    >
      {children}
    </a>
  )
}

/** Remote images load lazily, send no referrer, and stay within the reply's width and a fixed height. */
export function MarkdownImage({
  alt = '',
  src,
  title,
}: ComponentProps<'img'> & ExtraProps) {
  return (
    <img
      alt={alt}
      className="max-h-96 max-w-full"
      decoding="async"
      loading="lazy"
      referrerPolicy="no-referrer"
      src={src}
      title={title}
    />
  )
}
