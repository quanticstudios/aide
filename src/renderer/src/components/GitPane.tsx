import { Button, Chip, Surface } from '@heroui/react'
import { GitBranch, RefreshCcw, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import type { WorkspaceGitStatusSnapshot } from '../../../shared/git'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  formatGitChangeKind,
  getGitFileChangeBadges,
  resolveSelectedGitFilePath,
} from '../lib/git-pane-state'

function getAideApi() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unable to load workspace Git status.'
}

interface GitPaneProps {
  readonly isActive: boolean
  readonly workspace: WorkspaceRecord
}

export default function GitPane({ isActive, workspace }: GitPaneProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<WorkspaceGitStatusSnapshot | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    const api = getAideApi()

    if (!api) {
      setError('Desktop bridge did not load. Reload the app window.')
      setStatus(null)
      return
    }

    setIsLoading(true)

    try {
      const result = await api.getWorkspaceGitStatus(workspace.id)

      if (!result.ok) {
        setError(result.error)
        setStatus(null)
        return
      }

      setError(null)
      setStatus(result.status)
      setSelectedPath((current) =>
        resolveSelectedGitFilePath(result.status.files, current),
      )
    } catch (loadError) {
      setError(getErrorMessage(loadError))
      setStatus(null)
    } finally {
      setIsLoading(false)
    }
  }, [workspace.id])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    if (!isActive) {
      return
    }

    void refreshStatus()
  }, [isActive, refreshStatus])

  const selectedFile = useMemo(() => {
    if (!status) {
      return null
    }

    const nextSelectedPath = resolveSelectedGitFilePath(
      status.files,
      selectedPath,
    )

    return status.files.find((file) => file.path === nextSelectedPath) ?? null
  }, [selectedPath, status])

  if (error) {
    return (
      <section className="flex h-full min-h-0 flex-col items-center justify-center p-6">
        <Surface className="max-w-lg rounded-2xl border border-destructive/35 p-6 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-destructive/35 bg-destructive/10 text-destructive">
            <TriangleAlert className="size-4" />
          </div>
          <h2 className="mt-4 text-lg font-semibold text-foreground">
            Git pane unavailable
          </h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            {error}
          </p>
          <Button
            className="mt-5"
            onPress={() => void refreshStatus()}
            size="sm"
            variant="secondary"
          >
            <RefreshCcw className="size-4" />
            Retry
          </Button>
        </Surface>
      </section>
    )
  }

  if (!status) {
    return (
      <section className="flex h-full min-h-0 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">
          Loading workspace Git status…
        </p>
      </section>
    )
  }

  return (
    <section
      className="git-pane flex h-full min-h-0 flex-col"
      data-testid="git-pane"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <GitBranch className="size-3.5" />
            Git review surface
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {status.branchName}
            </h2>
            <Chip
              color={status.hasStagedChanges ? 'warning' : 'default'}
              size="sm"
              variant="secondary"
            >
              {status.hasStagedChanges ? 'Staged changes' : 'No staged changes'}
            </Chip>
            <Chip
              color={status.hasUnstagedChanges ? 'danger' : 'default'}
              size="sm"
              variant="secondary"
            >
              {status.hasUnstagedChanges
                ? 'Unstaged changes'
                : 'Working tree clean'}
            </Chip>
          </div>
          <p className="text-xs text-muted-foreground">{status.worktreePath}</p>
        </div>

        <Button onPress={() => void refreshStatus()} size="sm" variant="ghost">
          <RefreshCcw className="size-4" />
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      {status.files.length === 0 ? (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <Surface className="max-w-lg rounded-2xl border border-border/70 p-6 text-center">
            <h3 className="text-lg font-semibold text-foreground">
              Workspace is clean
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Changed files will show up here once this worktree diverges from
              its current branch state.
            </p>
          </Surface>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
          <Surface
            className="flex min-h-0 flex-col rounded-2xl border border-border/70"
            variant="secondary"
          >
            <div className="border-b border-border/60 px-4 py-3">
              <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                Changed files
              </p>
            </div>

            <div
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3"
              data-testid="git-pane-file-list"
            >
              {status.files.map((file) => {
                const isSelected = file.path === selectedFile?.path
                const badges = getGitFileChangeBadges(file)

                return (
                  <button
                    className={`rounded-2xl border p-3 text-left transition-colors ${
                      isSelected
                        ? 'border-primary/55 bg-primary/10'
                        : 'border-border/70 bg-background/55 hover:border-primary/30 hover:bg-surface-secondary'
                    }`}
                    data-testid={`git-pane-file-${file.path}`}
                    key={file.path}
                    onClick={() => setSelectedPath(file.path)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-foreground">
                          {file.path}
                        </p>
                        {file.originalPath ? (
                          <p className="mt-1 truncate text-xs text-muted-foreground">
                            from {file.originalPath}
                          </p>
                        ) : null}
                      </div>
                      <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {isSelected ? 'Active' : 'Review'}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {badges.map((badge) => (
                        <Chip key={badge} size="sm" variant="secondary">
                          {badge}
                        </Chip>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>
          </Surface>

          <Surface
            className="flex min-h-0 flex-col rounded-2xl border border-border/70 p-5"
            variant="secondary"
          >
            {selectedFile ? (
              <>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                  <GitBranch className="size-3.5" />
                  Review surface
                </div>
                <h3
                  className="mt-4 break-all font-mono text-sm font-semibold text-foreground"
                  data-testid="git-pane-selected-file"
                >
                  {selectedFile.path}
                </h3>
                <div className="mt-4 flex flex-wrap gap-2">
                  {getGitFileChangeBadges(selectedFile).map((badge) => (
                    <Chip key={badge} size="sm" variant="secondary">
                      {badge}
                    </Chip>
                  ))}
                </div>
                <div className="mt-6 grid gap-3 md:grid-cols-2">
                  <Surface
                    className="rounded-2xl border border-border/60 p-4"
                    variant="tertiary"
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Staged status
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {formatGitChangeKind(selectedFile.staged)}
                    </p>
                  </Surface>
                  <Surface
                    className="rounded-2xl border border-border/60 p-4"
                    variant="tertiary"
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Unstaged status
                    </p>
                    <p className="mt-2 text-sm text-foreground">
                      {formatGitChangeKind(selectedFile.unstaged)}
                    </p>
                  </Surface>
                </div>
                {selectedFile.originalPath ? (
                  <Surface
                    className="mt-4 rounded-2xl border border-border/60 p-4"
                    variant="tertiary"
                  >
                    <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                      Original path
                    </p>
                    <p className="mt-2 break-all font-mono text-xs text-foreground">
                      {selectedFile.originalPath}
                    </p>
                  </Surface>
                ) : null}
                <Surface
                  className="mt-4 rounded-2xl border border-border/60 p-4"
                  variant="tertiary"
                >
                  <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    Next slice
                  </p>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    Diff rendering lands in the next bead. This pane now owns
                    changed-file visibility, staged versus unstaged trust
                    signals, and file selection routing.
                  </p>
                </Surface>
              </>
            ) : null}
          </Surface>
        </div>
      )}
    </section>
  )
}
