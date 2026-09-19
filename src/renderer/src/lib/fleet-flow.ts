import type {
  FleetEvent,
  FleetPlanNode,
  FleetState,
} from '../../../shared/fleet'
import {
  formatJevGateThresholds,
  JEV_GATE_ROWS,
  type JevGateSection,
  type JevGateSettings,
} from '../../../shared/jev-gates'

export type FleetFlowStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'blocked'

export interface FleetPlanLayoutNode {
  readonly height: number
  readonly id: string
  readonly width: number
  readonly x: number
  readonly y: number
}

export interface FleetPlanLayoutEdge {
  readonly fromId: string
  readonly id: string
  readonly path: string
  readonly toId: string
}

export interface FleetPlanLayout {
  readonly edges: readonly FleetPlanLayoutEdge[]
  readonly height: number
  readonly nodes: readonly FleetPlanLayoutNode[]
  readonly width: number
}

export interface LiveFleetAgentState {
  readonly alias: string
  readonly decisionEvent: FleetEvent | null
  readonly event: FleetEvent | null
  readonly status: FleetFlowStatus
}

export interface LiveFleetGateNode {
  readonly id: string
  readonly section: JevGateSection
  /** Nodes whose outgoing edge the gate intercepts. */
  readonly sourceIds: readonly string[]
  /** Effective thresholds, shown as the node label. */
  readonly subtitle: string
  /** Node the gate hands off to, or null when it hangs off its source. */
  readonly targetId: string | null
  readonly title: string
}

export interface LiveFleetFlowState {
  readonly agents: readonly LiveFleetAgentState[]
  readonly decisionEvent: FleetEvent | null
  readonly decisionStatus: FleetFlowStatus
  readonly gates: readonly LiveFleetGateNode[]
  readonly headline: string
  readonly jevEvent: FleetEvent | null
  readonly jevStatus: FleetFlowStatus
  readonly orchestratorEvent: FleetEvent | null
  readonly orchestratorStatus: FleetFlowStatus
  readonly outcomeEvent: FleetEvent | null
  readonly outcomeStatus: FleetFlowStatus
}

const planCanvasWidth = 420
const planNodeHeight = 64
const planRowGap = 34
const planColumnGap = 12
const planCanvasPadding = 12
const maxPlanColumns = 2

function statusFromEvent(
  event: FleetEvent | null,
  activeActivityIds: ReadonlySet<string>,
  activeTurnIds: ReadonlySet<string>,
): FleetFlowStatus {
  if (!event) return 'idle'
  if (event.status === 'started') {
    const isObservedRunning =
      event.type === 'context'
        ? event.turnId !== null && activeTurnIds.has(event.turnId)
        : event.activityId !== undefined
          ? activeActivityIds.has(event.activityId)
          : event.turnId !== null && activeTurnIds.has(event.turnId)
    return isObservedRunning ? 'running' : 'idle'
  }
  return event.status
}

function terminalTurn(event: FleetEvent): boolean {
  return event.type === 'turn' && event.status !== 'started'
}

function findLastEventIndex(
  events: readonly FleetEvent[],
  predicate: (event: FleetEvent, index: number) => boolean,
): number {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event && predicate(event, index)) return index
  }
  return -1
}

function selectFocusedEvents(
  events: readonly FleetEvent[],
  activeActivityIds: ReadonlySet<string>,
  activeTurnIds: ReadonlySet<string>,
): readonly FleetEvent[] {
  const ordered = [...events].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  )
  const currentEvents = ordered.filter(
    (event) =>
      (event.activityId !== undefined &&
        activeActivityIds.has(event.activityId)) ||
      (event.turnId !== null && activeTurnIds.has(event.turnId)),
  )
  if (currentEvents.length > 0) return currentEvents

  const latestRuntimeEvent = latestEvent(
    ordered,
    (event) => event.source === 'runtime' && event.type !== 'tool',
  )
  if (latestRuntimeEvent?.turnId) {
    return ordered.filter((event) => event.turnId === latestRuntimeEvent.turnId)
  }
  if (latestRuntimeEvent?.activityId) {
    return ordered.filter(
      (event) => event.activityId === latestRuntimeEvent.activityId,
    )
  }
  return latestRuntimeEvent ? [latestRuntimeEvent] : []
}

