import { describe, expect, it } from 'vitest'

import type { FleetEvent, FleetState } from '../../../shared/fleet'
import { resolveJevGates } from '../../../shared/jev-gates'
import { deriveLiveFleetFlow, layoutFleetPlan } from './fleet-flow'

function fleetEvent(
  id: string,
  input: Partial<FleetEvent> & Pick<FleetEvent, 'status' | 'type'>,
): FleetEvent {
  return {
    createdAt: `2026-09-18T10:00:0${id}.000Z`,
    detail: id,
    id,
    label: id,
    source: 'runtime',
    turnId: null,
    ...input,
  }
}

function fleetState(events: FleetEvent[]): FleetState {
  return {
    acceptedNodeIds: [],
    events,
    plan: null,
    updatedAt: '2026-09-18T10:00:09.000Z',
  }
}

describe('deriveLiveFleetFlow', () => {
  it('animates a consultation only when its exact activity is running', () => {
    const activityId = 'opinion:current'
    const fleet = fleetState([
      fleetEvent('1', {
        activityId,
        agentAlias: 'Claude',
        label: 'Route @Claude',
        requestedBy: 'orchestrator',
        source: 'orchestrator',
        status: 'completed',
        type: 'decision',
      }),
      fleetEvent('2', {
        activityId,
        agentAlias: 'Claude',
        label: '@Claude',
        status: 'started',
        type: 'agent',
      }),
    ])

    const live = deriveLiveFleetFlow(
      fleet,
      ['Claude', 'Codex'],
      new Set([activityId]),
      new Set(),
    )

    expect(live.agents.map(({ alias, status }) => ({ alias, status }))).toEqual(
      [
        { alias: 'Claude', status: 'running' },
        { alias: 'Codex', status: 'idle' },
      ],
    )
    expect(live.headline).toBe('@Claude is working')
    expect(live.agents[0]?.decisionEvent?.activityId).toBe(activityId)
  })

  it('keeps each agent paired with its own routing decision', () => {
    const fleet = fleetState([
      fleetEvent('1', {
        activityId: 'opinion:claude',
        agentAlias: 'Claude',
        label: 'Route @Claude',
        requestedBy: 'orchestrator',
        source: 'orchestrator',
        status: 'completed',
        type: 'decision',
        turnId: 'outer',
      }),
      fleetEvent('2', {
        activityId: 'opinion:codex',
        agentAlias: 'Codex',
        label: 'Route @Codex',
        requestedBy: 'orchestrator',
        source: 'orchestrator',
        status: 'completed',
        type: 'decision',
        turnId: 'outer',
      }),
      fleetEvent('3', { type: 'turn', status: 'completed', turnId: 'outer' }),
    ])
    const live = deriveLiveFleetFlow(
      fleet,
      ['Claude', 'Codex'],
      new Set(),
      new Set(),
    )

    expect(live.agents.map((agent) => agent.decisionEvent?.activityId)).toEqual(
      ['opinion:claude', 'opinion:codex'],
    )
  })

  it('keeps an unmatched historical start dormant after restart', () => {
    const live = deriveLiveFleetFlow(
      fleetState([
        fleetEvent('1', {
          activityId: 'opinion:old',
          agentAlias: 'Claude',
          label: '@Claude',
          status: 'started',
          type: 'agent',
        }),
      ]),
      ['Claude'],
      new Set(),
      new Set(),
    )

    expect(live.agents[0]?.status).toBe('idle')
    expect(live.headline).toBe('Waiting for observed fleet activity')
  })

  it('does not carry an old agent start into a newer running turn', () => {
    const currentTurnId = 'turn-current'
    const live = deriveLiveFleetFlow(
      fleetState([
        fleetEvent('1', {
          activityId: 'opinion:old',
          agentAlias: 'Claude',
          label: '@Claude',
          status: 'started',
          turnId: 'turn-old',
          type: 'agent',
        }),
        fleetEvent('2', {
          label: 'Orchestrator turn',
          status: 'started',
          turnId: currentTurnId,
          type: 'turn',
        }),
      ]),
      ['Claude'],
      new Set(),
      new Set([currentTurnId]),
    )

    expect(live.agents[0]?.status).toBe('idle')
    expect(live.orchestratorStatus).toBe('running')
  })

  it('stops activity when the matching consultation completes', () => {
    const activityId = 'opinion:done'
    const live = deriveLiveFleetFlow(
      fleetState([
        fleetEvent('1', {
          activityId,
          agentAlias: 'Claude',
          label: '@Claude',
          status: 'started',
          type: 'agent',
        }),
        fleetEvent('2', {
          activityId,
          agentAlias: 'Claude',
          label: '@Claude',
          status: 'completed',
          type: 'agent',
        }),
      ]),
      ['Claude'],
      new Set([activityId]),
      new Set(),
    )

    expect(live.agents[0]?.status).toBe('completed')
  })

  it('animates Jev only for a live preparation activity', () => {
    const activityId = 'user-prompt:1'
    const live = deriveLiveFleetFlow(
      fleetState([
        fleetEvent('1', {
          activityId,
          label: 'Jev preparation',
          requestedBy: 'user',
          status: 'started',
          type: 'preparation',
        }),
      ]),
      [],
      new Set([activityId]),
      new Set(),
    )

    expect(live.jevStatus).toBe('running')
    expect(live.headline).toBe('Jev is preparing context')
  })

  it('uses the outer running turn for on-demand context retrieval', () => {
    const turnId = 'turn-current'
    const live = deriveLiveFleetFlow(
      fleetState([
        fleetEvent('1', {
          activityId: 'context:1',
          label: 'Jev context lookup',
          requestedBy: 'orchestrator',
          status: 'started',
          turnId,
          type: 'context',
        }),
      ]),
      [],
      new Set(),
      new Set([turnId]),
    )

    expect(live.jevStatus).toBe('running')
  })
})

