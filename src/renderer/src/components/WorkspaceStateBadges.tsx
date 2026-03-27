import { Chip } from '@heroui/react'

import type { WorkspaceSummary } from '@/lib/workspace-summary'

interface WorkspaceStateBadgesProps {
  readonly isCurrent?: boolean
  readonly summary: WorkspaceSummary
}

function getStatusChipClassName(status: WorkspaceSummary['status']): string {
  if (status === 'error') {
    return 'border-danger/40 bg-danger/10 text-danger'
  }

  if (status === 'running') {
    return 'border-warning/40 bg-warning/10 text-warning'
  }

  if (status === 'active') {
    return 'border-primary/40 bg-primary/10 text-primary'
  }

  return 'border-border bg-background text-muted-foreground'
}

function getStatusLabel(status: WorkspaceSummary['status']): string {
  if (status === 'error') {
    return 'Error'
  }

  if (status === 'running') {
    return 'Running'
  }

  if (status === 'active') {
    return 'Current'
  }

  return 'Idle'
}

export default function WorkspaceStateBadges({
  isCurrent = false,
  summary,
}: WorkspaceStateBadgesProps) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isCurrent && summary.status !== 'active' ? (
        <Chip size="sm" variant="secondary">
          Current
        </Chip>
      ) : null}

      <Chip
        className={getStatusChipClassName(summary.status)}
        size="sm"
        variant="secondary"
      >
        {getStatusLabel(summary.status)}
      </Chip>

      <Chip size="sm" variant="secondary">
        {summary.jobCount} jobs
      </Chip>
    </div>
  )
}
