import { Check, Circle, GitBranch, LoaderCircle } from 'lucide-react'
import { useId, useState } from 'react'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import type {
  FleetEvent,
  FleetPlanNode,
  FleetState,
} from '../../../shared/fleet'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import {
  deriveLiveFleetFlow,
  type FleetFlowStatus,
  layoutFleetPlan,
} from '../lib/fleet-flow'
import { cn } from '../lib/utils'
import './FleetFlowchart.css'

const flowStatusClasses: Record<FleetFlowStatus, string> = {
  blocked: 'border-accent-red/60 bg-accent-red-soft text-accent-red',
  cancelled: 'border-border-strong bg-surface-secondary text-muted-foreground',
  completed: 'border-accent-green/50 bg-accent-green-soft text-foreground',
  failed: 'border-accent-red/60 bg-accent-red-soft text-accent-red',
  idle: 'border-border bg-surface-secondary text-muted-foreground',
  running:
    'border-primary bg-surface text-foreground ring-1 ring-primary/35 shadow-[0_0_24px_rgba(41,151,255,0.12)]',
}

function flowStatusFromPlan(node: FleetPlanNode): FleetFlowStatus {
  if (node.status === 'planned') return 'idle'
  if (node.status === 'skipped') return 'cancelled'
  return node.status
}

function FlowStatusIcon({
  animateRunning,
  status,
}: {
  readonly animateRunning: boolean
  readonly status: FleetFlowStatus
}) {
  if (status === 'running')
    return (
      <LoaderCircle
        className={cn(
          'size-3',
          animateRunning && 'animate-spin motion-reduce:animate-none',
        )}
      />
    )
  if (status === 'completed') return <Check className="size-3" />
  return <Circle className="size-2.5" />
}

function FlowNode({
  animateRunning = false,
  ariaLabel,
  eyebrow,
  height,
  isSelected = false,
  onClick,
  status,
  subtitle,
  title,
  width,
  x,
  y,
}: {
  readonly animateRunning?: boolean
  readonly ariaLabel: string
  readonly eyebrow: string
  readonly height: number
  readonly isSelected?: boolean
  readonly onClick: () => void
  readonly status: FleetFlowStatus
  readonly subtitle: string
  readonly title: string
  readonly width: number
  readonly x: number
  readonly y: number
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={isSelected}
      className={cn(
        'absolute z-10 flex flex-col justify-center overflow-hidden rounded-lg border px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
        flowStatusClasses[status],
        isSelected && 'ring-1 ring-primary',
      )}
      data-state={status}
      onClick={onClick}
      style={{ height, left: x, top: y, width }}
      type="button"
    >
      <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] opacity-80">
        <FlowStatusIcon animateRunning={animateRunning} status={status} />
        <span className="min-w-0 flex-1 truncate">{eyebrow}</span>
        <span>{status === 'idle' ? 'Not reached' : status}</span>
      </span>
      <span className="mt-1 truncate text-xs font-semibold" title={title}>
        {title}
      </span>
      <span className="mt-0.5 truncate text-[10px] opacity-75" title={subtitle}>
        {subtitle}
      </span>
    </button>
  )
}