it('keeps a direct model reply separate from the preceding orchestrator turn', () => {
  const flow = deriveLiveFleetFlow(
    fleetState([
      fleetEvent('1', {
        type: 'turn',
        status: 'completed',
        turnId: 'old-turn',
      }),
      fleetEvent('2', {
        type: 'agent',
        status: 'completed',
        activityId: 'opinion:new',
        agentAlias: 'Claude',
        requestedBy: 'user',
      }),
    ]),
    ['Claude'],
    new Set(),
    new Set(),
  )
  expect(flow.orchestratorStatus).toBe('idle')
  expect(flow.agents[0]?.status).toBe('completed')
  expect(flow.outcomeStatus).toBe('completed')
})

describe('layoutFleetPlan', () => {
  it('places independent work in parallel lanes above its dependent node', () => {
    const layout = layoutFleetPlan([
      {
        dependsOn: [],
        detail: '',
        evidence: '',
        id: 'research',
        status: 'planned',
        title: 'Research',
      },
      {
        dependsOn: [],
        detail: '',
        evidence: '',
        id: 'design',
        status: 'planned',
        title: 'Design',
      },
      {
        dependsOn: ['research', 'design'],
        detail: '',
        evidence: '',
        id: 'build',
        status: 'planned',
        title: 'Build',
      },
    ])
    const research = layout.nodes.find((node) => node.id === 'research')
    const design = layout.nodes.find((node) => node.id === 'design')
    const build = layout.nodes.find((node) => node.id === 'build')

    expect(research?.y).toBe(design?.y)
    expect(build?.y).toBeGreaterThan(research?.y ?? Number.MAX_SAFE_INTEGER)
    expect(layout.edges).toHaveLength(2)
  })

  it('routes multi-level dependencies through a side gutter', () => {
    const node = (id: string, dependsOn: string[]) => ({
      dependsOn,
      detail: '',
      evidence: '',
      id,
      status: 'planned' as const,
      title: id,
    })
    const layout = layoutFleetPlan([
      node('a', []),
      node('b', []),
      node('c', ['b']),
      node('d', ['a', 'c']),
    ])
    const longEdge = layout.edges.find((edge) => edge.id === 'a:d')

    expect(longEdge?.path).toContain(' L ')
  })
})

describe('gate nodes in the live flow', () => {
  const enabled = resolveJevGates({
    completionCheck: { enabled: true },
    laneRouting: { enabled: true },
    toolGate: { enabled: true },
  })

  function gates(
    settings: Parameters<typeof deriveLiveFleetFlow>[4],
    aliases: readonly string[] = ['claude', 'codex'],
  ) {
    return deriveLiveFleetFlow(
      fleetState([]),
      aliases,
      new Set(),
      new Set(),
      settings,
    ).gates
  }

  it('draws nothing while every gate is off', () => {
    expect(gates(resolveJevGates())).toEqual([])
    expect(gates(undefined)).toEqual([])
  })

  it('routes lane routing between Jev and the agent decision', () => {
    const lane = gates(enabled).find((gate) => gate.section === 'laneRouting')

    expect(lane).toMatchObject({
      id: 'gate-laneRouting',
      sourceIds: ['jev'],
      subtitle: 'high ≥ 0.60, critical ≥ 0.85',
      targetId: 'decision',
      title: 'Lane routing',
    })
  })

  it('hangs one tool call gate off each agent', () => {
    const toolGates = gates(enabled).filter(
      (gate) => gate.section === 'toolGate',
    )

    expect(toolGates.map((gate) => gate.sourceIds)).toEqual([
      ['agent-claude'],
      ['agent-codex'],
    ])
    expect(toolGates.every((gate) => gate.targetId === null)).toBe(true)
    expect(toolGates[0]?.id).toBe('gate-toolGate-agent-claude')
    expect(toolGates[0]?.subtitle).toBe('allow < 0.10, deny ≥ 0.90')
  })

  it('checks completion on every agent return before the outcome', () => {
    const completion = gates(enabled).find(
      (gate) => gate.section === 'completionCheck',
    )

    expect(completion).toMatchObject({
      id: 'gate-completionCheck',
      sourceIds: ['agent-claude', 'agent-codex'],
      targetId: 'outcome',
      title: 'Completion check',
    })
  })

  it('feeds the completion check from the decision when no agent is configured', () => {
    const [completion] = gates(
      resolveJevGates({ completionCheck: { enabled: true } }),
      [],
    )

    expect(completion?.sourceIds).toEqual(['decision'])
    expect(completion?.targetId).toBe('outcome')
  })

  it('disables one gate without dropping the others', () => {
    const sections = gates(
      resolveJevGates({
        completionCheck: { enabled: true },
        laneRouting: { enabled: true },
      }),
    ).map((gate) => gate.section)

    expect(sections).toEqual(['laneRouting', 'completionCheck'])
  })
})
