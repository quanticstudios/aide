import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { getDiffViewHighlighter } from '@git-diff-view/shiki'
import { Button, Chip, Surface } from '@heroui/react'
import {
  ChevronRight,
  Folder,
  FolderOpen,
  GitBranch,
  RefreshCcw,
  TriangleAlert,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type {
  WorkspaceGitDiffSnapshot,
  WorkspaceGitMutationResult,
  WorkspaceGitPullRequest,
  WorkspaceGitStatusSnapshot,
} from '../../../shared/git'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  buildGitFileTree,
  dominantGitChangeKind,
  formatGitChangeKind,
  type GitTreeNode,
  gitChangeKindColorClass,
  iconForGitFile,
  letterForGitChangeKind,
  resolveSelectedGitFilePath,
} from '../lib/git-pane-state'
import { materialIconUrlForFile } from '../lib/material-file-icon'
import {
  isCurrentWorkspaceDiff,
  isCurrentWorkspaceRequest,
} from '../lib/prop-change-state'
import { cn } from '../lib/utils'

type DiffHighlighter = Awaited<ReturnType<typeof getDiffViewHighlighter>>

type DiffLayout = 'line-by-line' | 'side-by-side'

interface DiffLoadError {
  readonly message: string
  readonly path: string
  readonly workspaceId: string
}

const DIFF_LAYOUT_STORAGE_KEY = 'aide.gitPane.diffLayout'

function readStoredDiffLayout(): DiffLayout {
  if (typeof window === 'undefined') {
    return 'side-by-side'
  }

  const stored = window.localStorage.getItem(DIFF_LAYOUT_STORAGE_KEY)
  return stored === 'line-by-line' ? 'line-by-line' : 'side-by-side'
}

const HIGHLIGHTER_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'bash',
  'python',
  'go',
  'sql',
  'yaml',
  'xml',
] as const

let highlighterPromise: Promise<DiffHighlighter> | null = null

function loadHighlighter(): Promise<DiffHighlighter> {
  highlighterPromise ??= getDiffViewHighlighter([...HIGHLIGHTER_LANGS])
  return highlighterPromise
}

function inferFileLang(filePath: string): string {
  const lower = filePath.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'jsx':
      return 'jsx'
    case 'json':
      return 'json'
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'css':
      return 'css'
    case 'scss':
    case 'sass':
      return 'sass'
    case 'html':
    case 'htm':
      return 'html'
    case 'xml':
      return 'xml'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'sql':
      return 'sql'
    case 'yaml':
    case 'yml':
      return 'yaml'
    default:
      return 'txt'
  }
}

