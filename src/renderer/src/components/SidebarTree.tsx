import {
  Button,
  Dropdown,
  Input,
  Kbd,
  Popover,
  ScrollShadow,
  Tooltip,
} from '@heroui/react'
import {
  Archive,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Folder,
  FolderKanban,
  GitBranch,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Settings,
  Terminal,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { formatWorkspaceShortcutLabel } from '@/lib/platform'
import { formatRelativeTime } from '@/lib/relative-time'
import { cn } from '@/lib/utils'
import type { WorkspaceSummary } from '@/lib/workspace-summary'
import aideIcon from '../../../../build/icon.png'
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
import './SidebarTree.css'

const BRANCH_STATS_POLL_INTERVAL_MS = 30_000
const TIMESTAMP_TICK_INTERVAL_MS = 10_000

interface SidebarTreeProps {
  readonly activeProjectId: string | null
  readonly activeWorkspaceId: string | null
  readonly isExpanded: boolean
  readonly onCreateChat: (projectId: string, workspaceId?: string) => void
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: (projectId?: string) => void
  readonly onConfigureProjectSetup: (projectId: string) => void
  readonly onOpenSettings: (trigger: HTMLElement) => void
  readonly onSelectPane: (paneId: string) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onRenameWorkspace: (
    workspaceId: string,
    name: string,
  ) => Promise<string | null>
  readonly projects: readonly ProjectRecord[]
  readonly showProjectHints: boolean
  readonly summaries: Record<string, WorkspaceSummary>
  readonly workspaces: readonly WorkspaceRecord[]
}

function renderWorkspaceStateIcon(input: {
  activity: WorkspaceSummary['activity'] | null | undefined
  isCurrent: boolean
  projectKind: ProjectRecord['kind']
}) {
  const { activity, isCurrent, projectKind } = input

  if (!activity) {
    if (projectKind === 'folder') {
      return (
        <Folder
          className={cn(
            'size-3 shrink-0',
            isCurrent ? 'text-primary' : 'text-muted-foreground',
          )}
        />
      )
    }

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

function isActiveAgentActivity(activity: WorkspaceActivitySnapshot): boolean {
  return (
    activity.state === 'working' ||
    activity.state === 'connecting' ||
    activity.state === 'pending-approval' ||
    activity.state === 'awaiting-input'
  )
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
        className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-[opacity,color,background-color] hover:bg-surface-secondary hover:text-foreground group-hover/project:opacity-100"
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
            Configure project setup
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

function WorkspaceOverflowMenu({
  onCreateChat,
  onRename,
  workspace,
}: {
  readonly onCreateChat: () => void
  readonly onRename: (name: string) => Promise<string | null>
  readonly workspace: WorkspaceRecord
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [name, setName] = useState(workspace.name)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const closeMenu = useCallback(() => {
    setIsOpen(false)
    setIsRenaming(false)
    setName(workspace.name)
    setError(null)
  }, [workspace.name])

  return (
    <Popover
      isOpen={isOpen}
      onOpenChange={(nextIsOpen) => {
        setIsOpen(nextIsOpen)
        if (!nextIsOpen) {
          setIsRenaming(false)
          setName(workspace.name)
          setError(null)
        }
      }}
    >
      <Popover.Trigger
        aria-label={`More options for workspace ${workspace.name}`}
        className="flex size-6 min-h-6 min-w-6 flex-none shrink-0 cursor-pointer items-center justify-center rounded bg-transparent text-muted-foreground opacity-0 outline-none hover:bg-surface-secondary data-[pressed]:bg-transparent group-hover/workspace:opacity-100 group-focus-within/workspace:opacity-100 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-primary/60"
        data-workspace-actions-trigger="true"
      >
        <MoreHorizontal className="size-4 shrink-0" />
      </Popover.Trigger>
      <Popover.Content
        className={cn(
          'rounded-md border border-border bg-surface p-0 shadow-[0_20px_60px_rgba(0,0,0,0.4)]',
          isRenaming ? 'w-56' : 'w-[11.25rem]',
        )}
        placement="bottom end"
      >
        <Popover.Dialog className="p-0 outline-none">
          {isRenaming ? (
            <form
              className="space-y-2 p-2"
              onSubmit={async (event) => {
                event.preventDefault()
                setIsSaving(true)
                const nextError = await onRename(name)
                setIsSaving(false)
                if (nextError) {
                  setError(nextError)
                  return
                }
                closeMenu()
              }}
            >
              <Input
                aria-label="Workspace name"
                autoFocus
                maxLength={80}
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              {error ? (
                <p className="text-xs text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="flex justify-end gap-1">
                <Button
                  isDisabled={isSaving}
                  onPress={closeMenu}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
                <Button
                  isDisabled={isSaving || name.trim().length === 0}
                  size="sm"
                  type="submit"
                  variant="primary"
                >
                  {isSaving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          ) : (
            <div className="p-1">
              <Button
                className="h-8 w-full justify-start px-2 text-xs"
                onPress={() => {
                  onCreateChat()
                  closeMenu()
                }}
                size="sm"
                variant="ghost"
              >
                New chat
              </Button>
              <Button
                className="h-8 w-full justify-start px-2 text-xs"
                onPress={() => {
                  void navigator.clipboard.writeText(workspace.worktreePath)
                  closeMenu()
                }}
                size="sm"
                variant="ghost"
              >
                Copy folder path
              </Button>
              <Button
                className="h-8 w-full justify-start px-2 text-xs"
                onPress={() => {
                  setIsRenaming(true)
                  setName(workspace.name)
                }}
                size="sm"
                variant="ghost"
              >
                Rename workspace
              </Button>
            </div>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}

export default function SidebarTree({
  activeProjectId,
  activeWorkspaceId,
  isExpanded,
  onCreateChat,
  onCreateProject,
  onCreateWorkspace,
  onConfigureProjectSetup,
  onOpenSettings,
  onSelectPane,
  onSelectProject,
  onSelectWorkspace,
  onRenameWorkspace,
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
        if (
          projects.find((project) => project.id === workspace.projectId)
            ?.kind === 'folder'
        ) {
          return false
        }
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
  }, [isExpanded, workspaces, projects, expandedProjectIds, activeProjectId])

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

  const expandedTree = (
    <aside
      aria-hidden={!isExpanded}
      className="sidebar-tree-expanded absolute inset-y-0 left-0 z-20 flex w-72 flex-col overflow-hidden border-r border-border bg-sidebar"
      data-sidebar-surface="expanded"
      data-visible={isExpanded ? 'true' : 'false'}
      inert={!isExpanded}
    >
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-3">
        <div
          className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1"
          data-testid="sidebar-brand"
        >
          <img
            alt=""
            className="size-6 shrink-0 object-contain"
            src={aideIcon}
            style={{ transform: 'translateY(-3px)' }}
          />
          <span className="truncate text-sm font-semibold text-foreground">
            aIDE
          </span>
        </div>
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
            const projectAgentActivities = projectWorkspaces.flatMap(
              (workspace) => summaries[workspace.id]?.activities ?? [],
            )
            const activeAgentCount = projectAgentActivities.filter(
              isActiveAgentActivity,
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

                  <Tooltip closeDelay={100} delay={500}>
                    <Tooltip.Trigger
                      aria-current={isActiveProject ? 'true' : undefined}
                      aria-expanded={isProjectExpanded}
                      className={cn(
                        'flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60',
                        isActiveProject
                          ? 'text-foreground'
                          : 'text-foreground/80',
                      )}
                      data-testid={
                        isExpanded
                          ? `project-rail-button-${project.id}`
                          : undefined
                      }
                      data-sidebar-focus-key={`project-${project.id}`}
                      onClick={toggleProject}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return
                        event.preventDefault()
                        toggleProject()
                      }}
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
                    </Tooltip.Trigger>
                    <Tooltip.Content
                      className="w-64 rounded-lg border border-border bg-surface-elevated p-3 text-foreground shadow-[0_16px_48px_rgba(0,0,0,0.36)]"
                      placement="right"
                    >
                      <div className="flex flex-col gap-1.5">
                        <span className="truncate text-[13px] font-semibold">
                          {project.name}
                        </span>
                        <span className="text-[12px] text-muted-foreground">
                          {projectAgentActivities.length}{' '}
                          {projectAgentActivities.length === 1
                            ? 'agent'
                            : 'agents'}{' '}
                          · {activeAgentCount} active
                        </span>
                        <span className="break-all font-mono text-[11px] leading-4 text-muted-foreground/80">
                          {project.repoRoot}
                        </span>
                      </div>
                    </Tooltip.Content>
                  </Tooltip>
                  <Dropdown>
                    <Dropdown.Trigger
                      aria-label={`Add to ${project.name}`}
                      className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
                    >
                      <Plus className="size-3.5 shrink-0" />
                    </Dropdown.Trigger>
                    <Dropdown.Popover
                      className="min-w-44 rounded-md border border-border bg-surface p-1 shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
                      placement="bottom end"
                    >
                      <Dropdown.Menu aria-label={`Add to ${project.name}`}>
                        <Dropdown.Item
                          id="new-chat"
                          onAction={() => onCreateChat(project.id)}
                          textValue="New chat"
                        >
                          New chat
                        </Dropdown.Item>
                        {project.kind === 'git' ? (
                          <Dropdown.Item
                            id="new-workspace"
                            onAction={() => {
                              onSelectProject(project.id)
                              onCreateWorkspace(project.id)
                            }}
                            textValue="New workspace"
                          >
                            New workspace
                          </Dropdown.Item>
                        ) : null}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                  <ProjectOverflowMenu
                    onConfigureSetup={() => onConfigureProjectSetup(project.id)}
                    projectName={project.name}
                  />
                </div>

                {isProjectExpanded ? (
                  <div className="mx-3 pb-1">
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
                      const tooltipContent = (
                        <div className="flex max-w-sm flex-col gap-1">
                          <span className="font-medium">{workspace.name}</span>
                          {project.kind === 'git' ? (
                            <span className="break-all font-mono">
                              {summary?.branchName ?? workspace.branchName}
                            </span>
                          ) : null}
                          <span className="break-all text-muted-foreground">
                            {workspace.worktreePath}
                          </span>
                          {stats &&
                          (stats.additions > 0 || stats.deletions > 0) ? (
                            <span>
                              <span className="text-accent-green">
                                +{stats.additions}
                              </span>{' '}
                              <span className="text-accent-red">
                                -{stats.deletions}
                              </span>
                            </span>
                          ) : null}
                          {summary?.activities.map((entry) => (
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
                      )

                      const rowElement = (
                        <div
                          className="group/workspace relative"
                          onContextMenu={(event) => {
                            event.preventDefault()
                            event.currentTarget
                              .querySelector<HTMLElement>(
                                '[data-workspace-actions-trigger="true"]',
                              )
                              ?.click()
                          }}
                        >
                          <button
                            className={cn(
                              'group relative flex w-full cursor-pointer flex-col gap-1 rounded-md py-2 pl-3 pr-10 text-left transition-colors',
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
                                projectKind: project.kind,
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
                                {visibleActivities.length > 0
                                  ? visibleActivities.map((entry) => (
                                      <ActivityPill
                                        activity={entry}
                                        key={entry.sessionId}
                                      />
                                    ))
                                  : null}
                              </span>
                            </div>

                            <div className="flex w-full min-w-0 items-center gap-1.5 pl-5 text-[11px] text-muted-foreground/70">
                              {stats &&
                              (stats.additions > 0 || stats.deletions > 0) ? (
                                <span
                                  className="inline-flex shrink-0 items-center gap-1.5 text-[10px] font-semibold tabular-nums"
                                  data-testid="workspace-change-counts"
                                >
                                  <span className="text-accent-green">
                                    +{stats.additions}
                                  </span>
                                  <span className="text-accent-red">
                                    -{stats.deletions}
                                  </span>
                                </span>
                              ) : null}
                              <span className="min-w-0 truncate font-mono">
                                {project.kind === 'folder'
                                  ? 'Folder'
                                  : (summary?.branchName ??
                                    workspace.branchName)}
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
                          <div className="absolute right-1 top-1.5">
                            <WorkspaceOverflowMenu
                              onCreateChat={() =>
                                onCreateChat(project.id, workspace.id)
                              }
                              onRename={(name) =>
                                onRenameWorkspace(workspace.id, name)
                              }
                              workspace={workspace}
                            />
                          </div>
                        </div>
                      )

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
          data-sidebar-focus-key="add-project"
          onPress={onCreateProject}
          variant="ghost"
        >
          <FolderKanban className="size-3.5" />
          Add project folder
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
          aria-label="Open settings"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-sidebar-focus-key="settings"
          onClick={(event) => onOpenSettings(event.currentTarget)}
          type="button"
        >
          <Settings className="size-3.5" />
        </button>
      </div>
    </aside>
  )

  return (
    <div
      className="relative h-full w-full overflow-visible"
      data-expanded={isExpanded ? 'true' : 'false'}
      data-testid="workspace-tree-panel"
    >
      {expandedTree}
    </div>
  )
}
