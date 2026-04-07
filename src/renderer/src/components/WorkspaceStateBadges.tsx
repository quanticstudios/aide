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
    return 'border-border bg-background text-muted-foreground'
  }

  if (activity.state === 'pending-approval') {
    return 'border-warning/40 bg-warning/10 text-warning'
  }

  if (activity.state === 'error') {
    return 'border-danger/40 bg-danger/10 text-danger'
  }

  if (activity.state === 'working' || activity.state === 'connecting') {
    return 'border-primary/40 bg-primary/10 text-primary'
  }

  if (activity.state === 'awaiting-input') {
    return 'border-secondary/40 bg-secondary/10 text-secondary'
  }

  return 'border-success/40 bg-success/10 text-success'
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
          className="border-border bg-background text-muted-foreground"
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