function latestEvent(
  events: readonly FleetEvent[],
  predicate: (event: FleetEvent) => boolean,
): FleetEvent | null {
  const index = findLastEventIndex(events, predicate)
  return index < 0 ? null : (events[index] ?? null)
}

function gateNodes(
  gates: JevGateSettings | undefined,
  agentNodeIds: readonly string[],
): readonly LiveFleetGateNode[] {
  if (!gates) return []
  return JEV_GATE_ROWS.filter((row) => gates[row.section].enabled).flatMap(
    (row): readonly LiveFleetGateNode[] => {
      const shared = {
        section: row.section,
        subtitle: formatJevGateThresholds(gates, row.section),
        title: row.label,
      }
      if (row.section === 'toolGate')
        return agentNodeIds.map((agentNodeId) => ({
          ...shared,
          id: `gate-toolGate-${agentNodeId}`,
          sourceIds: [agentNodeId],
          targetId: null,
        }))
      return [
        {
          ...shared,
          id: `gate-${row.section}`,
          sourceIds:
            row.section === 'laneRouting'
              ? ['jev']
              : agentNodeIds.length > 0
                ? agentNodeIds
                : ['decision'],
          targetId: row.section === 'laneRouting' ? 'decision' : 'outcome',
        },
      ]
    },
  )
}

function activeHeadline(state: Omit<LiveFleetFlowState, 'headline'>): string {
  const activeAgent = state.agents.find((agent) => agent.status === 'running')
  if (activeAgent) return `@${activeAgent.alias} is working`
  if (state.jevStatus === 'running') return 'Jev is preparing context'
  if (state.decisionStatus === 'running') return 'Choosing the next step'
  if (state.orchestratorStatus === 'running') return 'Orchestrator is working'
  if (state.outcomeStatus === 'completed') return 'Latest turn completed'
  if (state.outcomeStatus === 'failed' || state.outcomeStatus === 'blocked')
    return 'Latest turn needs attention'
  if (state.outcomeStatus === 'cancelled') return 'Latest turn was interrupted'
  return 'Waiting for observed fleet activity'
}

export function deriveLiveFleetFlow(
  fleet: FleetState,
  aliases: readonly string[],
  activeActivityIds: ReadonlySet<string>,
  activeTurnIds: ReadonlySet<string>,
  gates?: JevGateSettings,
): LiveFleetFlowState {
  const focusedEvents = selectFocusedEvents(
    fleet.events,
    activeActivityIds,
    activeTurnIds,
  )
  const orchestratorEvent = latestEvent(
    focusedEvents,
    (event) => event.type === 'turn',
  )
  const jevEvent = latestEvent(
    focusedEvents,
    (event) => event.type === 'preparation' || event.type === 'context',
  )
  const decisionEvent = latestEvent(
    focusedEvents,
    (event) => event.type === 'decision' && event.activityId !== undefined,
  )
  const outcomeEvent = latestEvent(
    focusedEvents,
    (event) =>
      terminalTurn(event) ||
      (event.type === 'agent' &&
        event.status !== 'started' &&
        event.turnId === null),
  )
  const state = {
    agents: aliases.map((alias) => {
      const event = latestEvent(
        focusedEvents,
        (candidate) =>
          candidate.type === 'agent' &&
          candidate.agentAlias?.toLowerCase() === alias.toLowerCase(),
      )
      const decision = latestEvent(
        focusedEvents,
        (candidate) =>
          candidate.type === 'decision' &&
          candidate.agentAlias?.toLowerCase() === alias.toLowerCase(),
      )
      return {
        alias,
        decisionEvent: decision,
        event,
        status: statusFromEvent(event, activeActivityIds, activeTurnIds),
      }
    }),
    decisionEvent,
    decisionStatus: statusFromEvent(
      decisionEvent,
      activeActivityIds,
      activeTurnIds,
    ),
    gates: gateNodes(
      gates,
      aliases.map((alias) => `agent-${alias}`),
    ),
    jevEvent,
    jevStatus: statusFromEvent(jevEvent, activeActivityIds, activeTurnIds),
    orchestratorEvent,
    orchestratorStatus: statusFromEvent(
      orchestratorEvent,
      activeActivityIds,
      activeTurnIds,
    ),
    outcomeEvent,
    outcomeStatus: statusFromEvent(
      outcomeEvent,
      activeActivityIds,
      activeTurnIds,
    ),
  }
  return { ...state, headline: activeHeadline(state) }
}

