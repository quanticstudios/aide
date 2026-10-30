import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { Button } from '@heroui/react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { type KeyboardEvent, useEffect, useMemo, useRef } from 'react'

import type {
  ManagedSessionDecision,
  ManagedSessionPendingApproval,
} from '../../../shared/managed-session'
import { useFontPreference } from '../lib/font-preference'
import { useColorScheme } from '../lib/theme-preference'

interface ManagedPendingApprovalPanelProps {
  readonly approval: ManagedSessionPendingApproval
  readonly onResolve: (
    requestId: string,
    decision: ManagedSessionDecision,
  ) => void
  readonly total: number
}

function ApprovalDiff({
  diff,
  filePath,
}: {
  readonly diff: string
  readonly filePath: string
}) {
  const colorScheme = useColorScheme()
  const { codeSize } = useFontPreference()
  const diffFile = useMemo(() => {
    const file = DiffFile.createInstance({
      hunks: [diff],
      newFile: { fileName: filePath },
      oldFile: { fileName: filePath },
    })
    file.init()
    file.buildUnifiedDiffLines()
    return file
  }, [diff, filePath])

  return (
    <DiffView
      diffFile={diffFile}
      diffViewFontSize={codeSize ?? 12}
      diffViewHighlight={false}
      diffViewMode={DiffModeEnum.Unified}
      diffViewTheme={colorScheme}
      diffViewWrap
    />
  )
}

function ApprovalRequestBody({
  approval,
}: {
  readonly approval: ManagedSessionPendingApproval
}) {
  const request = approval.request

  if (request?.command) {
    return (
      <div className="mt-2">
        <pre
          className="max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground"
          data-testid="managed-approval-command"
        >
          {request.command}
        </pre>
        {request.cwd ? (
          <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">
            {request.cwd}
          </p>
        ) : null}
      </div>
    )
  }

  if (request?.diff && request.filePath) {
    return (
      <div className="mt-2">
        <p
          className="break-all font-mono text-xs text-foreground"
          data-testid="managed-approval-file-path"
        >
          {request.filePath}
        </p>
        <div
          className="mt-1 max-h-72 overflow-auto rounded-md border border-border bg-surface"
          data-testid="managed-approval-diff"
        >
          <ApprovalDiff diff={request.diff} filePath={request.filePath} />
        </div>
      </div>
    )
  }

  if (request) {
    return (
      <details className="mt-2" data-testid="managed-approval-input">
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {request.toolName}
        </summary>
        <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-foreground">
          {JSON.stringify(request.input ?? {}, null, 2)}
        </pre>
      </details>
    )
  }

  return (
    <p className="mt-1 text-sm text-muted-foreground">
      {approval.detail ?? approval.requestType}
    </p>
  )
}

export default function ManagedPendingApprovalPanel({
  approval,
  onResolve,
  total,
}: ManagedPendingApprovalPanelProps) {
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // why: Alt chords belong to workspace and pane navigation.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    const decision: ManagedSessionDecision | null =
      event.key === '1'
        ? 'accept'
        : event.key === '2'
          ? 'accept-for-session'
          : event.key === '3' || event.key === 'Escape'
            ? 'deny'
            : null

    if (!decision) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onResolve(approval.id, decision)
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-accent-peach bg-accent-peach-soft px-4 py-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
      data-testid={`managed-approval-${approval.id}`}
      onKeyDown={handleKeyDown}
      ref={cardRef}
      tabIndex={-1}
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-peach" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Approval required
            {total > 1 ? (
              <span
                className="ml-2 font-normal text-muted-foreground"
                data-testid="managed-approval-counter"
              >
                1 of {total}
              </span>
            ) : null}
          </p>
          <ApprovalRequestBody approval={approval} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              className="rounded-pill px-5"
              onPress={() => onResolve(approval.id, 'accept')}
              size="sm"
              variant="primary"
            >
              <Check className="size-3.5" />
              Allow once
              <span className="font-mono text-[10px] opacity-70">1</span>
            </Button>
            <Button
              onPress={() => onResolve(approval.id, 'accept-for-session')}
              size="sm"
              variant="secondary"
            >
              <Check className="size-3.5" />
              Allow for session
              <span className="font-mono text-[10px] opacity-70">2</span>
            </Button>
            <Button
              onPress={() => onResolve(approval.id, 'deny')}
              size="sm"
              variant="ghost"
            >
              <X className="size-3.5" />
              Deny
              <span className="font-mono text-[10px] opacity-70">3</span>
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
