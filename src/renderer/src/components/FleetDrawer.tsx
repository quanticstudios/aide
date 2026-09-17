import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Clock3,
  Network,
  RotateCcw,
  X,
} from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import type { FleetPlanNode, FleetState } from '../../../shared/fleet'
import type { AideApi } from '../../../shared/ipc'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import { summarizeManagedUsage } from '../../../shared/managed-usage'
import { cn } from '../lib/utils'

interface FleetDrawerProps {
  readonly onClose: () => void
  readonly sessionId: string | null
}

interface FleetContentProps {
  readonly error: string | null
  readonly fleet: FleetState | null
  readonly isAccepting: boolean
  readonly onAcceptNode: (nodeId: string, accepted: boolean) => void
  readonly snapshot: ManagedSessionSnapshot | null
}

const nodeStatusClasses = {
  blocked: 'border-accent-red/40 bg-accent-red-soft text-accent-red',
  completed: 'border-accent-green/40 bg-accent-green-soft text-accent-green',
  planned: 'border-border bg-surface-tertiary text-muted-foreground',
  running: 'border-primary/40 bg-primary/10 text-primary',
  skipped: 'border-border bg-surface-secondary text-muted-foreground',
} as const
const fleetTabs = ['plan', 'live'] as const

function getAideApi(): AideApi | null {
  return typeof window === 'undefined' ? null : window.aide
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Fleet action failed.'
}

function useFleetSnapshot(sessionId: string | null): {
  error: string | null
  snapshot: ManagedSessionSnapshot | null
} {
  const [entry, setEntry] = useState<{
    sessionId: string
    snapshot: ManagedSessionSnapshot
  } | null>(null)
  const [loadError, setLoadError] = useState<{
    message: string
    sessionId: string
  } | null>(null)
  const revisionRef = useRef({ revision: -1, runtimeGeneration: -1 })

  useEffect(() => {
    if (!sessionId) return
    const api = getAideApi()
    if (!api) return
    let isCurrent = true
    let eventSequence = 0
    revisionRef.current = { revision: -1, runtimeGeneration: -1 }

    const applySnapshot = (snapshot: ManagedSessionSnapshot): void => {
      if (!isCurrent || snapshot.sessionId !== sessionId) return
      const current = revisionRef.current
      if (
        snapshot.runtimeGeneration < current.runtimeGeneration ||
        (snapshot.runtimeGeneration === current.runtimeGeneration &&
          snapshot.revision <= current.revision)
      ) {
        return
      }
      revisionRef.current = {
        revision: snapshot.revision,
        runtimeGeneration: snapshot.runtimeGeneration,
      }
      setLoadError(null)
      setEntry({ sessionId, snapshot })
    }

    const unsubscribe = api.onManagedSessionEvent((event) => {
      if (event.type === 'snapshot' && event.snapshot.sessionId === sessionId) {
        eventSequence += 1
        applySnapshot(event.snapshot)
      }
      if (event.type === 'removed' && event.sessionId === sessionId) {
        eventSequence += 1
        revisionRef.current = { revision: -1, runtimeGeneration: -1 }
        setLoadError(null)
        setEntry(null)
      }
    })
    const initialEventSequence = eventSequence
    void api
      .getManagedSessionSnapshots()
      .then(async (snapshots) => {
        const live = snapshots[sessionId]
        if (live) return live
        return api.getTaskTranscript(sessionId)
      })
      .then((snapshot) => {
        if (eventSequence !== initialEventSequence || !snapshot) return
        applySnapshot(snapshot)
      })
      .catch((error) => {
        if (!isCurrent || eventSequence !== initialEventSequence) return
        setLoadError({ message: getErrorMessage(error), sessionId })
      })
    return () => {
      isCurrent = false
      unsubscribe()
    }
  }, [sessionId])

  return {
    error: loadError?.sessionId === sessionId ? loadError.message : null,
    snapshot: entry?.sessionId === sessionId ? entry.snapshot : null,
  }
}

function StatusBadge({ status }: { readonly status: FleetPlanNode['status'] }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-[10px] font-semibold capitalize',
        nodeStatusClasses[status],
      )}
    >
      {status}
    </span>
  )
}