export function layoutFleetPlan(
  planNodes: readonly FleetPlanNode[],
): FleetPlanLayout {
  const nodesById = new Map(planNodes.map((node) => [node.id, node]))
  const levels = new Map<string, number>()
  const resolveLevel = (nodeId: string): number => {
    const savedLevel = levels.get(nodeId)
    if (savedLevel !== undefined) return savedLevel
    const node = nodesById.get(nodeId)
    const level =
      node && node.dependsOn.length > 0
        ? Math.max(...node.dependsOn.map(resolveLevel)) + 1
        : 0
    levels.set(nodeId, level)
    return level
  }
  for (const node of planNodes) resolveLevel(node.id)

  const nodesByLevel = new Map<number, FleetPlanNode[]>()
  for (const node of planNodes) {
    const level = levels.get(node.id) ?? 0
    nodesByLevel.set(level, [...(nodesByLevel.get(level) ?? []), node])
  }

  const layoutNodes: FleetPlanLayoutNode[] = []
  let visualRow = 0
  for (const level of [...nodesByLevel.keys()].sort(
    (left, right) => left - right,
  )) {
    const levelNodes = nodesByLevel.get(level) ?? []
    for (let start = 0; start < levelNodes.length; start += maxPlanColumns) {
      const rowNodes = levelNodes.slice(start, start + maxPlanColumns)
      const width =
        (planCanvasWidth -
          planCanvasPadding * 2 -
          planColumnGap * (rowNodes.length - 1)) /
        rowNodes.length
      rowNodes.forEach((node, column) => {
        layoutNodes.push({
          height: planNodeHeight,
          id: node.id,
          width,
          x: planCanvasPadding + column * (width + planColumnGap),
          y: planCanvasPadding + visualRow * (planNodeHeight + planRowGap),
        })
      })
      visualRow += 1
    }
  }

  const layoutById = new Map(layoutNodes.map((node) => [node.id, node]))
  const edges = planNodes.flatMap((node) =>
    node.dependsOn.flatMap((dependencyId) => {
      const source = layoutById.get(dependencyId)
      const target = layoutById.get(node.id)
      if (!source || !target) return []
      const sourceX = source.x + source.width / 2
      const sourceY = source.y + source.height
      const targetX = target.x + target.width / 2
      const targetY = target.y
      const midpointY = (sourceY + targetY) / 2
      const spansIntermediateRow =
        targetY - sourceY > planNodeHeight + planRowGap
      const gutterX =
        sourceX < planCanvasWidth / 2
          ? planCanvasPadding / 2
          : planCanvasWidth - planCanvasPadding / 2
      const path = spansIntermediateRow
        ? `M ${sourceX} ${sourceY} C ${sourceX} ${sourceY + 12}, ${gutterX} ${sourceY + 12}, ${gutterX} ${sourceY + 24} L ${gutterX} ${targetY - 18} C ${gutterX} ${targetY - 8}, ${targetX} ${targetY - 8}, ${targetX} ${targetY}`
        : `M ${sourceX} ${sourceY} C ${sourceX} ${midpointY}, ${targetX} ${midpointY}, ${targetX} ${targetY}`
      return [
        {
          fromId: dependencyId,
          id: `${dependencyId}:${node.id}`,
          path,
          toId: node.id,
        },
      ]
    }),
  )
  return {
    edges,
    height:
      planCanvasPadding * 2 +
      Math.max(1, visualRow) * planNodeHeight +
      Math.max(0, visualRow - 1) * planRowGap,
    nodes: layoutNodes,
    width: planCanvasWidth,
  }
}
