import { z } from 'zod'
import fleetPolicy from './fleet-policy.json'

export const FLEET_MAX_EVENTS = 1_000

export const FleetFailureCategorySchema = z.enum([
  'context',
  'implementation',
  'reasoning',
  'wrong-hypothesis',
  'infrastructure',
  'architecture',
])
export type FleetFailureCategory = z.infer<typeof FleetFailureCategorySchema>

const FleetPolicySchema = z
  .object({
    workerFamily: z.literal('sol'),
    alternateFamily: z.literal('opus'),
    requiredPreparation: z.literal('jev'),
    defaultEffort: z.literal('medium'),
    maxConcurrentAgents: z.number().int().positive(),
    maxAttemptsPerTask: z.number().int().positive(),
    agentTimeoutMs: z.number().int().positive(),
    failureCategories: z.array(FleetFailureCategorySchema).min(1),
  })
  .strict()

export const FLEET_POLICY = FleetPolicySchema.parse(fleetPolicy)

const FleetNodeIdSchema = z.string().trim().min(1).max(64)

export const FleetNodeStatusSchema = z.enum([
  'planned',
  'running',
  'completed',
  'blocked',
  'skipped',
])
export type FleetNodeStatus = z.infer<typeof FleetNodeStatusSchema>

export const FleetPlanNodeSchema = z
  .object({
    id: FleetNodeIdSchema,
    title: z.string().min(1).max(160),
    detail: z.string().max(2_000),
    dependsOn: z.array(FleetNodeIdSchema).max(60),
    status: FleetNodeStatusSchema,
    evidence: z.string().max(2_000),
  })
  .strict()
export type FleetPlanNode = z.infer<typeof FleetPlanNodeSchema>

export const FleetPlanSchema = z
  .object({
    summary: z.string().max(4_000),
    nodes: z.array(FleetPlanNodeSchema).max(60),
  })
  .strict()
  .superRefine((plan, context) => {
    const nodeIds = new Set<string>()

    for (const [index, node] of plan.nodes.entries()) {
      if (nodeIds.has(node.id)) {
        context.addIssue({
          code: 'custom',
          message: `Duplicate fleet node id: ${node.id}`,
          path: ['nodes', index, 'id'],
        })
      }
      nodeIds.add(node.id)

      if (new Set(node.dependsOn).size !== node.dependsOn.length) {
        context.addIssue({
          code: 'custom',
          message: `Fleet node ${node.id} repeats a dependency`,
          path: ['nodes', index, 'dependsOn'],
        })
      }
    }

    const remainingDependencies = new Map<string, number>()
    const dependentIds = new Map<string, string[]>()

    for (const [index, node] of plan.nodes.entries()) {
      const existingDependencies = node.dependsOn.filter((dependencyId) => {
        if (nodeIds.has(dependencyId)) return true

        context.addIssue({
          code: 'custom',
          message: `Fleet node ${node.id} depends on missing node ${dependencyId}`,
          path: ['nodes', index, 'dependsOn'],
        })
        return false
      })

      remainingDependencies.set(node.id, existingDependencies.length)
      for (const dependencyId of existingDependencies) {
        const dependents = dependentIds.get(dependencyId) ?? []
        dependents.push(node.id)
        dependentIds.set(dependencyId, dependents)
      }
    }

    const ready = [...remainingDependencies]
      .filter(([, dependencyCount]) => dependencyCount === 0)
      .map(([nodeId]) => nodeId)
    let visitedCount = 0

    while (ready.length > 0) {
      const nodeId = ready.pop()
      if (nodeId === undefined) break
      visitedCount += 1

      for (const dependentId of dependentIds.get(nodeId) ?? []) {
        const nextCount = (remainingDependencies.get(dependentId) ?? 0) - 1
        remainingDependencies.set(dependentId, nextCount)
        if (nextCount === 0) ready.push(dependentId)
      }
    }

    if (
      visitedCount !== plan.nodes.length &&
      nodeIds.size === plan.nodes.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Fleet plan dependencies must be acyclic',
        path: ['nodes'],
      })
    }
  })
export type FleetPlan = z.infer<typeof FleetPlanSchema>

export const FleetNodeUpdateSchema = z
  .object({
    nodeId: FleetNodeIdSchema,
    status: FleetNodeStatusSchema,
    detail: z.string().max(2_000),
    evidence: z.string().max(2_000),
  })
  .strict()
export type FleetNodeUpdate = z.infer<typeof FleetNodeUpdateSchema>

export const FleetEventSchema = z
  .object({
    id: z.string().min(1).max(64),
    createdAt: z.iso.datetime(),
    turnId: z.string().max(256).nullable(),
    nodeId: FleetNodeIdSchema.optional(),
    activityId: z.string().min(1).max(256).optional(),
    agentAlias: z.string().min(1).max(200).optional(),
    requestedBy: z.enum(['user', 'orchestrator']).optional(),
    attempt: z.number().int().positive().optional(),
    type: z.enum([
      'preparation',
      'context',
      'agent',
      'turn',
      'decision',
      'tool',
    ]),
    status: z.enum(['started', 'completed', 'failed', 'cancelled', 'blocked']),
    label: z.string().max(400),
    detail: z.string().max(2_000),
    model: z.string().max(200).optional(),
    effort: z.string().max(200).optional(),
    source: z.enum(['runtime', 'orchestrator']),
  })
  .strict()
export type FleetEvent = z.infer<typeof FleetEventSchema>