function getFleetProgress(fleet: FleetState): {
  accepted: number
  completed: number
  total: number
} {
  return {
    accepted: fleet.acceptedNodeIds.length,
    completed:
      fleet.plan?.nodes.filter((node) => node.status === 'completed').length ??
      0,
    total: fleet.plan?.nodes.length ?? 0,
  }
}

function FleetPlan({
  fleet,
  isAccepting,
  onAcceptNode,
}: Pick<FleetContentProps, 'fleet' | 'isAccepting' | 'onAcceptNode'>) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const arrowMarkerId = useId()
  if (!fleet?.plan) {
    return (
      <EmptyState>No fleet plan has been recorded for this session.</EmptyState>
    )
  }
  const selectedNode =
    fleet.plan.nodes.find((node) => node.id === selectedNodeId) ??
    fleet.plan.nodes[0] ??
    null
  const progress = getFleetProgress(fleet)
  const acceptedNodeIds = new Set(fleet.acceptedNodeIds)
  const isAccepted = selectedNode ? acceptedNodeIds.has(selectedNode.id) : false
  const dependenciesAccepted = selectedNode
    ? selectedNode.dependsOn.every((id) => acceptedNodeIds.has(id))
    : false
  const canAccept = Boolean(
    selectedNode?.status === 'completed' && dependenciesAccepted,
  )

  return (
    <div className="space-y-4">
      <p className="text-xs leading-5 text-muted-foreground">
        {fleet.plan.summary}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Metric
          label="Reported progress"
          value={`${progress.completed} / ${progress.total} completed`}
        />
        <Metric
          label="User review"
          value={`${progress.accepted} / ${progress.total} accepted`}
        />
      </div>
      <section aria-label="Fleet dependency flowchart" className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">
          Dependency flow
        </h3>
        <div className="relative" data-testid="fleet-plan-flow">
          <svg
            aria-hidden="true"
            className="absolute inset-y-0 left-0 w-8 overflow-visible"
            height={Math.max(76, fleet.plan.nodes.length * 76)}
          >
            <defs>
              <marker
                id={arrowMarkerId}
                markerHeight="5"
                markerWidth="5"
                orient="auto"
                refX="4"
                refY="2.5"
              >
                <path
                  className="fill-muted-foreground"
                  d="M 0 0 L 5 2.5 L 0 5 z"
                />
              </marker>
            </defs>
            {fleet.plan.nodes.flatMap((node, targetIndex) =>
              node.dependsOn.flatMap((dependencyId) => {
                const sourceIndex = fleet.plan?.nodes.findIndex(
                  (candidate) => candidate.id === dependencyId,
                )
                if (sourceIndex === undefined || sourceIndex < 0) return []
                const sourceY = sourceIndex * 76 + 34
                const targetY = targetIndex * 76 + 34
                return [
                  <path
                    className="stroke-border"
                    d={`M 27 ${sourceY} C 3 ${sourceY}, 3 ${targetY}, 27 ${targetY}`}
                    fill="none"
                    key={`${dependencyId}:${node.id}`}
                    markerEnd={`url(#${arrowMarkerId})`}
                    strokeWidth="1.5"
                  />,
                ]
              }),
            )}
          </svg>
          {fleet.plan.nodes.map((node) => (
            <button
              aria-pressed={selectedNode?.id === node.id}
              className={cn(
                'relative mb-2 ml-8 flex h-[68px] w-[calc(100%-2rem)] items-start gap-2 overflow-hidden rounded-lg border bg-surface px-3 py-2 text-left hover:border-primary/50',
                selectedNode?.id === node.id &&
                  'border-primary ring-1 ring-primary/30',
              )}
              key={node.id}
              onClick={() => setSelectedNodeId(node.id)}
              type="button"
            >
              <span className="absolute -left-[5px] top-[29px] size-2 rounded-full border border-background bg-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-xs font-semibold text-foreground"
                  title={node.title}
                >
                  {node.title}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2">
                  <StatusBadge status={node.status} />
                  {acceptedNodeIds.has(node.id) ? (
                    <span className="text-[10px] font-semibold text-accent-green">
                      Accepted
                    </span>
                  ) : null}
                </span>
                <span
                  className="mt-1 block truncate text-[10px] text-muted-foreground"
                  title={
                    node.dependsOn.length > 0
                      ? `Depends on ${node.dependsOn.join(', ')}`
                      : 'No dependencies'
                  }
                >
                  {node.dependsOn.length > 0
                    ? `Depends on ${node.dependsOn.join(', ')}`
                    : 'No dependencies'}
                </span>
              </span>
              <ChevronRight className="mt-1 size-3.5 text-muted-foreground" />
            </button>
          ))}
        </div>
      </section>
      {selectedNode ? (
        <section className="space-y-3 rounded-lg border border-border bg-surface-secondary p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {selectedNode.title}
              </h3>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {selectedNode.detail}
              </p>
            </div>
            <StatusBadge status={selectedNode.status} />
          </div>
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Orchestrator-reported evidence
            </p>
            <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-foreground">
              {selectedNode.evidence || 'No evidence reported.'}
            </p>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Reported by the orchestrator. Observed provider events appear in
              Live flow.
            </p>
          </div>
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-3 py-1.5 text-xs font-semibold text-primary disabled:border-border disabled:text-muted-foreground disabled:opacity-60"
            disabled={isAccepting || (!isAccepted && !canAccept)}
            onClick={() => onAcceptNode(selectedNode.id, !isAccepted)}
            type="button"
          >
            {isAccepted ? (
              <X className="size-3" />
            ) : (
              <Check className="size-3" />
            )}
            {isAccepted ? 'Remove acceptance' : 'Accept completed work'}
          </button>
          {!isAccepted && !canAccept ? (
            <p className="text-[10px] text-muted-foreground">
              Complete this node and accept each dependency first.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}

function Metric({
  label,
  value,
}: {
  readonly label: string
  readonly value: string
}) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xs font-semibold text-foreground">{value}</p>
    </div>
  )
}

function EmptyState({ children }: { readonly children: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border p-4 text-xs text-muted-foreground">
      {children}
    </div>
  )
}

function FleetLive({
  fleet,
  snapshot,
}: Pick<FleetContentProps, 'fleet' | 'snapshot'>) {
  if (!fleet)
    return (
      <EmptyState>
        No fleet runtime activity has been recorded for this session.
      </EmptyState>
    )
  const events = [...fleet.events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const failures = events.filter(
    (event) => event.status === 'failed' || event.status === 'blocked',
  ).length
  const usage =
    snapshot?.usageSummary ??
    (snapshot?.usageReports?.length
      ? summarizeManagedUsage(snapshot.usageReports)
      : undefined)
  const isCostComplete =
    usage?.isCostComplete &&
    snapshot?.turns.every((turn) =>
      snapshot.usageReports?.some(
        (report) =>
          report.provider === turn.provider && report.turnId === turn.id,
      ),
    )
  const cost = usage
    ? isCostComplete
      ? `$${usage.estimatedCostUsd.toFixed(4)}`
      : `$${usage.estimatedCostUsd.toFixed(4)} recorded, remainder unknown`
    : 'Unknown'
  const orchestratorModel =
    snapshot?.orchestratorSelection?.model ??
    snapshot?.model ??
    'provider default'
  const elapsed = formatElapsedTime(events.map((event) => event.createdAt))
  const costPerAccepted = fleet.acceptedNodeIds.length
    ? usage
      ? isCostComplete
        ? `$${(usage.estimatedCostUsd / fleet.acceptedNodeIds.length).toFixed(4)}`
        : `$${(usage.estimatedCostUsd / fleet.acceptedNodeIds.length).toFixed(4)} recorded, remainder unknown`
      : 'Unknown'
    : 'No accepted nodes'

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-foreground">
          Configured routing
        </h3>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <RouteLabel text={`Orchestrator · ${orchestratorModel}`} />
          <ChevronRight className="size-3 text-muted-foreground" />
          <RouteLabel text="Jev required" />
          {(snapshot?.agents?.length ?? 0) > 0 ? (
            <ChevronRight className="size-3 text-muted-foreground" />
          ) : null}
          <span className="flex flex-wrap gap-1.5">
            {(snapshot?.agents ?? []).map((agent) => (
              <RouteLabel
                key={agent.alias}
                text={`@${agent.alias} · ${agent.selection.model ?? 'provider default'}`}
              />
            ))}
          </span>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Policy route: required Jev context, then configured read-only agents
          when selected.
        </p>
      </section>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Events" value={String(events.length)} />
        <Metric label="Errors" value={String(failures)} />
        <Metric label="Cost" value={cost} />
        <Metric label="Visible timeline span" value={elapsed} />
        <div className="col-span-2">
          <Metric label="Cost per accepted node" value={costPerAccepted} />
          <p className="mt-1 text-[10px] text-muted-foreground">
            Recorded session cost divided by accepted nodes.
          </p>
        </div>
      </div>
      <p className="rounded-lg border border-border bg-surface-secondary px-3 py-2 text-[11px] text-muted-foreground">
        <span className="font-semibold text-foreground">Usage </span>
        {usage
          ? `${usage.inputTokens.toLocaleString()} input · ${usage.outputTokens.toLocaleString()} output`
          : snapshot?.usage
            ? `${snapshot.usage.inputTokens.toLocaleString()} input · ${snapshot.usage.outputTokens.toLocaleString()} output · cost unknown`
            : 'Token counts unavailable · cost unknown'}
      </p>
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-semibold text-foreground">
            Execution timeline
          </h3>
          {fleet.droppedEventCount ? (
            <span className="text-[10px] text-accent-red">
              {fleet.droppedEventCount} older events omitted
            </span>
          ) : null}
        </div>
        {events.length === 0 ? (
          <EmptyState>No runtime events have been recorded yet.</EmptyState>
        ) : (
          <ol className="space-y-2">
            {events.map((event) => {
              const hasFailed =
                event.status === 'failed' || event.status === 'blocked'
              return (
                <li
                  className="rounded-lg border border-border bg-surface p-3"
                  key={event.id}
                >
                  <div className="flex items-center gap-2">
                    {event.status === 'completed' ? (
                      <Check className="size-3.5 text-accent-green" />
                    ) : hasFailed ? (
                      <AlertTriangle className="size-3.5 text-accent-red" />
                    ) : event.status === 'started' ? (
                      <Circle className="size-3.5 text-primary" />
                    ) : (
                      <Clock3 className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground">
                      {event.label}
                    </span>
                    <span
                      className={cn(
                        'text-[10px] font-semibold capitalize',
                        hasFailed
                          ? 'text-accent-red'
                          : event.status === 'completed'
                            ? 'text-accent-green'
                            : 'text-muted-foreground',
                      )}
                    >
                      {event.status}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {event.detail}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                    <span>
                      {event.source === 'runtime'
                        ? 'Observed provider event'
                        : 'Orchestrator report'}
                    </span>
                    <span>{event.type}</span>
                    <span>{formatEventTime(event.createdAt)}</span>
                    {event.model ? <span>{event.model}</span> : null}
                    {event.effort ? <span>{event.effort} effort</span> : null}
                    {event.attempt && event.attempt > 1 ? (
                      <span className="inline-flex items-center gap-1 text-primary">
                        <RotateCcw className="size-3" /> Attempt {event.attempt}
                      </span>
                    ) : null}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>
    </div>
  )
}

function formatEventTime(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.valueOf())
    ? createdAt
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function formatElapsedTime(createdAtValues: readonly string[]): string {
  const times = createdAtValues.flatMap((createdAt) => {
    const value = new Date(createdAt).valueOf()
    return Number.isNaN(value) ? [] : [value]
  })
  if (times.length === 0) return 'Unknown'
  const elapsedSeconds = Math.max(
    0,
    Math.round((Math.max(...times) - Math.min(...times)) / 1_000),
  )
  if (elapsedSeconds < 60) return `${elapsedSeconds}s`
  return `${Math.floor(elapsedSeconds / 60)}m ${elapsedSeconds % 60}s`
}

function RouteLabel({ text }: { readonly text: string }) {
  return (
    <span className="rounded-md border border-border bg-surface px-2 py-1 text-foreground">
      {text}
    </span>
  )
}

export function FleetDrawerContent(props: FleetContentProps) {
  const [tab, setTab] = useState<'plan' | 'live'>('plan')
  return (
    <>
      <div
        className="grid grid-cols-2 border-b border-border p-2"
        role="tablist"
      >
        {fleetTabs.map((value, index) => (
          <button
            aria-controls={`fleet-${value}-panel`}
            aria-selected={tab === value}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-semibold text-muted-foreground',
              tab === value && 'bg-surface-tertiary text-foreground',
            )}
            id={`fleet-${value}-tab`}
            key={value}
            onClick={() => setTab(value)}
            onKeyDown={(event) => {
              const nextIndex =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? fleetTabs.length - 1
                    : event.key === 'ArrowRight'
                      ? (index + 1) % fleetTabs.length
                      : event.key === 'ArrowLeft'
                        ? (index - 1 + fleetTabs.length) % fleetTabs.length
                        : null
              if (nextIndex === null) return
              event.preventDefault()
              const nextTab = fleetTabs[nextIndex]
              setTab(nextTab)
              document.getElementById(`fleet-${nextTab}-tab`)?.focus()
            }}
            role="tab"
            tabIndex={tab === value ? 0 : -1}
            type="button"
          >
            {value === 'plan' ? 'Plan' : 'Live flow'}
          </button>
        ))}
      </div>
      {props.error ? (
        <p
          className="border-b border-accent-red/40 bg-accent-red-soft px-4 py-2 text-xs text-accent-red"
          role="alert"
        >
          {props.error}
        </p>
      ) : null}
      <div
        aria-labelledby={`fleet-${tab}-tab`}
        className="min-h-0 flex-1 overflow-y-auto p-4"
        id={`fleet-${tab}-panel`}
        role="tabpanel"
      >
        {tab === 'plan' ? (
          <FleetPlan
            fleet={props.fleet}
            isAccepting={props.isAccepting}
            onAcceptNode={props.onAcceptNode}
          />
        ) : (
          <FleetLive fleet={props.fleet} snapshot={props.snapshot} />
        )}
      </div>
    </>
  )
}

export default function FleetDrawer({ onClose, sessionId }: FleetDrawerProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const { error: loadError, snapshot } = useFleetSnapshot(sessionId)
  const fleet = snapshot?.fleet ?? null
  const [actionError, setActionError] = useState<{
    message: string
    sessionId: string
  } | null>(null)
  const [acceptingSessionId, setAcceptingSessionId] = useState<string | null>(
    null,
  )
  const isAccepting = acceptingSessionId === sessionId

  useEffect(() => {
    closeButtonRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  async function acceptNode(nodeId: string, accepted: boolean): Promise<void> {
    const api = getAideApi()
    if (!api || !sessionId) return
    setActionError(null)
    setAcceptingSessionId(sessionId)
    try {
      await api.acceptManagedFleetNode({ accepted, nodeId, sessionId })
    } catch (acceptError) {
      setActionError({
        message: getErrorMessage(acceptError),
        sessionId,
      })
    } finally {
      setAcceptingSessionId((current) =>
        current === sessionId ? null : current,
      )
    }
  }

  return (
    <aside
      aria-label="Agent fleet"
      className="absolute inset-y-0 right-0 z-30 flex w-[min(26rem,calc(100vw-1rem))] flex-col border-l border-border bg-background shadow-[-16px_0_48px_rgba(0,0,0,0.22)] lg:static lg:z-auto lg:w-[26rem] lg:shrink-0 lg:shadow-none"
      data-testid="fleet-drawer"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4">
        <Network className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-foreground">Agent fleet</h2>
          <p className="truncate text-[10px] text-muted-foreground">
            {snapshot
              ? `${snapshot.provider} · ${snapshot.sessionState}`
              : 'No fleet session selected'}
          </p>
        </div>
        <button
          aria-label="Close agent fleet"
          className="grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-surface-tertiary hover:text-foreground"
          onClick={onClose}
          ref={closeButtonRef}
          type="button"
        >
          <X className="size-4" />
        </button>
      </div>
      <FleetDrawerContent
        error={
          actionError?.sessionId === sessionId ? actionError.message : loadError
        }
        fleet={fleet}
        isAccepting={isAccepting}
        onAcceptNode={(nodeId, accepted) => void acceptNode(nodeId, accepted)}
        snapshot={snapshot}
      />
    </aside>
  )
}
