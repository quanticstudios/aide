import { Button } from '@heroui/react'
import { Check, FileDown, ListChecks, PenLine, SquarePlus } from 'lucide-react'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'

import MarkdownContent from './MarkdownContent'
import MessageCopyButton from './transcript/MessageCopyButton'
import IconTooltip from './ui/icon-tooltip'

const COLLAPSED_LINE_LIMIT = 20

interface PlanCardProps {
  readonly onImplement: () => void
  readonly onImplementInNewThread: () => void
  readonly onRefine: () => void
  readonly plan: string
  readonly total: number
  readonly workspaceId: string
}

export default function PlanCard({
  onImplement,
  onImplementInNewThread,
  onRefine,
  plan,
  total,
  workspaceId,
}: PlanCardProps) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [saveStatus, setSaveStatus] = useState<string | null>(null)
  const isLong = plan.split('\n').length > COLLAPSED_LINE_LIMIT

  useEffect(() => {
    cardRef.current?.focus()
  }, [])

  const savePlan = async () => {
    try {
      const saved = await window.aide.saveManagedSessionPlan(workspaceId, plan)
      if (saved) setSaveStatus(`Saved to ${saved}`)
    } catch (saveError) {
      setSaveStatus(
        saveError instanceof Error ? saveError.message : String(saveError),
      )
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // why: Alt chords belong to workspace and pane navigation.
    if (event.altKey || event.ctrlKey || event.metaKey) {
      return
    }

    const action =
      event.key === '1'
        ? onImplement
        : event.key === '2'
          ? onImplementInNewThread
          : event.key === '3' || event.key === 'Escape'
            ? onRefine
            : null

    if (!action) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    action()
  }

  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-surface-secondary px-4 py-3 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
      data-testid="managed-plan-card"
      onKeyDown={handleKeyDown}
      ref={cardRef}
      tabIndex={-1}
    >
      <div className="flex items-center gap-2">
        <ListChecks className="size-4 shrink-0 text-primary" />
        <p className="flex-1 text-sm font-semibold text-foreground">
          Plan ready
          {total > 1 ? (
            <span className="ml-2 font-normal text-muted-foreground">
              1 of {total}
            </span>
          ) : null}
        </p>
        <MessageCopyButton kind="plan" text={plan} />
        <IconTooltip label="Save as file">
          <Button
            aria-label="Save as file"
            className="size-7 rounded-md text-muted-foreground"
            isIconOnly
            onPress={() => void savePlan()}
            size="sm"
            variant="ghost"
          >
            <FileDown className="size-3.5" />
          </Button>
        </IconTooltip>
      </div>
      <div
        className={
          isLong && !expanded
            ? 'mt-2 max-h-[25rem] overflow-hidden text-sm'
            : 'mt-2 max-h-[60vh] overflow-y-auto text-sm'
        }
        data-testid="managed-plan-body"
      >
        <MarkdownContent text={plan} />
      </div>
      {isLong ? (
        <button
          className="mt-1 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          {expanded ? 'Collapse plan' : 'Show full plan'}
        </button>
      ) : null}
      {saveStatus ? (
        <p className="mt-1 break-all text-xs text-muted-foreground">
          {saveStatus}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          className="rounded-pill px-5"
          onPress={onImplement}
          size="sm"
          variant="primary"
        >
          <Check className="size-3.5" />
          Implement
          <span className="font-mono text-[10px] opacity-70">1</span>
        </Button>
        <Button onPress={onImplementInNewThread} size="sm" variant="secondary">
          <SquarePlus className="size-3.5" />
          Implement in a new thread
          <span className="font-mono text-[10px] opacity-70">2</span>
        </Button>
        <Button onPress={onRefine} size="sm" variant="ghost">
          <PenLine className="size-3.5" />
          Refine
          <span className="font-mono text-[10px] opacity-70">3</span>
        </Button>
      </div>
    </div>
  )
}
