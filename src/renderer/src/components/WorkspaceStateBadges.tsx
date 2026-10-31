import { Chip } from '@heroui/react'

import type { WorkspaceSummary } from '@/lib/workspace-summary'
import { formatWorkspaceActivityLabel } from '../../../shared/workspace-activity'

interface WorkspaceStateBadgesProps {
  readonly isCurrent?: boolean
  readonly summary: WorkspaceSummary
}

function getActivityChipClassName(
  activity: WorkspaceSummary['activity'] | null | undefined,
): string {
  if (!activity) {
    return 'border-border bg-surface-2 text-muted-foreground'
  }

  if (activity.state === 'pending-approval') {
    return 'border-transparent bg-accent-yellow-soft text-accent-yellow'
  }

  if (activity.state === 'error') {
    return 'border-transparent bg-accent-red-soft text-accent-red'
  }

  if (activity.state === 'working' || activity.state === 'connecting') {
    return 'border-transparent bg-accent-blue-soft text-accent-blue'
  }

  if (activity.state === 'awaiting-input') {
    return 'border-transparent bg-accent-yellow-soft text-accent-yellow'
  }

  if (activity.state === 'plan-ready') {
    return 'border-transparent bg-accent-purple-soft text-accent-purple'
  }

  return 'border-transparent bg-accent-green-soft text-accent-green'
}

export default function WorkspaceStateBadges({
  isCurrent = false,
  summary,
}: WorkspaceStateBadgesProps) {
  const visibleActivities = summary.activities.slice(0, 2)
  const hiddenActivityCount = Math.max(0, summary.activities.length - 2)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isCurrent ? (
        <Chip size="sm" variant="secondary">
          Current
        </Chip>
      ) : null}

      {visibleActivities.map((activity) => (
        <Chip
          className={getActivityChipClassName(activity)}
          key={activity.sessionId}
          size="sm"
          title={activity.detail ?? formatWorkspaceActivityLabel(activity)}
          variant="secondary"
        >
          {formatWorkspaceActivityLabel(activity)}
        </Chip>
      ))}

      {hiddenActivityCount > 0 ? (
        <Chip
          className="border-border bg-surface-2 text-muted-foreground"
          size="sm"
          title={`${hiddenActivityCount} more active sessions`}
          variant="secondary"
        >
          +{hiddenActivityCount}
        </Chip>
      ) : null}
    </div>
  )
}
