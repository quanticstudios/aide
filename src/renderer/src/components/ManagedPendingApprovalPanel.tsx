import { Button } from '@heroui/react'
import { AlertTriangle, Check, X } from 'lucide-react'

import type {
  ManagedSessionDecision,
  ManagedSessionPendingApproval,
} from '../../../shared/managed-session'

interface ManagedPendingApprovalPanelProps {
  readonly approval: ManagedSessionPendingApproval
  readonly onResolve: (
    requestId: string,
    decision: ManagedSessionDecision,
  ) => void
}

export default function ManagedPendingApprovalPanel({
  approval,
  onResolve,
}: ManagedPendingApprovalPanelProps) {
  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-accent-peach bg-accent-peach-soft px-4 py-3"
      data-testid={`managed-approval-${approval.id}`}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-peach" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Approval required
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {approval.detail ?? approval.requestType}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="rounded-pill px-5"
              onPress={() => onResolve(approval.id, 'accept')}
              size="sm"
              variant="primary"
            >
              <Check className="size-3.5" />
              Allow once
            </Button>
            <Button
              onPress={() => onResolve(approval.id, 'accept-for-session')}
              size="sm"
              variant="secondary"
            >
              <Check className="size-3.5" />
              Allow for session
            </Button>
            <Button
              onPress={() => onResolve(approval.id, 'deny')}
              size="sm"
              variant="ghost"
            >
              <X className="size-3.5" />
              Deny
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