export function PlanDependencyFlow({
  acceptedNodeIds,
  nodes,
  onSelectNode,
  selectedNodeId,
}: {
  readonly acceptedNodeIds: ReadonlySet<string>
  readonly nodes: readonly FleetPlanNode[]
  readonly onSelectNode: (nodeId: string) => void
  readonly selectedNodeId: string | null
}) {
  const markerId = useId()
  const layout = layoutFleetPlan(nodes)
  const nodesById = new Map(nodes.map((node) => [node.id, node]))

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface-secondary/35">
      <div
        className="fleet-flow-canvas relative mx-auto"
        data-testid="fleet-plan-flow"
        style={{ height: layout.height, width: layout.width }}
      >
        <svg
          aria-hidden="true"
          className="absolute inset-0"
          height={layout.height}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          width={layout.width}
        >
          <defs>
            <marker
              id={markerId}
              markerHeight="6"
              markerWidth="6"
              orient="auto"
              refX="5"
              refY="3"
            >
              <path className="fill-muted-foreground" d="M0 0L6 3L0 6Z" />
            </marker>
          </defs>
          {layout.edges.map((edge) => (
            <path
              className="fleet-flow-edge"
              d={edge.path}
              key={edge.id}
              markerEnd={`url(#${markerId})`}
            />
          ))}
        </svg>
        {layout.nodes.map((layoutNode) => {
          const node = nodesById.get(layoutNode.id)
          if (!node) return null
          const accepted = acceptedNodeIds.has(node.id)
          return (
            <FlowNode
              ariaLabel={`${node.title}, ${node.status}${accepted ? ', accepted' : ''}`}
              eyebrow={accepted ? 'Accepted' : node.status}
              height={layoutNode.height}
              isSelected={selectedNodeId === node.id}
              key={node.id}
              onClick={() => onSelectNode(node.id)}
              status={flowStatusFromPlan(node)}
              subtitle={
                node.dependsOn.length > 0
                  ? `Depends on ${node.dependsOn.join(', ')}`
                  : 'Starting point'
              }
              title={node.title}
              width={layoutNode.width}
              x={layoutNode.x}
              y={layoutNode.y}
            />
          )
        })}
      </div>
    </div>
  )
}

interface LiveNodePosition {
  readonly height: number
  readonly id: string
  readonly width: number
  readonly x: number
  readonly y: number
}

interface LiveEdge {
  readonly from: LiveNodePosition
  readonly id: string
  readonly label: string
  readonly status: FleetFlowStatus
  readonly to: LiveNodePosition
}

function liveEdgePath(from: LiveNodePosition, to: LiveNodePosition): string {
  const sourceX = from.x + from.width / 2
  const sourceY = from.y + from.height
  const targetX = to.x + to.width / 2
  const targetY = to.y
  const midpointY = (sourceY + targetY) / 2
  return `M ${sourceX} ${sourceY} C ${sourceX} ${midpointY}, ${targetX} ${midpointY}, ${targetX} ${targetY}`
}

function LiveEdgePath({
  edge,
  markerId,
}: {
  edge: LiveEdge
  markerId: string
}) {
  const sourceX = edge.from.x + edge.from.width / 2
  const sourceY = edge.from.y + edge.from.height
  const targetX = edge.to.x + edge.to.width / 2
  const targetY = edge.to.y
  return (
    <g>
      <path
        className="fleet-flow-edge"
        d={liveEdgePath(edge.from, edge.to)}
        data-state={edge.status}
        data-testid={`fleet-live-edge-${edge.id}`}
        markerEnd={`url(#${markerId})`}
      />
      <text
        className="fleet-flow-edge-label"
        textAnchor="middle"
        x={(sourceX + targetX) / 2 + 6}
        y={(sourceY + targetY) / 2 - 4}
      >
        {edge.label}
      </text>
    </g>
  )
}

function eventSubtitle(event: FleetEvent | null, fallback: string): string {
  if (!event) return fallback
  if (event.status === 'started') return 'Observed running'
  return `Observed ${event.status}`
}

