import { Button, Chip, ScrollShadow } from '@heroui/react'
import {
  ChevronRight,
  FolderKanban,
  GitBranch,
  PanelLeftClose,
  Plus,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

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
import {
  formatWorkspaceActivityLabel,
  resolveWorkspaceActivityAccentClassName,
  resolveWorkspaceActivityDotClassName,
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

function getWorkspaceIndicatorClassName(input: {
  activity: WorkspaceSummary['activity'] | null | undefined
  isCurrent: boolean
}): string {
  if (input.activity) {
    return resolveWorkspaceActivityAccentClassName(input.activity)
  }

  if (input.isCurrent) {
    return 'text-primary'
  }

  return 'text-muted-foreground'
}

function renderActivityDot(
  activity: WorkspaceSummary['activity'] | null | undefined,
  sizeClassName = 'size-2',
) {
  if (!activity) {
    return null
  }

  return (
    <span
      className={cn(
        'rounded-full',
        resolveWorkspaceActivityDotClassName(activity),
        shouldPulseWorkspaceActivity(activity) && 'animate-pulse',
        sizeClassName,
      )}
    />
  )
}

function getProjectStatusIconClassName(
  activity: WorkspaceSummary['activity'] | null | undefined,
): string {
  if (activity) {
    return resolveWorkspaceActivityAccentClassName(activity)
  }

  return 'text-muted-foreground'
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

export default function SidebarTree({
  activeProjectId,
  activeWorkspaceId,
  isExpanded,
  isPinnedOpen,
  onCreateProject,
  onCreateWorkspace,
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

  // Timestamp refresh tick
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
      typeof window !== 'undefined' ? (window as { aide?: { getWorktreeBranchStats?: (id: string) => Promise<{ ok: boolean; stats?: WorktreeBranchStats }> } }).aide : null

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
        const result = await api.getWorktreeBranchStats!(workspaceId)

        if (result.ok && result.stats) {
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

  // Fetch branch stats on mount, project expand, and poll interval
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

  // ── Collapsed rail ──────────────────────────────

  if (!isExpanded) {
    return (
      <aside
        className="flex h-full w-12 flex-col items-center border-r border-border bg-card/70 px-1 py-3"
        data-expanded="false"
        data-testid="workspace-tree-panel"
      >
        <button
          aria-label="aide"
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

            return (
              <button
                aria-label={project.name}
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
                {projectActivity ? (
                  <span className="absolute -left-0.5 -top-0.5">
                    {renderActivityDot(projectActivity, 'size-2.5')}
                  </span>
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
      className="flex h-full w-64 flex-col overflow-hidden border-r border-border bg-card/55 transition-[width,opacity] duration-180 ease-out opacity-100"
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
            const projectWorkspaces = workspaces.filter(
              (workspace) => workspace.projectId === project.id,
            )
            const isActiveProject = project.id === activeProjectId
            const projectActivity = resolveProjectSummaryActivity(
              summaries,
              workspaces,
              project.id,
            )
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
                <div className="flex items-center gap-1 px-2 py-1">
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
                      'flex min-w-0 flex-1 items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors',
                      isActiveProject
                        ? 'text-foreground'
                        : 'text-foreground/80 hover:bg-surface-secondary',
                    )}
                    data-testid={`project-rail-button-${project.id}`}
                    onClick={() => onSelectProject(project.id)}
                    type="button"
                  >
                    {renderActivityDot(projectActivity)}
                    <span className="truncate text-sm font-medium">
                      {project.name}
                    </span>
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
                  <div className="sidebar-tree-indent ml-3 pb-1">
                    {projectWorkspaces.map((workspace) => {
                      const isActiveWorkspace =
                        workspace.id === activeWorkspaceId
                      const summary = summaries[workspace.id]
                      const activity = summary?.activity ?? null
                      const stats = branchStats[workspace.id]
                      const mergeLabel = stats
                        ? getMergeStatusLabel(stats.mergeStatus)
                        : ''
                      const activityLabel = activity
                        ? formatWorkspaceActivityLabel(activity)
                        : null

                      return (
                        <button
                          className={cn(
                            'group flex w-full flex-col gap-0.5 rounded-lg px-3 py-1.5 text-left transition-colors',
                            isActiveWorkspace
                              ? 'border-l-2 border-primary bg-primary/8 ml-[-1px]'
                              : 'hover:bg-surface-secondary',
                          )}
                          key={workspace.id}
                          onClick={() => onSelectWorkspace(workspace.id)}
                          type="button"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <GitBranch
                              className={cn(
                                'size-3 shrink-0',
                                getWorkspaceIndicatorClassName({
                                  activity,
                                  isCurrent: isActiveWorkspace,
                                }),
                              )}
                            />
                            <span
                              className={cn(
                                'truncate text-[13px] font-medium',
                                isActiveWorkspace
                                  ? 'text-foreground'
                                  : 'text-foreground/80',
                              )}
                            >
                              {summary?.workspaceName ?? workspace.name}
                            </span>

                            {stats &&
                            (stats.additions > 0 || stats.deletions > 0) ? (
                              <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[11px] tabular-nums">
                                <span className="text-green-400">
                                  +{stats.additions}
                                </span>
                                <span className="text-red-400">
                                  -{stats.deletions}
                                </span>
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/70">
                            <span className="truncate">
                              {summary?.branchName ?? workspace.branchName}
                            </span>
                            {activityLabel ? (
                              <>
                                <span>·</span>
                                <span
                                  className={cn(
                                    'shrink-0',
                                    getProjectStatusIconClassName(activity),
                                  )}
                                  title={activity?.detail ?? activityLabel}
                                >
                                  {activityLabel}
                                </span>
                              </>
                            ) : mergeLabel ? (
                              <>
                                <span>·</span>
                                <span
                                  className={cn(
                                    'shrink-0',
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
                            ) : null}
                            <span className="ml-auto shrink-0 tabular-nums">
                              {formatRelativeTime(workspace.updatedAt)}
                            </span>
                          </div>
                        </button>
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
