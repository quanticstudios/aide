import { Chip } from '@heroui/react'

import type { WorkspaceSummary } from '@/lib/workspace-summary'
import { formatWorkspaceActivityLabel } from '../../../shared/workspace-activity'

interface WorkspaceStateBadgesProps {
  readonly isCurrent?: boolean
  readonly summary: WorkspaceSummary
}

function getActivityChipClassName(summary: WorkspaceSummary): string {
  if (!summary.activity) {
    return 'border-border bg-background text-muted-foreground'
  }

  if (summary.activity.state === 'pending-approval') {
    return 'border-warning/40 bg-warning/10 text-warning'
  }

  if (summary.activity.state === 'error') {
    return 'border-danger/40 bg-danger/10 text-danger'
  }

  if (
    summary.activity.state === 'working' ||
    summary.activity.state === 'connecting'
  ) {
    return 'border-primary/40 bg-primary/10 text-primary'
  }

  if (summary.activity.state === 'awaiting-input') {
    return 'border-secondary/40 bg-secondary/10 text-secondary'
  }

  return 'border-success/40 bg-success/10 text-success'
}

export default function WorkspaceStateBadges({
  isCurrent = false,
  summary,
}: WorkspaceStateBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isCurrent ? (
        <Chip size="sm" variant="secondary">
          Current
        </Chip>
      ) : null}

      {summary.activity ? (
        <Chip
          className={getActivityChipClassName(summary)}
          size="sm"
          title={
            summary.activity.detail ??
            formatWorkspaceActivityLabel(summary.activity)
          }
          variant="secondary"
        >
          {formatWorkspaceActivityLabel(summary.activity)}
        </Chip>
      ) : null}
    </div>
  )
}
