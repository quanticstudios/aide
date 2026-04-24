import { Button, Chip, ScrollShadow, Tooltip } from '@heroui/react'
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  FolderKanban,
  GitBranch,
  Loader2,
  PanelLeftClose,
  Plus,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  compareWorkspacesByAttentionTier,
  formatWorkspaceActivityLabel,
  formatWorkspaceActivityPillLabel,
  resolveWorkspaceActivityAccentClassName,
  resolveWorkspaceActivityBorderColorClassName,
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
      return <CircleAlert className="size-3 shrink-0 text-red-400" />
    case 'pending-approval':
      return <CircleAlert className="size-3 shrink-0 text-amber-400" />
    case 'awaiting-input':
      return <CircleHelp className="size-3 shrink-0 text-indigo-300" />
    case 'working':
      return (
        <span className="flex size-3 shrink-0 items-center justify-center text-amber-400">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
        </span>
      )
    case 'connecting':
      return <Loader2 className="size-3 shrink-0 animate-spin text-sky-300" />
    case 'completed':
      return <CircleCheck className="size-3 shrink-0 text-emerald-300" />
    case 'terminal-running':
      return <Terminal className="size-3 shrink-0 text-emerald-300" />
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
    return 'text-primary'
  }

  if (mergeStatus === 'conflicts') {
    return 'text-red-400'
  }

  return 'text-muted-foreground/70'
}

function getWorkspaceBackgroundClassName(
  activity: WorkspaceActivitySnapshot | null | undefined,
  isActive: boolean,
): string {
  if (activity?.state === 'error') return 'bg-red-400/[0.03]'
  if (activity?.state === 'pending-approval') return 'bg-amber-400/[0.03]'
  if (activity?.state === 'awaiting-input') return 'bg-indigo-300/[0.03]'
  if (activity?.state === 'working') return 'sidebar-working-shimmer'
  if (isActive) return 'bg-primary/8'
  return ''
}

function ActivityPill({
  activity,
  onSelect,
}: {
  readonly activity: WorkspaceActivitySnapshot
  readonly onSelect: () => void
}) {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pill is inside a <button> row — keyboard access provided by parent
    <span
      className={cn(
        'flex shrink-0 cursor-pointer items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-tight',
        resolveWorkspaceActivityPillClassName(activity),
      )}
      onClick={(event) => {
        event.stopPropagation()
        onSelect()
      }}
    >
      {shouldPulseWorkspaceActivity(activity) ? (
        <span className="size-1.5 animate-pulse rounded-full bg-current" />
      ) : null}
      {formatWorkspaceActivityPillLabel(activity)}
    </span>
  )
}