export const FleetStateSchema = z
  .object({
    plan: FleetPlanSchema.nullable(),
    events: z.array(FleetEventSchema).max(FLEET_MAX_EVENTS),
    acceptedNodeIds: z.array(FleetNodeIdSchema).max(60),
    updatedAt: z.iso.datetime(),
    droppedEventCount: z.number().int().nonnegative().optional(),
    attemptCounts: z
      .record(
        FleetNodeIdSchema,
        z.number().int().nonnegative().max(FLEET_POLICY.maxAttemptsPerTask),
      )
      .optional(),
  })
  .strict()
  .superRefine((state, context) => {
    const nodeIds = new Set(state.plan?.nodes.map((node) => node.id) ?? [])

    if (new Set(state.acceptedNodeIds).size !== state.acceptedNodeIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'Accepted fleet node ids must be unique',
        path: ['acceptedNodeIds'],
      })
    }

    for (const [index, nodeId] of state.acceptedNodeIds.entries()) {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({
          code: 'custom',
          message: `Accepted fleet node does not exist in the current plan: ${nodeId}`,
          path: ['acceptedNodeIds', index],
        })
        continue
      }

      const node = state.plan?.nodes.find(
        (candidate) => candidate.id === nodeId,
      )
      if (node?.status !== 'completed') {
        context.addIssue({
          code: 'custom',
          message: `Accepted fleet node is not completed: ${nodeId}`,
          path: ['acceptedNodeIds', index],
        })
      }

      for (const dependencyId of node?.dependsOn ?? []) {
        if (!state.acceptedNodeIds.includes(dependencyId)) {
          context.addIssue({
            code: 'custom',
            message: `Accepted fleet node ${nodeId} has an unaccepted dependency: ${dependencyId}`,
            path: ['acceptedNodeIds', index],
          })
        }
      }
    }

    for (const nodeId of Object.keys(state.attemptCounts ?? {})) {
      if (!nodeIds.has(nodeId)) {
        context.addIssue({
          code: 'custom',
          message: `Fleet attempt count references a node outside the current plan: ${nodeId}`,
          path: ['attemptCounts', nodeId],
        })
      }
    }
  })
export type FleetState = z.infer<typeof FleetStateSchema>

export type FleetRoute = {
  family: 'sol' | 'opus' | null
  effort: 'medium' | 'high' | 'xhigh' | 'max' | null
  action: 'dispatch' | 'retrieve' | 'stop' | 'orchestrator'
  reason: string
}

export type FleetRouteInput = {
  risk: 'routine' | 'high' | 'critical'
  failure?: FleetFailureCategory
  attempt: number
  alternateAvailable: boolean
}

export function chooseFleetRoute(input: FleetRouteInput): FleetRoute {
  if (input.attempt >= FLEET_POLICY.maxAttemptsPerTask) {
    return {
      family: null,
      effort: null,
      action: 'stop',
      reason: `The task reached the ${FLEET_POLICY.maxAttemptsPerTask}-attempt limit.`,
    }
  }

  if (input.failure === 'context') {
    return {
      family: null,
      effort: null,
      action: 'retrieve',
      reason: 'Retrieve missing context before another agent call.',
    }
  }

  if (input.failure === 'infrastructure') {
    return {
      family: null,
      effort: null,
      action: 'stop',
      reason: 'Stop agent calls until the infrastructure failure is corrected.',
    }
  }

  if (input.failure === 'architecture') {
    return {
      family: null,
      effort: null,
      action: 'orchestrator',
      reason:
        'Return the architecture decision to the orchestrator before another agent call.',
    }
  }

  if (input.failure === 'wrong-hypothesis') {
    if (!input.alternateAvailable) {
      return {
        family: null,
        effort: null,
        action: 'stop',
        reason:
          'The alternate agent family is unavailable after a wrong hypothesis.',
      }
    }

    return {
      family: FLEET_POLICY.alternateFamily,
      effort: 'high',
      action: 'dispatch',
      reason: 'Use the alternate agent family to test a different hypothesis.',
    }
  }

  const baseEffort = {
    routine: 'medium',
    high: 'high',
    critical: 'xhigh',
  } as const
  const reasoningEffort = {
    routine: 'high',
    high: 'xhigh',
    critical: 'max',
  } as const

  return {
    family: FLEET_POLICY.workerFamily,
    effort:
      input.failure === 'reasoning'
        ? reasoningEffort[input.risk]
        : baseEffort[input.risk],
    action: 'dispatch',
    reason:
      input.failure === 'reasoning'
        ? 'Retry with stronger reasoning effort in the configured worker family.'
        : `Dispatch the configured worker family at ${baseEffort[input.risk]} effort for ${input.risk} risk.`,
  }
}

export const FLEET_INSTRUCTIONS = `Aide has already run required ${FLEET_POLICY.requiredPreparation} preparation for this input and also prepares each consultation. Use find_relevant_context only when more context is needed. The default recommendation is ${FLEET_POLICY.workerFamily} at ${FLEET_POLICY.defaultEffort} effort. Existing configured agents override automatic fleet recommendations, and recommendations never select a model id. Phrase each choice as "Recommended Sol high; actual configured alias ..." with the applicable family and effort and a short rationale, without hidden reasoning. Call set_fleet_plan to report the planned dependency graph and update_fleet_node to report progress and evidence. For planned work, pass nodeId, reason, risk, and failure when applicable to ask_agent so attempt limits persist. A context failure requires retrieval, an infrastructure failure stops dispatch, an architecture failure returns to the orchestrator, a reasoning failure raises effort, and a wrong hypothesis recommends the alternate family when available. Those blocking failures must be corrected by a new call before ask_agent continues. Plan and status reports do not accept work; only explicit user acceptance records accepted nodes.`