function GitDiffView({
  filePath,
  outputFormat,
  patch,
}: {
  readonly filePath: string
  readonly outputFormat: DiffLayout
  readonly patch: string
}) {
  const [highlighter, setHighlighter] = useState<DiffHighlighter | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadHighlighter().then((h) => {
      if (!cancelled) {
        setHighlighter(h)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const lang = useMemo(() => inferFileLang(filePath), [filePath])

  const diffFile = useMemo(() => {
    const file = DiffFile.createInstance({
      hunks: [patch],
      newFile: { fileLang: lang, fileName: filePath },
      oldFile: { fileLang: lang, fileName: filePath },
    })
    file.initTheme('dark')
    file.init()
    if (outputFormat === 'side-by-side') {
      file.buildSplitDiffLines()
    } else {
      file.buildUnifiedDiffLines()
    }
    return file
  }, [filePath, lang, outputFormat, patch])

  return (
    <DiffView
      diffFile={diffFile}
      diffViewFontSize={12}
      diffViewHighlight={highlighter !== null}
      diffViewMode={
        outputFormat === 'side-by-side'
          ? DiffModeEnum.Split
          : DiffModeEnum.Unified
      }
      diffViewTheme="dark"
      diffViewWrap={false}
      registerHighlighter={highlighter ?? undefined}
    />
  )
}

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

function formatReviewFeedback(
  filePath: string,
  line: string,
  text: string,
): string {
  return `Review feedback for ${filePath}:${line}\n\n${text.trim()}`
}

function isAgentPaneId(paneId: string): boolean {
  return paneId === 'agent' || paneId.startsWith('agent::copy-')
}

function GitFileTreeRow({
  collapsed,
  depth,
  node,
  onSelectFile,
  onToggleDir,
  selectedPath,
}: {
  readonly collapsed: ReadonlySet<string>
  readonly depth: number
  readonly node: GitTreeNode
  readonly onSelectFile: (path: string) => void
  readonly onToggleDir: (path: string) => void
  readonly selectedPath: string | null
}) {
  const indentPx = depth * 12 + 4

  if (node.kind === 'dir') {
    const isCollapsed = collapsed.has(node.path)
    const FolderIcon = isCollapsed ? Folder : FolderOpen
    return (
      <>
        <button
          aria-expanded={!isCollapsed}
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
          onClick={() => onToggleDir(node.path)}
          style={{ paddingLeft: indentPx }}
          type="button"
        >
          <ChevronRight
            className={cn(
              'size-3 shrink-0 transition-transform',
              isCollapsed ? 'rotate-0' : 'rotate-90',
            )}
          />
          <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-mono">{node.name}</span>
        </button>
        {!isCollapsed
          ? node.children.map((child) => (
              <GitFileTreeRow
                collapsed={collapsed}
                depth={depth + 1}
                key={child.path}
                node={child}
                onSelectFile={onSelectFile}
                onToggleDir={onToggleDir}
                selectedPath={selectedPath}
              />
            ))
          : null}
      </>
    )
  }

  const file = node.file
  const isSelected = node.path === selectedPath
  const iconUrl = materialIconUrlForFile(file.path)
  const FallbackIcon = iconForGitFile(file)
  const dominant = dominantGitChangeKind(file)
  const letter = letterForGitChangeKind(dominant)
  const dotClass = gitChangeKindColorClass(dominant)

  return (
    <button
      aria-current={isSelected ? 'true' : undefined}
      className={cn(
        'change-row flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left',
        isSelected ? 'is-active' : 'hover:bg-surface-secondary',
      )}
      data-testid={`git-pane-file-${file.path}`}
      onClick={() => onSelectFile(file.path)}
      style={{ paddingLeft: indentPx }}
      title={`${file.path}${file.originalPath ? ` (from ${file.originalPath})` : ''} — ${formatGitChangeKind(dominant)}`}
      type="button"
    >
      <span className="size-3 shrink-0" />
      {iconUrl ? (
        <img alt="" className="size-3.5 shrink-0" src={iconUrl} />
      ) : (
        <FallbackIcon className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-xs leading-4 text-foreground">
        {node.name}
      </span>
      {letter ? (
        <span
          aria-label={formatGitChangeKind(dominant)}
          className={cn(
            'grid size-4 shrink-0 place-items-center rounded text-[10px] font-semibold text-background',
            dotClass,
          )}
        >
          {letter}
        </span>
      ) : null}
    </button>
  )
}

interface GitPaneProps {
  readonly isActive: boolean
  readonly workspace: WorkspaceRecord
}

export default function GitPane({ isActive, workspace }: GitPaneProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [isDiffLoading, setIsDiffLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [diffError, setDiffError] = useState<DiffLoadError | null>(null)
  const [status, setStatus] = useState<WorkspaceGitStatusSnapshot | null>(null)
  const [diff, setDiff] = useState<WorkspaceGitDiffSnapshot | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isMutating, setIsMutating] = useState(false)
  const [isRevertConfirmationOpen, setIsRevertConfirmationOpen] =
    useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [pullRequestTitle, setPullRequestTitle] = useState('')
  const [pullRequestBody, setPullRequestBody] = useState('')
  const [pullRequest, setPullRequest] =
    useState<WorkspaceGitPullRequest | null>(null)
  const [reviewLine, setReviewLine] = useState('')
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [reviewAgentSessions, setReviewAgentSessions] = useState<
    readonly ManagedSessionSnapshot[]
  >([])
  const [reviewAgentSessionId, setReviewAgentSessionId] = useState('')
  const [diffLayout, setDiffLayout] = useState<DiffLayout>(readStoredDiffLayout)
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(new Set())
  const [previousWorkspaceId, setPreviousWorkspaceId] = useState(workspace.id)
  const currentWorkspaceIdRef = useRef(workspace.id)
  const statusRequestIdRef = useRef(0)

  // Reset all workspace-owned data before commit and invalidate old responses.
  if (previousWorkspaceId !== workspace.id) {
    setPreviousWorkspaceId(workspace.id)
    setIsLoading(false)
    setIsDiffLoading(false)
    setError(null)
    setDiffError(null)
    setActionError(null)
    setStatus(null)
    setDiff(null)
    setSelectedPath(null)
    setIsRevertConfirmationOpen(false)
    setCommitMessage('')
    setPullRequestTitle('')
    setPullRequestBody('')
    setPullRequest(null)
    setReviewLine('')
    setReviewFeedback('')
    setReviewAgentSessions([])
    setReviewAgentSessionId('')
    setCollapsedDirs(new Set())
  }

  useLayoutEffect(() => {
    currentWorkspaceIdRef.current = workspace.id
    statusRequestIdRef.current += 1
  }, [workspace.id])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(DIFF_LAYOUT_STORAGE_KEY, diffLayout)
  }, [diffLayout])

  const toggleDir = useCallback((path: string) => {
    setCollapsedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  const refreshStatus = useCallback(async () => {
    const api = getAideApi()
    const requestWorkspaceId = workspace.id
    const requestId = ++statusRequestIdRef.current

    const isCurrentRequest = () =>
      isCurrentWorkspaceRequest(
        currentWorkspaceIdRef.current,
        requestWorkspaceId,
        statusRequestIdRef.current,
        requestId,
      )

    if (!api) {
      if (isCurrentRequest()) {
        setError('Desktop bridge did not load. Reload the app window.')
        setStatus(null)
      }
      return
    }

    setIsLoading(true)

    try {
      const result = await api.getWorkspaceGitStatus(requestWorkspaceId)

      if (!isCurrentRequest()) {
        return
      }

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
      if (isCurrentRequest()) {
        setError(getErrorMessage(loadError))
        setStatus(null)
      }
    } finally {
      if (isCurrentRequest()) {
        setIsLoading(false)
      }
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

  const fileTree = useMemo(
    () => (status ? buildGitFileTree(status.files) : []),
    [status],
  )

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
  const visibleDiff =
    diff &&
    isCurrentWorkspaceDiff(diff, workspace.id, selectedFile?.path ?? null)
      ? diff
      : null
  const visibleDiffError =
    diffError &&
    isCurrentWorkspaceDiff(diffError, workspace.id, selectedFile?.path ?? null)
      ? diffError.message
      : null

  useEffect(() => {
    const api = getAideApi()

    if (!selectedFile) {
      setDiff(null)
      setDiffError(null)
      return
    }

    if (!api) {
      setDiff(null)
      setDiffError({
        message: 'Desktop bridge did not load. Reload the app window.',
        path: selectedFile.path,
        workspaceId: workspace.id,
      })
      return
    }

    let cancelled = false
    const requestWorkspaceId = workspace.id
    const isCurrentRequest = () =>
      !cancelled && currentWorkspaceIdRef.current === requestWorkspaceId

    void (async () => {
      setIsDiffLoading(true)

      try {
        const result = await api.getWorkspaceGitDiff(
          requestWorkspaceId,
          selectedFile.path,
        )

        if (!isCurrentRequest()) {
          return
        }

        if (!result.ok) {
          setDiff(null)
          setDiffError({
            message: result.error,
            path: selectedFile.path,
            workspaceId: requestWorkspaceId,
          })
          return
        }

        setDiff(result.diff)
        setDiffError(null)
      } catch (loadError) {
        if (isCurrentRequest()) {
          setDiff(null)
          setDiffError({
            message: getErrorMessage(loadError),
            path: selectedFile.path,
            workspaceId: requestWorkspaceId,
          })
        }
      } finally {
        if (isCurrentRequest()) {
          setIsDiffLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedFile, workspace.id])

  useEffect(() => {
    const api = getAideApi()
    if (!api) return

    let cancelled = false
    void api.getManagedSessionSnapshots().then((snapshots) => {
      if (cancelled) return
      const sessions = Object.values(snapshots).filter(
        (session) =>
          session.workspaceId === workspace.id && isAgentPaneId(session.paneId),
      )
      setReviewAgentSessions(sessions)
      setReviewAgentSessionId((current) =>
        sessions.some((session) => session.sessionId === current)
          ? current
          : (sessions[0]?.sessionId ?? ''),
      )
    })

    return () => {
      cancelled = true
    }
  }, [workspace.id])

  const applyMutationResult = useCallback(
    (result: WorkspaceGitMutationResult): boolean => {
      if (!result.ok) {
        setActionError(result.error)
        return false
      }
      setActionError(null)
      setStatus(result.status)
      setSelectedPath((current) =>
        resolveSelectedGitFilePath(result.status.files, current),
      )
      setDiff(null)
      setDiffError(null)
      return true
    },
    [],
  )

  const runMutation = useCallback(
    async (operation: () => Promise<WorkspaceGitMutationResult>) => {
      setIsMutating(true)
      try {
        return applyMutationResult(await operation())
      } catch (mutationError) {
        setActionError(getErrorMessage(mutationError))
        return false
      } finally {
        setIsMutating(false)
      }
    },
    [applyMutationResult],
  )

  const sendReviewFeedback = useCallback(async () => {
    const api = getAideApi()
    const line = Number.parseInt(reviewLine, 10)
    if (
      !api ||
      !selectedFile ||
      !reviewFeedback.trim() ||
      !Number.isSafeInteger(line) ||
      line < 1
    ) {
      setActionError('Choose a positive line number and enter feedback.')
      return
    }

    setIsMutating(true)
    try {
      const sessions = Object.values(
        await api.getManagedSessionSnapshots(),
      ).filter(
        (session) =>
          session.workspaceId === workspace.id && isAgentPaneId(session.paneId),
      )
      const session = sessions.find(
        (candidate) => candidate.sessionId === reviewAgentSessionId,
      )
      if (!session) {
        setActionError(
          'Open the workspace Agent pane before sending review feedback.',
        )
        return
      }
      await api.sendManagedSessionInput(
        session.sessionId,
        formatReviewFeedback(selectedFile.path, reviewLine, reviewFeedback),
      )
      setActionError(null)
      setReviewFeedback('')
    } catch (sendError) {
      setActionError(getErrorMessage(sendError))
    } finally {
      setIsMutating(false)
    }
  }, [
    reviewAgentSessionId,
    reviewFeedback,
    reviewLine,
    selectedFile,
    workspace.id,
  ])

  const refreshPullRequest = useCallback(async () => {
    const api = getAideApi()
    if (!api) {
      setActionError('Desktop bridge did not load. Reload the app window.')
      return
    }
    setIsMutating(true)
    try {
      const result = await api.getWorkspaceGitPullRequest(workspace.id)
      if (!result.ok) {
        setActionError(result.error)
        return
      }
      setActionError(null)
      setPullRequest(result.pullRequest)
    } catch (pullRequestError) {
      setActionError(getErrorMessage(pullRequestError))
    } finally {
      setIsMutating(false)
    }
  }, [workspace.id])

  if (error) {
    return (
      <section className="flex h-full min-h-0 flex-col items-center justify-center p-6">
        <Surface className="max-w-lg rounded-lg border border-accent-red p-6 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-full border border-accent-red bg-accent-red-soft text-accent-red">
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
      className="git-pane flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden"
      data-testid="git-pane"
    >
      <div className="flex h-[var(--pane-header-h)] shrink-0 items-center justify-between gap-3 border-b border-border px-5">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
          <h2 className="truncate text-lg font-semibold tracking-[-0.374px] text-foreground">
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

        <Button onPress={() => void refreshStatus()} size="sm" variant="ghost">
          <RefreshCcw className="size-4" />
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </Button>
      </div>

      <p className="truncate border-b border-border px-5 py-2 text-xs text-muted-foreground">
        {status.worktreePath}
      </p>

      {actionError ? (
        <div className="border-b border-accent-red bg-accent-red-soft px-5 py-2 text-sm text-accent-red">
          {actionError}
        </div>
      ) : null}

      <div className="grid gap-3 border-b border-border p-4 xl:grid-cols-2">
        <Surface
          className="space-y-2 rounded-lg border border-border p-3"
          variant="secondary"
        >
          <p className="text-sm font-medium text-foreground">
            Commit staged changes
          </p>
          <label
            className="block text-xs text-muted-foreground"
            htmlFor="git-commit-message"
          >
            Commit message
          </label>
          <textarea
            className="min-h-16 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            id="git-commit-message"
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="Describe the staged change"
            value={commitMessage}
          />
          <Button
            isDisabled={
              isMutating || !status.hasStagedChanges || !commitMessage.trim()
            }
            onPress={() => {
              const api = getAideApi()
              if (!api) {
                setActionError(
                  'Desktop bridge did not load. Reload the app window.',
                )
                return
              }
              void runMutation(() =>
                api.commitWorkspaceGitIndex({
                  message: commitMessage,
                  workspaceId: workspace.id,
                }),
              ).then((committed) => {
                if (committed) setCommitMessage('')
              })
            }}
            size="sm"
            variant="secondary"
          >
            Commit index
          </Button>
        </Surface>

        <Surface
          className="space-y-2 rounded-lg border border-border p-3"
          variant="secondary"
        >
          <p className="text-sm font-medium text-foreground">Pull request</p>
          <label
            className="block text-xs text-muted-foreground"
            htmlFor="git-pr-title"
          >
            Title
          </label>
          <input
            className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            id="git-pr-title"
            onChange={(event) => setPullRequestTitle(event.target.value)}
            value={pullRequestTitle}
          />
          <label
            className="block text-xs text-muted-foreground"
            htmlFor="git-pr-body"
          >
            Description
          </label>
          <textarea
            className="min-h-16 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
            id="git-pr-body"
            onChange={(event) => setPullRequestBody(event.target.value)}
            value={pullRequestBody}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              isDisabled={isMutating}
              onPress={() => {
                const api = getAideApi()
                if (!api) {
                  setActionError(
                    'Desktop bridge did not load. Reload the app window.',
                  )
                  return
                }
                void runMutation(() => api.pushWorkspaceGitBranch(workspace.id))
              }}
              size="sm"
              variant="secondary"
            >
              Push branch
            </Button>
            <Button
              isDisabled={isMutating || !pullRequestTitle.trim()}
              onPress={() => {
                const api = getAideApi()
                if (!api) {
                  setActionError(
                    'Desktop bridge did not load. Reload the app window.',
                  )
                  return
                }
                setIsMutating(true)
                void api
                  .createWorkspaceGitPullRequest({
                    body: pullRequestBody,
                    title: pullRequestTitle,
                    workspaceId: workspace.id,
                  })
                  .then((result) => {
                    if (!result.ok) {
                      setActionError(result.error)
                      return
                    }
                    setActionError(null)
                    setPullRequest(result.pullRequest)
                  })
                  .catch((pullRequestError) =>
                    setActionError(getErrorMessage(pullRequestError)),
                  )
                  .finally(() => setIsMutating(false))
              }}
              size="sm"
            >
              Create pull request
            </Button>
            <Button
              isDisabled={isMutating}
              onPress={() => void refreshPullRequest()}
              size="sm"
              variant="ghost"
            >
              Inspect checks
            </Button>
          </div>
          {pullRequest ? (
            <div className="space-y-1 text-xs text-muted-foreground">
              <a
                className="text-foreground underline"
                href={pullRequest.url}
                rel="noreferrer"
                target="_blank"
              >
                #{pullRequest.number} {pullRequest.title}
              </a>
              <p>
                {pullRequest.state} · {pullRequest.headRefName} →{' '}
                {pullRequest.baseRefName}
              </p>
              {pullRequest.checks.map((check) => (
                <p key={check.name}>
                  {check.name}: {check.conclusion ?? check.status ?? 'pending'}
                </p>
              ))}
            </div>
          ) : null}
        </Surface>
      </div>

      {status.files.length === 0 ? (
        <div className="flex h-full min-h-0 items-center justify-center p-6">
          <Surface className="max-w-lg rounded-lg border border-border p-6 text-center">
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
        <div className="grid min-h-0 min-w-0 w-full flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
          <Surface
            className="flex min-h-0 flex-col rounded-lg border border-border"
            variant="secondary"
          >
            <div className="border-b border-border px-4 py-3">
              <p className="eyebrow">Changed files</p>
            </div>

            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1"
              data-testid="git-pane-file-list"
            >
              {fileTree.map((node) => (
                <GitFileTreeRow
                  collapsed={collapsedDirs}
                  depth={0}
                  key={node.path}
                  node={node}
                  onSelectFile={setSelectedPath}
                  onToggleDir={toggleDir}
                  selectedPath={selectedFile?.path ?? null}
                />
              ))}
            </div>
          </Surface>

          <Surface
            className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border border-border"
            variant="secondary"
          >
            {selectedFile ? (
              <>
                {(() => {
                  const FileIcon = iconForGitFile(selectedFile)
                  return (
                    <div className="flex items-center gap-3 border-b border-border px-4 py-2">
                      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      <div
                        className="min-w-0 flex-1 truncate font-mono text-sm text-foreground"
                        data-testid="git-pane-selected-file"
                      >
                        {selectedFile.path}
                        {selectedFile.originalPath ? (
                          <span className="ml-2 text-muted-foreground">
                            ← {selectedFile.originalPath}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              gitChangeKindColorClass(selectedFile.staged),
                            )}
                          />
                          staged: {formatGitChangeKind(selectedFile.staged)}
                        </span>
                        <span className="text-border">·</span>
                        <span className="flex items-center gap-1">
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              gitChangeKindColorClass(selectedFile.unstaged),
                            )}
                          />
                          unstaged: {formatGitChangeKind(selectedFile.unstaged)}
                        </span>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {selectedFile.isUnstaged ? (
                          <Button
                            isDisabled={isMutating}
                            onPress={() => {
                              const api = getAideApi()
                              if (!api) {
                                setActionError(
                                  'Desktop bridge did not load. Reload the app window.',
                                )
                                return
                              }
                              void runMutation(() =>
                                api.stageWorkspaceGitFile({
                                  filePath: selectedFile.path,
                                  workspaceId: workspace.id,
                                }),
                              )
                            }}
                            size="sm"
                            variant="secondary"
                          >
                            Stage
                          </Button>
                        ) : null}
                        {selectedFile.isStaged ? (
                          <Button
                            isDisabled={isMutating}
                            onPress={() => {
                              const api = getAideApi()
                              if (!api) {
                                setActionError(
                                  'Desktop bridge did not load. Reload the app window.',
                                )
                                return
                              }
                              void runMutation(() =>
                                api.unstageWorkspaceGitFile({
                                  filePath: selectedFile.path,
                                  workspaceId: workspace.id,
                                }),
                              )
                            }}
                            size="sm"
                            variant="secondary"
                          >
                            Unstage
                          </Button>
                        ) : null}
                        <Button
                          isDisabled={isMutating || !visibleDiff}
                          onPress={() => setIsRevertConfirmationOpen(true)}
                          size="sm"
                          variant="danger"
                        >
                          Revert file
                        </Button>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-md border border-border bg-surface-secondary p-0.5">
                        <button
                          className={cn(
                            'rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
                            diffLayout === 'side-by-side'
                              ? 'bg-surface text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          onClick={() => setDiffLayout('side-by-side')}
                          type="button"
                        >
                          Split
                        </button>
                        <button
                          className={cn(
                            'rounded-sm px-2.5 py-1 text-[11px] font-medium transition-colors',
                            diffLayout === 'line-by-line'
                              ? 'bg-surface text-foreground shadow-sm'
                              : 'text-muted-foreground hover:text-foreground',
                          )}
                          onClick={() => setDiffLayout('line-by-line')}
                          type="button"
                        >
                          Inline
                        </button>
                      </div>
                    </div>
                  )
                })()}
                <div
                  className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-hidden p-3"
                  data-testid="git-pane-diff-surface"
                >
                  {visibleDiffError ? (
                    <Surface
                      className="rounded-md border border-accent-red p-3"
                      variant="tertiary"
                    >
                      <p className="text-[11px] uppercase tracking-[0.16em] text-destructive">
                        Diff unavailable
                      </p>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {visibleDiffError}
                      </p>
                    </Surface>
                  ) : null}

                  {isDiffLoading && !visibleDiff ? (
                    <p className="text-sm text-muted-foreground">
                      Loading file diff…
                    </p>
                  ) : null}

                  {visibleDiff?.sections.map((section) => (
                    <div
                      className="flex min-h-0 min-w-0 flex-1 flex-col"
                      key={`${visibleDiff.path}:${section.kind}`}
                    >
                      {section.isTruncated ? (
                        <div className="mb-1 flex items-center gap-2">
                          <Chip color="warning" size="sm" variant="secondary">
                            Truncated
                          </Chip>
                        </div>
                      ) : null}
                      <div
                        className="min-h-0 min-w-0 flex-1 overflow-auto rounded-md border border-border bg-surface"
                        data-testid={`git-pane-diff-${section.kind}`}
                      >
                        <GitDiffView
                          filePath={visibleDiff.path}
                          outputFormat={diffLayout}
                          patch={section.patch}
                        />
                      </div>
                    </div>
                  ))}
                  {isRevertConfirmationOpen && visibleDiff ? (
                    <Surface
                      className="space-y-2 rounded-md border border-accent-red p-3"
                      variant="tertiary"
                    >
                      <p className="text-sm text-foreground">
                        Revert the displayed changes for {selectedFile.path}?
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Aide checks the preview fingerprint before it changes
                        the file.
                      </p>
                      <div className="flex gap-2">
                        <Button
                          isDisabled={isMutating}
                          onPress={() => {
                            const api = getAideApi()
                            if (!api) {
                              setActionError(
                                'Desktop bridge did not load. Reload the app window.',
                              )
                              return
                            }
                            void runMutation(() =>
                              api.revertWorkspaceGitFile({
                                filePath: selectedFile.path,
                                fingerprint: visibleDiff.fingerprint,
                                workspaceId: workspace.id,
                              }),
                            ).then((reverted) => {
                              if (reverted) setIsRevertConfirmationOpen(false)
                            })
                          }}
                          size="sm"
                          variant="danger"
                        >
                          Confirm revert
                        </Button>
                        <Button
                          isDisabled={isMutating}
                          onPress={() => setIsRevertConfirmationOpen(false)}
                          size="sm"
                          variant="secondary"
                        >
                          Cancel
                        </Button>
                      </div>
                    </Surface>
                  ) : null}
                  <Surface
                    className="space-y-2 rounded-md border border-border p-3"
                    variant="tertiary"
                  >
                    <p className="text-sm font-medium text-foreground">
                      Line feedback
                    </p>
                    {reviewAgentSessions.length > 1 ? (
                      <>
                        <label
                          className="block text-xs text-muted-foreground"
                          htmlFor="git-review-agent"
                        >
                          Agent pane
                        </label>
                        <select
                          className="w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                          id="git-review-agent"
                          onChange={(event) =>
                            setReviewAgentSessionId(event.target.value)
                          }
                          value={reviewAgentSessionId}
                        >
                          {reviewAgentSessions.map((session) => (
                            <option
                              key={session.sessionId}
                              value={session.sessionId}
                            >
                              {session.paneId}
                            </option>
                          ))}
                        </select>
                      </>
                    ) : null}
                    <label
                      className="block text-xs text-muted-foreground"
                      htmlFor="git-review-line"
                    >
                      Line number
                    </label>
                    <input
                      className="w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                      id="git-review-line"
                      min="1"
                      onChange={(event) => setReviewLine(event.target.value)}
                      type="number"
                      value={reviewLine}
                    />
                    <label
                      className="block text-xs text-muted-foreground"
                      htmlFor="git-review-feedback"
                    >
                      Feedback for the workspace Agent pane
                    </label>
                    <textarea
                      className="min-h-16 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                      id="git-review-feedback"
                      onChange={(event) =>
                        setReviewFeedback(event.target.value)
                      }
                      value={reviewFeedback}
                    />
                    <Button
                      isDisabled={
                        isMutating || !reviewFeedback.trim() || !reviewLine
                      }
                      onPress={() => void sendReviewFeedback()}
                      size="sm"
                      variant="secondary"
                    >
                      Send feedback
                    </Button>
                  </Surface>
                </div>
              </>
            ) : null}
          </Surface>
        </div>
      )}
    </section>
  )
}