export default function SidebarTree({
  activeProjectId,
  activeWorkspaceId,
  isExpanded,
  isPinnedOpen,
  onCreateProject,
  onCreateWorkspace,
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

  const sortedWorkspacesByProject = useMemo(() => {
    const result: Record<string, WorkspaceRecord[]> = {}

    for (const project of projects) {
      const projectWorkspaces = workspaces.filter(
        (ws) => ws.projectId === project.id,
      )

      result[project.id] = [...projectWorkspaces].sort((a, b) =>
        compareWorkspacesByAttentionTier(
          summaries[a.id]?.activity ?? null,
          a.updatedAt,
          summaries[b.id]?.activity ?? null,
          b.updatedAt,
        ),
      )
    }

    return result
  }, [projects, workspaces, summaries])

  // ── Collapsed rail ──────────────────────────────

  if (!isExpanded) {
    return (
      <aside
        className="flex h-full w-12 flex-col items-center border-r border-border bg-card/70 px-1 py-3"
        data-expanded="false"
        data-testid="workspace-tree-panel"
      >
        <button
          aria-label="Workspace sidebar"
          className="flex size-8 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground"
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
                  'relative flex size-9 items-center justify-center rounded-xl border text-[10px] font-semibold tracking-[0.1em] transition-all',
                  isActive
                    ? 'border-primary/60 bg-primary/12 text-primary'
                    : 'border-border bg-background text-muted-foreground hover:border-primary/35 hover:text-foreground',
                )}
                data-testid={`project-rail-button-${project.id}`}
                key={project.id}
                onClick={() => onSelectProject(project.id)}
                type="button"
              >
                {getProjectGlyph(project.name)}
                {attentionCount > 0 ? (
                  <span className="absolute -left-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full border border-amber-400/40 bg-amber-400/20 text-[9px] font-semibold text-amber-400">
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
                  <span className="absolute -right-1 -top-1 flex size-3.5 items-center justify-center rounded-full border border-border bg-background text-[8px] font-medium text-muted-foreground">
                    {index + 1}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <Button
          aria-label="Open project"
          className="size-8 rounded-xl"
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
      className="flex h-full w-72 flex-col overflow-hidden border-r border-border bg-card/55 transition-[width,opacity] duration-180 ease-out opacity-100"
      data-expanded="true"
      data-testid="workspace-tree-panel"
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Projects
        </p>

        <div className="flex items-center gap-0.5">
          {activeProjectId ? (
            <Button
              aria-label="Create workspace"
              className="size-7 rounded-lg"
              isIconOnly
              onPress={onCreateWorkspace}
              size="sm"
              variant="ghost"
            >
              <Plus className="size-3.5" />
            </Button>
          ) : null}

          <Button
            aria-label="Open project"
            className="size-7 rounded-lg"
            isIconOnly
            onPress={onCreateProject}
            size="sm"
            variant="ghost"
          >
            <FolderKanban className="size-3.5" />
          </Button>

          <Button
            aria-label={isPinnedOpen ? 'Unpin sidebar' : 'Pin sidebar open'}
            className={cn(
              'size-7 rounded-lg',
              isPinnedOpen && 'border-primary/50 bg-primary/10 text-primary',
            )}
            isIconOnly
            onPress={onTogglePinnedOpen}
            size="sm"
            variant="ghost"
          >
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      </div>

      <ScrollShadow className="min-h-0 flex-1" hideScrollBar size={36}>
        <div className="py-1.5">
          {projects.map((project, projectIndex) => {
            const projectWorkspaces =
              sortedWorkspacesByProject[project.id] ?? []
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
              <div key={project.id}>
                <div className="group/project flex items-center gap-1 px-2 py-1">
                  <button
                    aria-expanded={isProjectExpanded}
                    aria-label={`Toggle ${project.name} workspaces`}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
                    onClick={toggleProject}
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
                      'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-secondary',
                      isActiveProject
                        ? 'text-foreground'
                        : 'text-foreground/80',
                    )}
                    data-testid={`project-rail-button-${project.id}`}
                    onClick={toggleProject}
                    type="button"
                  >
                    <span className="truncate text-sm font-medium">
                      {project.name}
                    </span>
                    {attentionCount > 0 ? (
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-amber-400/15 text-[9px] font-semibold text-amber-400">
                        {attentionCount}
                      </span>
                    ) : null}
                  </button>

                  <button
                    aria-label={`New workspace in ${project.name}`}
                    className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-all hover:text-foreground group-hover/project:opacity-100"
                    onClick={() => {
                      onSelectProject(project.id)
                      onCreateWorkspace()
                    }}
                    type="button"
                  >
                    <Plus className="size-3.5" />
                  </button>

                  {showProjectHints ? (
                    <Chip
                      className="h-4 min-w-4 border border-border bg-background px-1 text-[9px] font-medium text-muted-foreground"
                      color="default"
                      size="sm"
                      variant="secondary"
                    >
                      {projectIndex + 1}
                    </Chip>
                  ) : null}
                </div>

                {isProjectExpanded && projectWorkspaces.length > 0 ? (
                  <div className="sidebar-tree-indent mx-3 pb-1">
                    {projectWorkspaces.map((workspace) => {
                      const isActiveWorkspace =
                        workspace.id === activeWorkspaceId
                      const summary = summaries[workspace.id]
                      const activity = summary?.activity ?? null
                      const visibleActivities =
                        summary?.activities
                          .filter((a) => a.state !== 'connecting')
                          .slice(0, 1) ?? []
                      const stats = branchStats[workspace.id]
                      const mergeLabel = stats
                        ? getMergeStatusLabel(stats.mergeStatus)
                        : ''
                      const attentionTier =
                        resolveWorkspaceAttentionTier(activity)
                      const borderColorClass = activity
                        ? resolveWorkspaceActivityBorderColorClassName(activity)
                        : isActiveWorkspace
                          ? 'border-l-primary'
                          : 'border-l-transparent'
                      const bgClass = getWorkspaceBackgroundClassName(
                        activity,
                        isActiveWorkspace,
                      )
                      const showGitStatsRow =
                        stats != null &&
                        (stats.additions > 0 ||
                          stats.deletions > 0 ||
                          (mergeLabel !== '' && mergeLabel !== 'Up to date'))

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
                            'group flex w-full flex-col gap-1 rounded-r-lg border-l-2 pl-2.5 pr-3 py-2 text-left transition-colors',
                            borderColorClass,
                            bgClass,
                            !activity &&
                              !isActiveWorkspace &&
                              'hover:bg-surface-secondary',
                          )}
                          onClick={() => onSelectWorkspace(workspace.id)}
                          type="button"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            {renderWorkspaceStateIcon({
                              activity,
                              isCurrent: isActiveWorkspace,
                            })}
                            <span
                              className={cn(
                                'truncate text-[13px]',
                                attentionTier === 'attention'
                                  ? 'font-semibold text-foreground'
                                  : isActiveWorkspace
                                    ? 'font-medium text-foreground'
                                    : 'font-medium text-foreground/80',
                              )}
                            >
                              {summary?.workspaceName ?? workspace.name}
                            </span>

                            {visibleActivities.length > 0 ? (
                              <span className="ml-auto flex shrink-0 items-center gap-1">
                                {visibleActivities.map((entry) => (
                                  <ActivityPill
                                    activity={entry}
                                    key={entry.sessionId}
                                    onSelect={() => {
                                      onSelectWorkspace(workspace.id)
                                      onSelectPane(entry.paneId)
                                    }}
                                  />
                                ))}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/70">
                            <span className="truncate font-mono">
                              {summary?.branchName ?? workspace.branchName}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums">
                              {formatRelativeTime(workspace.updatedAt)}
                            </span>
                          </div>

                          {showGitStatsRow && stats ? (
                            <div className="flex items-center gap-1.5 pl-5 text-[11px]">
                              {stats.additions > 0 || stats.deletions > 0 ? (
                                <span className="flex items-center gap-1.5 tabular-nums">
                                  <span className="text-green-400">
                                    +{stats.additions}
                                  </span>
                                  <span className="text-red-400">
                                    -{stats.deletions}
                                  </span>
                                </span>
                              ) : null}
                              {mergeLabel && mergeLabel !== 'Up to date' ? (
                                <>
                                  {stats.additions > 0 ||
                                  stats.deletions > 0 ? (
                                    <span className="text-muted-foreground/50">
                                      ·
                                    </span>
                                  ) : null}
                                  <span
                                    className={getMergeStatusClassName(
                                      stats.mergeStatus,
                                    )}
                                  >
                                    {mergeLabel}
                                  </span>
                                </>
                              ) : null}
                            </div>
                          ) : null}
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
                            className="rounded-xl border border-[#3a3a44] bg-[#28282f] px-2.5 py-1.5 text-xs text-foreground shadow-[var(--overlay-shadow)]"
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
    </aside>
  )
}