export function LiveFleetFlowchart({
  agents,
  fleet,
  snapshot,
}: {
  readonly agents: readonly ManagedSessionAgentConfig[]
  readonly fleet: FleetState
  readonly snapshot: ManagedSessionSnapshot
}) {
  const markerId = useId()
  const [selectedEvent, setSelectedEvent] = useState<FleetEvent | null>(null)
  const runningTurns = snapshot.turns.filter((turn) => turn.state === 'running')
  const activeTurnIds = new Set(runningTurns.map((turn) => turn.id))
  const activeActivityIds = new Set(
    runningTurns
      .filter((turn) => turn.id.startsWith('opinion:'))
      .map((turn) => turn.id),
  )
  for (const item of snapshot.content) {
    if (
      item.kind === 'user-prompt' &&
      item.turnId !== null &&
      activeTurnIds.has(item.turnId)
    ) {
      activeActivityIds.add(item.id)
    }
  }
  if (snapshot.preparingActivityId)
    activeActivityIds.add(snapshot.preparingActivityId)
  const flow = deriveLiveFleetFlow(
    fleet,
    agents.map((agent) => agent.alias),
    activeActivityIds,
    activeTurnIds,
  )
  const detailEvent = selectedEvent ?? flow.decisionEvent
  const canvasWidth = 420
  const nodeHeight = 58
  const centerWidth = 206
  const centerX = (canvasWidth - centerWidth) / 2
  const orchestrator = {
    height: nodeHeight,
    id: 'orchestrator',
    width: centerWidth,
    x: centerX,
    y: 18,
  }
  const jev = { ...orchestrator, id: 'jev', y: 112 }
  const decision = { ...orchestrator, id: 'decision', y: 206 }
  const agentGap = 12
  const agentWidth = (canvasWidth - 20 - agentGap) / 2
  const agentStartY = 300
  const agentPositions = agents.map((agent, index) => ({
    height: nodeHeight,
    id: `agent-${agent.alias}`,
    width: agentWidth,
    x: 10 + (index % 2) * (agentWidth + agentGap),
    y: agentStartY + Math.floor(index / 2) * 84,
  }))
  const agentRows = Math.max(1, Math.ceil(agents.length / 2))
  const outcome = {
    ...orchestrator,
    id: 'outcome',
    y: agentStartY + agentRows * 84 + 20,
  }
  const canvasHeight = outcome.y + nodeHeight + 18
  const edges: LiveEdge[] = [
    {
      from: orchestrator,
      id: 'prepare',
      label: 'prepare',
      status: flow.jevStatus,
      to: jev,
    },
    {
      from: jev,
      id: 'context',
      label: 'context',
      status: flow.decisionStatus,
      to: decision,
    },
    ...(agents.length === 0
      ? [
          {
            from: decision,
            id: 'direct-return',
            label: 'return',
            status: flow.outcomeStatus,
            to: outcome,
          } satisfies LiveEdge,
        ]
      : agentPositions.flatMap((position, index) => {
          const agentState = flow.agents[index]
          const decisionMatchesAgent = Boolean(
            agentState?.decisionEvent?.activityId &&
              agentState.decisionEvent.activityId ===
                agentState.event?.activityId,
          )
          const wasSelectedByUser = agentState?.event?.requestedBy === 'user'
          const selectionStatus =
            decisionMatchesAgent || wasSelectedByUser
              ? (agentState?.status ?? 'idle')
              : 'idle'
          return [
            {
              from: decision,
              id: `select-${position.id}`,
              label: wasSelectedByUser ? 'user' : 'select',
              status: selectionStatus,
              to: position,
            },
            {
              from: position,
              id: `return-${position.id}`,
              label:
                agentState?.status === 'failed' ||
                agentState?.status === 'cancelled'
                  ? agentState.status
                  : 'return',
              status:
                agentState?.status === 'running'
                  ? 'idle'
                  : (agentState?.status ?? 'idle'),
              to: outcome,
            },
          ] satisfies LiveEdge[]
        })),
  ]

  return (
    <section className="space-y-3" data-testid="fleet-live-flow">
      <div className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2">
        <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-primary-on-dark">
          What is happening
        </p>
        <p className="mt-1 text-sm font-semibold text-foreground">
          {flow.headline}
        </p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface-secondary/35">
        <div
          className="fleet-flow-canvas relative mx-auto"
          style={{ height: canvasHeight, width: canvasWidth }}
        >
          <svg
            aria-hidden="true"
            className="absolute inset-0"
            height={canvasHeight}
            viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
            width={canvasWidth}
          >
            <defs>
              <marker
                id={markerId}
                markerHeight="6"
                markerWidth="6"
                orient="auto"
                refX="5"
                refY="3"
              >
                <path className="fill-muted-foreground" d="M0 0L6 3L0 6Z" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <LiveEdgePath edge={edge} key={edge.id} markerId={markerId} />
            ))}
          </svg>
          <FlowNode
            animateRunning
            ariaLabel={`Orchestrator, ${flow.orchestratorStatus}`}
            eyebrow="Orchestrator"
            height={orchestrator.height}
            onClick={() => setSelectedEvent(flow.orchestratorEvent)}
            status={flow.orchestratorStatus}
            subtitle={
              flow.orchestratorEvent?.model ??
              snapshot.model ??
              'Provider default'
            }
            title="Owns the turn"
            width={orchestrator.width}
            x={orchestrator.x}
            y={orchestrator.y}
          />
          <FlowNode
            animateRunning
            ariaLabel={`Required Jev context, ${flow.jevStatus}`}
            eyebrow="Required"
            height={jev.height}
            onClick={() => setSelectedEvent(flow.jevEvent)}
            status={flow.jevStatus}
            subtitle={eventSubtitle(
              flow.jevEvent,
              'Awaiting observed preparation',
            )}
            title="Jev"
            width={jev.width}
            x={jev.x}
            y={jev.y}
          />
          <FlowNode
            animateRunning
            ariaLabel={`Routing decision, ${flow.decisionStatus}`}
            eyebrow="Decision"
            height={decision.height}
            isSelected={detailEvent?.id === flow.decisionEvent?.id}
            onClick={() => setSelectedEvent(flow.decisionEvent)}
            status={flow.decisionStatus}
            subtitle={
              flow.decisionEvent
                ? `${flow.decisionEvent.requestedBy === 'user' ? 'User' : 'Orchestrator'} selected`
                : 'No recorded selection'
            }
            title="Agent selection"
            width={decision.width}
            x={decision.x}
            y={decision.y}
          />
          {agents.map((agent, index) => {
            const position = agentPositions[index]
            const agentState = flow.agents[index]
            if (!position || !agentState) return null
            return (
              <FlowNode
                animateRunning
                ariaLabel={`Agent ${agent.alias}, ${agentState.status}`}
                eyebrow={
                  agentState.event?.requestedBy === 'user'
                    ? 'User choice'
                    : 'Agent'
                }
                height={position.height}
                isSelected={detailEvent?.id === agentState.event?.id}
                key={agent.alias}
                onClick={() => setSelectedEvent(agentState.event)}
                status={agentState.status}
                subtitle={`${agentState.event?.model ?? agent.selection.model ?? 'Provider default'} · ${agentState.event?.effort ?? agent.selection.effort ?? 'default effort'}`}
                title={`@${agent.alias}`}
                width={position.width}
                x={position.x}
                y={position.y}
              />
            )
          })}
          <FlowNode
            animateRunning
            ariaLabel={`Conversation outcome, ${flow.outcomeStatus}`}
            eyebrow="Outcome"
            height={outcome.height}
            onClick={() => setSelectedEvent(flow.outcomeEvent)}
            status={flow.outcomeStatus}
            subtitle={eventSubtitle(
              flow.outcomeEvent,
              'Waiting for provider outcome',
            )}
            title="Conversation result"
            width={outcome.width}
            x={outcome.x}
            y={outcome.y}
          />
        </div>
      </div>
      {detailEvent ? (
        <div className="rounded-lg border border-border bg-surface-secondary p-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            <GitBranch className="size-3" />
            {detailEvent.type} · {detailEvent.status}
          </div>
          <p className="mt-1 text-xs font-semibold text-foreground">
            {detailEvent.label}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            {detailEvent.detail}
          </p>
        </div>
      ) : null}
    </section>
  )
}
