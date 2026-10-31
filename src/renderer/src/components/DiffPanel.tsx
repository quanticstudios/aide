import { X } from 'lucide-react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import type { TurnCheckpointDiff } from '../../../shared/checkpoints'
import type { WorkspaceDiffScope } from '../../../shared/git'
import type { DaemonReviewThread } from '../lib/daemon-transport'
import { threadsByLine } from '../lib/pull-request'
import { getSessionTransport } from '../lib/session-transport'
import { cn } from '../lib/utils'
import ChangedFilesTree from './ChangedFilesTree'
import { LazyGitDiffView } from './transcript/ToolCallBlock'

const SCOPES: readonly (readonly [WorkspaceDiffScope, string])[] = [
  ['turn', 'Turn'],
  ['branch', 'Branch'],
  ['uncommitted', 'Uncommitted'],
]

async function loadScopeDiff(
  scope: WorkspaceDiffScope,
  workspaceId: string,
  sessionId: string,
  checkpointId: string,
): Promise<TurnCheckpointDiff> {
  if (scope === 'turn') {
    const transport = getSessionTransport()
    if (!transport) throw new Error('Turn changes are unavailable.')
    return transport.getCheckpointDiff(sessionId, checkpointId)
  }
  if (!window.aide) throw new Error('Git changes are unavailable.')
  const result = await window.aide.getWorkspaceScopeDiff(workspaceId, scope)
  if (!result.ok) throw new Error(result.error)
  return result.diff
}

/** A pull request's review threads on one line, as GitHub shows them under it. */
function ReviewThreads({
  threads,
}: {
  readonly threads: readonly DaemonReviewThread[]
}) {
  return (
    <div className="space-y-2 border-y border-border bg-surface-2 px-3 py-2 font-sans text-xs">
      {threads.map((thread, index) => (
        <div
          className="space-y-1"
          data-testid="diff-review-thread"
          // biome-ignore lint/suspicious/noArrayIndexKey: threads have no id, and a line's list only changes as a whole.
          key={index}
        >
          {thread.comments.map((comment, commentIndex) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: comments have no id either.
            <p className="whitespace-pre-wrap text-body" key={commentIndex}>
              <span className="font-medium text-foreground">
                {comment.author}
              </span>{' '}
              {comment.body}
            </p>
          ))}
          {thread.more > 0 ? (
            <p className="text-muted-foreground">
              {thread.more} more on GitHub
            </p>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/** Changed files and the selected file's diff for one turn, the branch against its base, or uncommitted work. */
export default function DiffPanel({
  checkpointId,
  initialPath,
  onClose,
  reviewThreads,
  sessionId,
  workspaceId,
}: {
  readonly checkpointId: string
  readonly initialPath: string | null
  readonly onClose: () => void
  /** The pull request's unresolved review threads, shown on their lines. */
  readonly reviewThreads?: readonly DaemonReviewThread[]
  readonly sessionId: string
  readonly workspaceId: string
}) {
  const [scope, setScope] = useState<WorkspaceDiffScope>('turn')
  const [selectedPath, setSelectedPath] = useState(initialPath)
  const [loaded, setLoaded] = useState<{
    diff: TurnCheckpointDiff | null
    error: string | null
    scope: WorkspaceDiffScope
  } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadScopeDiff(scope, workspaceId, sessionId, checkpointId).then(
      (diff) => {
        if (!cancelled) setLoaded({ diff, error: null, scope })
      },
      (error: unknown) => {
        if (!cancelled)
          setLoaded({
            diff: null,
            error: error instanceof Error ? error.message : String(error),
            scope,
          })
      },
    )
    return () => {
      cancelled = true
    }
  }, [checkpointId, scope, sessionId, workspaceId])

  const current = loaded?.scope === scope ? loaded : null
  const files = current?.diff?.files ?? []
  const selectedFile =
    files.find((file) => file.path === selectedPath) ?? files[0]
  const fileThreads = useMemo(
    () =>
      selectedFile && reviewThreads
        ? threadsByLine(reviewThreads, selectedFile.path)
        : null,
    [reviewThreads, selectedFile],
  )
  const annotations = useMemo(
    () =>
      fileThreads
        ? Object.fromEntries(
            [...fileThreads]
              .filter(([line]) => line > 0)
              .map(([line, threads]) => [
                line,
                <ReviewThreads key={line} threads={threads} />,
              ]),
          )
        : undefined,
    [fileThreads],
  )
  const wholeFileThreads = fileThreads?.get(0)

  return (
    <aside
      aria-label="Diff panel"
      className="absolute inset-y-0 right-0 z-20 flex w-full max-w-4xl flex-col border-l border-border bg-surface shadow-xl"
      data-testid="diff-panel"
    >
      <div className="flex items-center gap-1 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1" role="tablist">
          {SCOPES.map(([value, label]) => (
            <button
              aria-selected={scope === value}
              className={cn(
                'rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground',
                scope === value && 'bg-surface-2 text-foreground',
              )}
              key={value}
              onClick={() => setScope(value)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {current?.diff ? (
          <span className="ml-2 text-[11px] tabular-nums text-muted-foreground">
            <span className="text-accent-green">+{current.diff.additions}</span>{' '}
            <span className="text-accent-red">-{current.diff.deletions}</span> ·{' '}
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </span>
        ) : null}
        <button
          aria-label="Close diff panel"
          className="ml-auto rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
          onClick={onClose}
          type="button"
        >
          <X className="size-3.5" />
        </button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="w-64 shrink-0 border-r border-border">
          {files.length > 0 ? (
            <ChangedFilesTree
              className="h-full max-h-none"
              defaultExpanded
              files={files}
              key={scope}
              onSelect={setSelectedPath}
              selectedPath={selectedFile?.path}
            />
          ) : (
            <p className="p-3 text-xs text-muted-foreground" role="status">
              {!current
                ? 'Loading changes...'
                : (current.error ?? 'No changes in this scope.')}
            </p>
          )}
        </div>
        <div
          className="min-w-0 flex-1 overflow-auto"
          data-testid="diff-panel-file"
        >
          {wholeFileThreads ? (
            <ReviewThreads threads={wholeFileThreads} />
          ) : null}
          {selectedFile ? (
            <Suspense fallback={null}>
              <LazyGitDiffView
                annotations={annotations}
                filePath={selectedFile.path}
                key={`${scope}:${selectedFile.path}`}
                outputFormat="line-by-line"
                patch={selectedFile.patch}
              />
            </Suspense>
          ) : null}
        </div>
      </div>
    </aside>
  )
}
