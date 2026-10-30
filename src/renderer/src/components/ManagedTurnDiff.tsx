import { useCallback, useState } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { ManagedSessionTurnSummary } from '../../../shared/managed-session'
import { type DiffLayout, GitDiffView } from './GitDiffView'

interface TurnPatchFile {
  binary: boolean
  patch: string
  path: string
  renderable: boolean
}

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

export function splitManagedTurnPatch(patch: string): TurnPatchFile[] {
  const starts = [...patch.matchAll(/^diff --git a\/(.+) b\/(.+)$/gm)]

  return starts.map((match, index) => {
    const start = match.index ?? 0
    const end = starts[index + 1]?.index ?? patch.length
    const section = patch.slice(start, end).trim()
    const oldPath = match[1] ?? 'unknown file'
    const newPath = match[2] ?? oldPath
    const path = newPath === '/dev/null' ? oldPath : newPath
    const binary =
      section.includes('GIT binary patch') || section.includes('Binary files ')

    return {
      binary,
      patch: section,
      path,
      renderable: !binary && section.includes('@@'),
    }
  })
}

function statusLabel(turn: ManagedSessionTurnSummary): string {
  if (turn.state === 'running') {
    return 'Working'
  }

  switch (turn.diff.status) {
    case 'capturing':
      return 'Capturing patch'
    case 'empty':
      return 'No changes'
    case 'error':
      return 'Patch unavailable'
    case 'truncated':
      return 'Patch truncated'
    default:
      return `${turn.diff.changedFileCount} ${turn.diff.changedFileCount === 1 ? 'file' : 'files'} changed`
  }
}

export default function ManagedTurnDiff({
  sessionId,
  turn,
}: {
  readonly sessionId: string
  readonly turn: ManagedSessionTurnSummary
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [layout, setLayout] = useState<DiffLayout>('side-by-side')
  const [loadedPatch, setLoadedPatch] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const loadPatch = useCallback(async () => {
    if (
      turn.state === 'running' ||
      turn.diff.status !== 'ready' ||
      loadedPatch
    ) {
      return
    }

    const api = getAideApi()
    if (!api) {
      setLoadError('Desktop bridge did not load. Reload the app window.')
      return
    }

    setIsLoading(true)
    try {
      const patch = await api.getManagedSessionTurnPatch(sessionId, turn.id)
      if (patch?.status !== 'ready' || !patch.patch) {
        setLoadError('This turn patch is no longer available. Open Git review.')
        return
      }
      setLoadedPatch(patch.patch)
      setLoadError(null)
    } catch (error) {
      setLoadError(
        error instanceof Error
          ? error.message
          : 'Unable to load this turn patch.',
      )
    } finally {
      setIsLoading(false)
    }
  }, [loadedPatch, sessionId, turn.diff.status, turn.id, turn.state])

  const files = loadedPatch ? splitManagedTurnPatch(loadedPatch) : []

  return (
    <details
      className="rounded-md border border-border/70 bg-surface-secondary/30"
      data-testid={`managed-turn-diff-${turn.id}`}
      onToggle={(event) => {
        const open = event.currentTarget.open
        setIsOpen(open)
        if (open) void loadPatch()
      }}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-xs text-muted-foreground marker:content-none hover:text-foreground">
        <span className="font-medium text-foreground">
          Turn {turn.sequence} changes
        </span>
        <span className="ml-2">{statusLabel(turn)}</span>
        {turn.diff.binaryChanges === 'present' ? (
          <span className="ml-2">Includes binary changes</span>
        ) : null}
      </summary>

      {isOpen ? (
        <div className="border-t border-border/70 px-3 py-3">
          {turn.state === 'running' || turn.diff.status === 'capturing' ? (
            <p className="text-xs text-muted-foreground">
              Capturing the worktree patch when this turn finishes…
            </p>
          ) : null}
          {turn.diff.status === 'empty' ? (
            <p className="text-xs text-muted-foreground">
              {turn.diff.message ??
                'No Git-visible changes were made during this turn.'}
            </p>
          ) : null}
          {turn.diff.status === 'error' || turn.diff.status === 'truncated' ? (
            <p className="text-xs text-accent-yellow">
              {turn.diff.message ?? 'Open Git review to inspect the worktree.'}
            </p>
          ) : null}
          {turn.diff.status === 'ready' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {isLoading
                    ? 'Loading patch…'
                    : `${turn.diff.changedFileCount} changed files`}
                </span>
                <div
                  aria-label="Patch layout"
                  className="ml-auto flex rounded border border-border/70 p-0.5"
                  role="group"
                >
                  <button
                    aria-pressed={layout === 'line-by-line'}
                    className="rounded px-2 py-1 text-[11px] hover:bg-surface-tertiary aria-[pressed=true]:bg-surface-tertiary aria-[pressed=true]:text-foreground"
                    onClick={() => setLayout('line-by-line')}
                    type="button"
                  >
                    Unified
                  </button>
                  <button
                    aria-pressed={layout === 'side-by-side'}
                    className="rounded px-2 py-1 text-[11px] hover:bg-surface-tertiary aria-[pressed=true]:bg-surface-tertiary aria-[pressed=true]:text-foreground"
                    onClick={() => setLayout('side-by-side')}
                    type="button"
                  >
                    Split
                  </button>
                </div>
              </div>
              {loadError ? (
                <div className="space-y-2 text-xs text-accent-red">
                  <p>{loadError}</p>
                  <button
                    className="rounded border border-border px-2 py-1 text-muted-foreground hover:text-foreground"
                    onClick={() => void loadPatch()}
                    type="button"
                  >
                    Retry patch load
                  </button>
                </div>
              ) : null}
              {loadedPatch && files.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  This patch has no renderable file sections. Open Git review
                  for more context.
                </p>
              ) : null}
              <div className="space-y-4">
                {files.map((file) => (
                  <section
                    className="overflow-x-auto rounded border border-border/60 bg-surface"
                    key={file.path}
                  >
                    <h4 className="border-b border-border/60 px-3 py-2 font-mono text-xs text-foreground">
                      {file.path}
                    </h4>
                    {file.binary ? (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        Binary change captured; the text diff renderer cannot
                        display its contents.
                      </p>
                    ) : file.renderable ? (
                      <GitDiffView
                        filePath={file.path}
                        outputFormat={layout}
                        patch={file.patch}
                      />
                    ) : (
                      <p className="px-3 py-3 text-xs text-muted-foreground">
                        File changed only in metadata or without textual hunks.
                      </p>
                    )}
                  </section>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
    </details>
  )
}
