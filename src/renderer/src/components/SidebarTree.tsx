import { Button, Kbd, ScrollShadow, Tooltip } from '@heroui/react'
import {
  Archive,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FolderKanban,
  GitBranch,
  Home,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Settings,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { formatWorkspaceShortcutLabel } from '@/lib/platform'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import {
  type WorkspaceSummary,
  resolveProjectSummaryActivity,
} from '@/lib/workspace-summary'
import type { WorktreeBranchStats } from '../../../shared/git'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../../shared/workspace-activity'
import {
  formatWorkspaceActivityLabel,
  formatWorkspaceActivityPillLabel,
  resolveWorkspaceActivityAccentClassName,
  resolveWorkspaceActivityDotClassName,
  resolveWorkspaceActivityPillClassName,
  resolveWorkspaceAttentionTier,
  shouldPulseWorkspaceActivity,
} from '../../../shared/workspace-activity'

const BRANCH_STATS_POLL_INTERVAL_MS = 30_000
const TIMESTAMP_TICK_INTERVAL_MS = 10_000

interface SidebarTreeProps {
  readonly activeProjectId: string | null
  readonly activeWorkspaceId: string | null
  readonly isExpanded: boolean
  readonly isPinnedOpen: boolean
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly onConfigureProjectSetup: (projectId: string) => void
  readonly onSelectHome: () => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onTogglePinnedOpen: () => void
  readonly projects: readonly ProjectRecord[]
  readonly showProjectHints: boolean
  readonly summaries: Record<string, WorkspaceSummary>
  readonly workspaces: readonly WorkspaceRecord[]
}

function getProjectGlyph(projectName: string): string {
  const [first = '', second = ''] = projectName
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)

  return (
    `${first}${second}`.slice(0, 2).toUpperCase() ||
    projectName.slice(0, 2).toUpperCase()
  )
}

function renderWorkspaceStateIcon(input: {
  activity: WorkspaceSummary['activity'] | null | undefined
  isCurrent: boolean
}) {
  const { activity, isCurrent } = input

  if (!activity) {
    return (
      <GitBranch
        className={cn(
          'size-3 shrink-0',
          isCurrent ? 'text-primary' : 'text-muted-foreground',
        )}
      />
    )
  }

  switch (activity.state) {
    case 'error':
      return <CircleAlert className="size-3 shrink-0 text-accent-red" />
    case 'pending-approval':
      return <CircleAlert className="size-3 shrink-0 text-accent-yellow" />
    case 'awaiting-input':
      return <CircleHelp className="size-3 shrink-0 text-accent-yellow" />
    case 'working':
      return (
        <span className="flex size-3 shrink-0 items-center justify-center text-accent-blue">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
        </span>
      )
    case 'connecting':
      return (
        <Loader2 className="size-3 shrink-0 animate-spin text-accent-blue" />
      )
    case 'completed':
      return <CircleCheck className="size-3 shrink-0 text-accent-green" />
    case 'plan-ready':
      return <CircleCheck className="size-3 shrink-0 text-accent-purple" />
    case 'terminal-running':
      return <Terminal className="size-3 shrink-0 text-accent-green" />
    default:
      return (
        <GitBranch
          className={cn(
            'size-3 shrink-0',
            resolveWorkspaceActivityAccentClassName(activity),
          )}
        />
      )
  }
}

function getMergeStatusLabel(
  mergeStatus: WorktreeBranchStats['mergeStatus'],
): string {
  if (mergeStatus === 'clean') {
    return 'Ready to merge'
  }

  if (mergeStatus === 'conflicts') {
    return 'Merge conflicts'
  }

  if (mergeStatus === 'up-to-date') {
    return 'Up to date'
  }

  return ''
}

function getMergeStatusClassName(
  mergeStatus: WorktreeBranchStats['mergeStatus'],
): string {
  if (mergeStatus === 'clean') {
    return 'text-accent-green'
  }

  if (mergeStatus === 'conflicts') {
    return 'text-accent-red'
  }

  return 'text-muted-foreground/70'
}

function getWorkspaceBackgroundClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
  isActive: boolean,
): string {
  if (activity?.state === 'error') return 'bg-accent-red/[0.03]'
  if (activity?.state === 'pending-approval') return 'bg-accent-yellow/[0.03]'
  if (activity?.state === 'awaiting-input') return 'bg-accent-yellow/[0.03]'
  if (activity?.state === 'working') return 'sidebar-working-shimmer'
  if (activity?.state === 'connecting') return 'sidebar-working-shimmer'
  if (activity?.state === 'plan-ready') return 'bg-accent-purple-soft'
  if (isActive) return 'bg-surface-elevated'
  return ''
}

function ActivityPill({
  activity,
}: {
  readonly activity: WorkspaceActivitySnapshot
}) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-semibold leading-tight',
        resolveWorkspaceActivityPillClassName(activity),
      )}
    >
      {shouldPulseWorkspaceActivity(activity) ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {formatWorkspaceActivityPillLabel(activity)}
    </span>
  )
}

function ProjectOverflowMenu({
  onConfigureSetup,
  projectName,
}: {
  readonly onConfigureSetup: () => void
  readonly projectName: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const popoverRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleClickOutside(event: MouseEvent): void {
      if (
        event.target instanceof Node &&
        !triggerRef.current?.contains(event.target) &&
        !popoverRef.current?.contains(event.target)
      ) {
        setIsOpen(false)
      }
    }

    function handleKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  return (
    <div className="relative">
      <button
        aria-label={`More options for ${projectName}`}
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:bg-surface-secondary hover:text-foreground group-hover/project:opacity-100"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <MoreHorizontal className="size-3.5" />
      </button>
      {isOpen ? (
        <div
          className="absolute right-0 top-full z-30 mt-1 w-44 rounded-md border border-border bg-surface py-1 shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
          ref={popoverRef}
        >
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-secondary"
            onClick={() => {
              onConfigureSetup()
              setIsOpen(false)
            }}
            type="button"
          >
            <Settings className="size-3.5" />
            Configure worktree setup
          </button>
          {(
            [
              { id: 'rename', label: 'Rename project' },
              { id: 'archive', label: 'Archive project' },
              { id: 'delete', label: 'Delete project' },
            ] as const
          ).map((option) => (
            <button
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs text-muted-foreground opacity-60"
              disabled
              key={option.id}
              type="button"
            >
              {option.label}
              <span className="text-[10px] text-muted-foreground/60">Soon</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function SidebarTree({
  activeProjectId,
  activeWorkspaceId,
  isExpanded,
  isPinnedOpen,
  onCreateProject,
  onCreateWorkspace,
  onConfigureProjectSetup,
  onSelectHome,
  onSelectPane,
  onSelectProject,
  onSelectWorkspace,
  onTogglePinnedOpen,
  projects,
  showProjectHints,
  summaries,
  workspaces,
}: SidebarTreeProps) {
  const [expandedProjectIds, setExpandedProjectIds] = useState<
    Record<string, boolean>
  >({})
  const [branchStats, setBranchStats] = useState<
    Record<string, WorktreeBranchStats>
  >({})
  const [, setTimestampTick] = useState(0)
  const pollTimerRef = useRef<number | null>(null)

  useEffect(() => {
    if (!activeProjectId) {
      return
    }

    setExpandedProjectIds((current) => ({
      ...current,
      [activeProjectId]: true,
    }))
  }, [activeProjectId])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTimestampTick((tick) => tick + 1)
    }, TIMESTAMP_TICK_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [])

  const fetchBranchStatsForVisibleWorkspaces = useCallback(async () => {
    if (!isExpanded || !document.hasFocus()) {
      return
    }

    const api =
      typeof window !== 'undefined'
        ? ((
            window as {
              aide?: {
                getWorktreeBranchStats?: (
                  id: string,
                ) => Promise<{ ok: boolean; stats?: WorktreeBranchStats }>
              }
            }
          ).aide ?? null)
        : null

    if (!api?.getWorktreeBranchStats) {
      return
    }

    const visibleWorkspaceIds = workspaces
      .filter((workspace) => {
        const isProjectExpanded =
          expandedProjectIds[workspace.projectId] ??
          workspace.projectId === activeProjectId

        return isProjectExpanded
      })
      .map((workspace) => workspace.id)

    const results = await Promise.allSettled(
      visibleWorkspaceIds.map(async (workspaceId) => {
        const result = await api.getWorktreeBranchStats?.(workspaceId)

        if (result?.ok && result.stats) {
          return { workspaceId, stats: result.stats }
        }

        return null
      }),
    )

    const newStats: Record<string, WorktreeBranchStats> = {}

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        newStats[result.value.workspaceId] = result.value.stats
      }
    }

    setBranchStats((current) => ({ ...current, ...newStats }))
  }, [isExpanded, workspaces, expandedProjectIds, activeProjectId])

  useEffect(() => {
    void fetchBranchStatsForVisibleWorkspaces()

    if (pollTimerRef.current !== null) {
      window.clearInterval(pollTimerRef.current)
    }

    pollTimerRef.current = window.setInterval(() => {
      void fetchBranchStatsForVisibleWorkspaces()
    }, BRANCH_STATS_POLL_INTERVAL_MS)

    return () => {
      if (pollTimerRef.current !== null) {
        window.clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [fetchBranchStatsForVisibleWorkspaces])

  const workspacesByProject = useMemo(() => {
    const result: Record<string, WorkspaceRecord[]> = {}

    for (const workspace of workspaces) {
      const list = result[workspace.projectId] ?? []
      list.push(workspace)
      result[workspace.projectId] = list
    }

    return result
  }, [workspaces])

  // ── Collapsed rail ──────────────────────────────

  if (!isExpanded) {
    return (
      <aside
        className="flex h-full w-12 flex-col items-center border-r border-border bg-sidebar px-1 py-3"
        data-expanded="false"
        data-testid="workspace-tree-panel"
      >
        <button
          aria-label="Workspace sidebar"
          className="flex size-8 items-center justify-center rounded-md border border-border bg-surface text-muted-foreground"
          tabIndex={0}
          type="button"
        >
          <FolderKanban className="size-3.5" />
        </button>

        <div className="mt-4 flex flex-1 flex-col items-center gap-2">
          {projects.map((project, index) => {
            const isActive = project.id === activeProjectId
            const projectActivity = resolveProjectSummaryActivity(
              summaries,
              workspaces,
              project.id,
            )
            const attentionCount = workspaces
              .filter((ws) => ws.projectId === project.id)
              .filter(
                (ws) =>
                  resolveWorkspaceAttentionTier(
                    summaries[ws.id]?.activity ?? null,
                  ) === 'attention',
              ).length

            return (
              <button
                aria-label={`Project ${project.name}`}
                className={cn(
                  'relative flex size-9 items-center justify-center rounded-md border text-[10px] font-semibold tracking-[0.1em] transition-colors',
                  isActive
                    ? 'border-border bg-surface-elevated text-foreground'
                    : 'border-border bg-surface text-muted-foreground hover:bg-surface-secondary hover:text-foreground',
                )}
                data-testid={`project-rail-button-${project.id}`}
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                type="button"
              >
                {getProjectGlyph(project.name)}
                {attentionCount > 0 ? (
                  <span className="absolute -left-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-accent-yellow-soft text-[9px] font-semibold text-accent-yellow">
                    {attentionCount}
                  </span>
                ) : projectActivity ? (
                  <span
                    className={cn(
                      'absolute -left-0.5 -top-0.5 size-2.5 rounded-full',
                      resolveWorkspaceActivityDotClassName(projectActivity),
                      shouldPulseWorkspaceActivity(projectActivity) &&
                        'animate-pulse',
                    )}
                  />
                ) : null}
                {showProjectHints ? (
                  <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-border bg-surface-tertiary text-[8px] font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <Button
          aria-label="Open project"
          className="size-8 rounded-md"
          isIconOnly
          onPress={onCreateProject}
          size="sm"
          variant="ghost"
        >
          <Plus className="size-3.5" />
        </Button>
      </aside>
    )
  }

  // ── Expanded tree ───────────────────────────────

  return (
    <aside
      className="flex h-full w-72 flex-col overflow-hidden border-r border-border bg-sidebar transition-[width,opacity] duration-180 ease-out opacity-100"
      data-expanded="true"
      data-testid="workspace-tree-panel"
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <button
          aria-current={activeProjectId === null ? 'true' : undefined}
          className={cn(
            'project-row flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left',
            activeProjectId === null && 'is-active',
          )}
          data-testid="sidebar-home-button"
          onClick={onSelectHome}
          type="button"
        >
          <Home className="size-3.5 text-muted-foreground" />
          <span className="truncate text-sm font-semibold text-foreground">
            Home
          </span>
        </button>

        <Button
          aria-label={isPinnedOpen ? 'Unpin sidebar' : 'Pin sidebar open'}
          className={cn(
            'size-7 rounded-md',
            isPinnedOpen && 'border-border bg-surface-elevated text-foreground',
          )}
          isIconOnly
          onPress={onTogglePinnedOpen}
          size="sm"
          variant="ghost"
        >
          <PanelLeftClose className="size-3.5" />
        </Button>
      </div>

      <ScrollShadow className="min-h-0 flex-1" hideScrollBar size={36}>
        <div className="py-1.5">
          {projects.map((project, projectIndex) => {
            const projectWorkspaces = workspacesByProject[project.id] ?? []
            const isActiveProject = project.id === activeProjectId
            const attentionCount = projectWorkspaces.filter(
              (ws) =>
                resolveWorkspaceAttentionTier(
                  summaries[ws.id]?.activity ?? null,
                ) === 'attention',
            ).length
            const isProjectExpanded =
              expandedProjectIds[project.id] ?? isActiveProject

            function toggleProject(): void {
              setExpandedProjectIds((current) => ({
                ...current,
                [project.id]: !(current[project.id] ?? isActiveProject),
              }))
            }

            return (
              <div
                className={cn(
                  projectIndex > 0 && 'mt-1.5 border-t border-border/60 pt-1.5',
                )}
                key={project.id}
              >
                <div className="group/project flex items-center gap-1 px-2 py-1">
                  <button
                    aria-expanded={isProjectExpanded}
                    aria-label={`Toggle ${project.name} workspaces`}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors group-hover/project:text-foreground"
                    onClick={() => onSelectProject(project.id)}
                    type="button"
                  >
                    <ChevronRight
                      className={cn(
                        'size-3.5 transition-transform',
                        isProjectExpanded ? 'rotate-90' : 'rotate-0',
                      )}
                    />
                  </button>

                  <button
                    aria-current={isActiveProject ? 'true' : undefined}
                    className={cn(
                      'flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-secondary',
                      isActiveProject
                        ? 'text-foreground'
                        : 'text-foreground/80',
                    )}
                    data-testid={`project-rail-button-${project.id}`}
                    onClick={toggleProject}
                    type="button"
                  >
                    <span className="truncate text-sm font-semibold">
                      {project.name}
                    </span>
                    {showProjectHints && projectIndex < 9 ? (
                      <Kbd className="keycap ml-auto !h-4 !min-w-4 !px-1.5 !text-[9px] tabular-nums">
                        {formatWorkspaceShortcutLabel(projectIndex + 1)}
                      </Kbd>
                    ) : null}
                    {attentionCount > 0 ? (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-accent-yellow-soft text-[9px] font-semibold text-accent-yellow">
                        {attentionCount}
                      </span>
                    ) : null}
                  </button>
                  <ProjectOverflowMenu
                    onConfigureSetup={() => onConfigureProjectSetup(project.id)}
                    projectName={project.name}
                  />
                </div>

                {isProjectExpanded ? (
                  <div className="mx-3 pb-1">
                    <button
                      aria-label={`New workspace in ${project.name}`}
                      className="row-hover flex w-full items-center gap-2 rounded-md py-1.5 pl-5 pr-2 text-left text-[12.5px] text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        onSelectProject(project.id)
                        onCreateWorkspace()
                      }}
                      type="button"
                    >
                      <Plus className="size-3.5" />
                      <span>New workspace</span>
                    </button>
                    {projectWorkspaces.map((workspace) => {
                      const isActiveWorkspace =
                        workspace.id === activeWorkspaceId
                      const summary = summaries[workspace.id]
                      const activity = summary?.activity ?? null
                      const visibleActivities =
                        summary?.activities.slice(0, 1) ?? []
                      const stats = branchStats[workspace.id]
                      const mergeLabel = stats
                        ? getMergeStatusLabel(stats.mergeStatus)
                        : ''
                      const attentionTier =
                        resolveWorkspaceAttentionTier(activity)
                      const bgClass = getWorkspaceBackgroundClassName(
                        activity,
                        isActiveWorkspace,
                      )
                      const tooltipContent = summary?.activities.length ? (
                        <div className="flex flex-col gap-1">
                          {summary.activities.map((entry) => (
                            <div
                              className="flex items-center gap-1.5"
                              key={entry.sessionId}
                            >
                              <span
                                className={cn(
                                  'size-1.5 shrink-0 rounded-full',
                                  resolveWorkspaceActivityDotClassName(entry),
                                )}
                              />
                              <span>{formatWorkspaceActivityLabel(entry)}</span>
                              {entry.detail ? (
                                <span className="ml-1 text-muted-foreground/70">
                                  —{' '}
                                  {entry.detail.length > 120
                                    ? `${entry.detail.slice(0, 120)}…`
                                    : entry.detail}
                                </span>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null

                      const rowElement = (
                        <button
                          className={cn(
                            'group relative flex w-full cursor-pointer flex-col gap-1 rounded-md py-2 pl-3 pr-3 text-left transition-colors',
                            bgClass,
                            isActiveWorkspace &&
                              'bg-primary/10 ring-1 ring-inset ring-primary/40',
                            !activity &&
                              !isActiveWorkspace &&
                              'hover:bg-surface-secondary',
                          )}
                          onClick={() => {
                            onSelectWorkspace(workspace.id)
                            if (activity) {
                              onSelectPane(activity.paneId)
                            }
                          }}
                          type="button"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {renderWorkspaceStateIcon({
                              activity,
                              isCurrent: isActiveWorkspace,
                            })}
                            <span
                              className={cn(
                                'truncate text-[13px] font-semibold',
                                attentionTier === 'attention' ||
                                  isActiveWorkspace
                                  ? 'text-foreground'
                                  : 'text-foreground/95',
                              )}
                            >
                              {summary?.workspaceName ?? workspace.name}
                            </span>

                            <span className="ml-auto flex shrink-0 items-center gap-1.5">
                              {visibleActivities.length > 0 ? (
                                visibleActivities.map((entry) => (
                                  <ActivityPill
                                    activity={entry}
                                    key={entry.sessionId}
                                  />
                                ))
                              ) : stats &&
                                (stats.additions > 0 || stats.deletions > 0) ? (
                                <span className="inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-surface-elevated px-1.5 py-px text-[10px] font-semibold tabular-nums">
                                  <span className="text-accent-green">
                                    +{stats.additions}
                                  </span>
                                  <span className="text-accent-red">
                                    -{stats.deletions}
                                  </span>
                                </span>
                              ) : null}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/70">
                            <span className="truncate font-mono">
                              {summary?.branchName ?? workspace.branchName}
                            </span>
                            {mergeLabel && mergeLabel !== 'Up to date' ? (
                              <>
                                <span className="text-muted-foreground/50">
                                  ·
                                </span>
                                <span
                                  className={cn(
                                    'truncate',
                                    stats
                                      ? getMergeStatusClassName(
                                          stats.mergeStatus,
                                        )
                                      : '',
                                  )}
                                >
                                  {mergeLabel}
                                </span>
                              </>
                            ) : (
                              <span className="ml-1 shrink-0 tabular-nums">
                                {formatRelativeTime(workspace.updatedAt)}
                              </span>
                            )}
                          </div>
                        </button>
                      )

                      if (!tooltipContent) {
                        return <div key={workspace.id}>{rowElement}</div>
                      }

                      return (
                        <Tooltip delay={400} key={workspace.id}>
                          <Tooltip.Trigger className="w-full">
                            {rowElement}
                          </Tooltip.Trigger>
                          <Tooltip.Content
                            className="rounded-md border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-foreground"
                            placement="right"
                          >
                            {tooltipContent}
                          </Tooltip.Content>
                        </Tooltip>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </ScrollShadow>

      <div className="flex items-center gap-1 border-t border-border px-2 py-2">
        <Button
          className="flex h-7 flex-1 items-center justify-start gap-2 rounded-md px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
          onPress={onCreateProject}
          variant="ghost"
        >
          <FolderKanban className="size-3.5" />
          Add repository
        </Button>
        <button
          aria-label="Archive view (coming soon)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-surface-secondary hover:text-foreground"
          disabled
          type="button"
        >
          <Archive className="size-3.5" />
        </button>
        <button
          aria-label="Comments (coming soon)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-surface-secondary hover:text-foreground"
          disabled
          type="button"
        >
          <MessageSquare className="size-3.5" />
        </button>
        <button
          aria-label="Settings (coming soon)"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-50 hover:bg-surface-secondary hover:text-foreground"
          disabled
          type="button"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </aside>
  )
}
