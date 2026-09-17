import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  chooseFleetRoute,
  FLEET_INSTRUCTIONS,
  FLEET_MAX_EVENTS,
  FLEET_POLICY,
  type FleetEvent,
  type FleetPlanNode,
  FleetPlanSchema,
  FleetStateSchema,
} from './fleet'

function node(id: string, dependsOn: string[] = []): FleetPlanNode {
  return {
    id,
    title: id,
    detail: '',
    dependsOn,
    status: 'planned',
    evidence: '',
  }
}

function event(id: string): FleetEvent {
  return {
    id,
    createdAt: '2026-09-18T00:00:00.000Z',
    turnId: null,
    type: 'turn',
    status: 'completed',
    label: id,
    detail: '',
    source: 'runtime',
  }
}

describe('FleetPlanSchema', () => {
  it('accepts a dependency graph', () => {
    expect(
      FleetPlanSchema.parse({
        summary: 'Ship the feature',
        nodes: [
          node('prepare'),
          node('build', ['prepare']),
          node('verify', ['build']),
        ],
      }),
    ).toMatchObject({ summary: 'Ship the feature' })
  })

  it.each([
    { name: 'duplicate node ids', nodes: [node('same'), node('same')] },
    { name: 'missing dependencies', nodes: [node('build', ['prepare'])] },
    {
      name: 'dependency cycles',
      nodes: [node('one', ['two']), node('two', ['one'])],
    },
    {
      name: 'duplicate dependencies',
      nodes: [node('prepare'), node('build', ['prepare', 'prepare'])],
    },
  ])('rejects $name', ({ nodes }) => {
    expect(() => FleetPlanSchema.parse({ summary: '', nodes })).toThrow()
  })

  it('enforces graph and object caps', () => {
    expect(() =>
      FleetPlanSchema.parse({
        summary: '',
        nodes: Array.from({ length: 61 }, (_, index) => node(`node-${index}`)),
      }),
    ).toThrow()
    expect(() =>
      FleetPlanSchema.parse({
        summary: '',
        nodes: [node('dependent', Array(61).fill('root'))],
      }),
    ).toThrow()
    expect(() =>
      FleetPlanSchema.parse({ summary: '', nodes: [], extra: true }),
    ).toThrow()
  })
})

describe('FleetStateSchema', () => {
  const completedNode = { ...node('build'), status: 'completed' as const }
  const plan = { summary: '', nodes: [completedNode] }
  const state = {
    plan,
    events: [],
    acceptedNodeIds: [],
    updatedAt: '2026-09-18T00:00:00.000Z',
  }

  it('accepts old state without optional accounting fields', () => {
    expect(FleetStateSchema.parse(state)).toEqual(state)
  })

  it('accepts bounded event and attempt accounting', () => {
    expect(
      FleetStateSchema.parse({
        ...state,
        acceptedNodeIds: ['build'],
        droppedEventCount: 4,
        attemptCounts: { build: 3 },
      }),
    ).toMatchObject({ droppedEventCount: 4, attemptCounts: { build: 3 } })
  })

  it('rejects references outside the current plan', () => {
    expect(() =>
      FleetStateSchema.parse({ ...state, acceptedNodeIds: ['missing'] }),
    ).toThrow()
    expect(() =>
      FleetStateSchema.parse({ ...state, attemptCounts: { missing: 1 } }),
    ).toThrow()
  })

  it('rejects acceptance before completion or dependency acceptance', () => {
    expect(() =>
      FleetStateSchema.parse({
        ...state,
        plan: { summary: '', nodes: [node('planned')] },
        acceptedNodeIds: ['planned'],
      }),
    ).toThrow()

    expect(() =>
      FleetStateSchema.parse({
        ...state,
        plan: {
          summary: '',
          nodes: [
            { ...node('prepare'), status: 'completed' },
            { ...node('build', ['prepare']), status: 'completed' },
          ],
        },
        acceptedNodeIds: ['build'],
      }),
    ).toThrow()
  })

  it('accepts completed nodes with accepted dependencies', () => {
    expect(() =>
      FleetStateSchema.parse({
        ...state,
        plan: {
          summary: '',
          nodes: [
            { ...node('prepare'), status: 'completed' },
            { ...node('build', ['prepare']), status: 'completed' },
          ],
        },
        acceptedNodeIds: ['prepare', 'build'],
      }),
    ).not.toThrow()
  })

  it('rejects duplicate acceptances and accounting above policy caps', () => {
    expect(() =>
      FleetStateSchema.parse({ ...state, acceptedNodeIds: ['build', 'build'] }),
    ).toThrow()
    expect(() =>
      FleetStateSchema.parse({ ...state, attemptCounts: { build: 4 } }),
    ).toThrow()
    expect(() =>
      FleetStateSchema.parse({
        ...state,
        events: Array.from({ length: FLEET_MAX_EVENTS + 1 }, (_, index) =>
          event(String(index)),
        ),
      }),
    ).toThrow()
  })

  it('supports optional fleet persistence in a parent snapshot', () => {
    const ParentSnapshotSchema = z.object({
      fleet: FleetStateSchema.optional(),
    })
    expect(ParentSnapshotSchema.parse({})).toEqual({})
    expect(ParentSnapshotSchema.parse({ fleet: state })).toEqual({
      fleet: state,
    })
  })
})

describe('fleet policy', () => {
  it('exposes the declarative execution limits', () => {
    expect(FLEET_POLICY).toMatchObject({
      workerFamily: 'sol',
      alternateFamily: 'opus',
      requiredPreparation: 'jev',
      defaultEffort: 'medium',
      maxConcurrentAgents: 2,
      maxAttemptsPerTask: 3,
      agentTimeoutMs: 180_000,
    })
  })

  it.each([
    ['routine', 'medium'],
    ['high', 'high'],
    ['critical', 'xhigh'],
  ] as const)('routes %s risk to %s effort', (risk, effort) => {
    expect(
      chooseFleetRoute({ risk, attempt: 0, alternateAvailable: false }),
    ).toMatchObject({
      family: 'sol',
      effort,
      action: 'dispatch',
    })
  })

  it('raises effort after a reasoning failure', () => {
    expect(
      chooseFleetRoute({
        risk: 'critical',
        failure: 'reasoning',
        attempt: 1,
        alternateAvailable: true,
      }),
    ).toMatchObject({ family: 'sol', effort: 'max', action: 'dispatch' })
  })

  it('switches family after a wrong hypothesis only when available', () => {
    expect(
      chooseFleetRoute({
        risk: 'critical',
        failure: 'wrong-hypothesis',
        attempt: 1,
        alternateAvailable: true,
      }),
    ).toMatchObject({ family: 'opus', effort: 'high', action: 'dispatch' })
    expect(
      chooseFleetRoute({
        risk: 'routine',
        failure: 'wrong-hypothesis',
        attempt: 1,
        alternateAvailable: false,
      }),
    ).toMatchObject({ family: null, effort: null, action: 'stop' })
  })

  it.each([
    ['context', 'retrieve'],
    ['infrastructure', 'stop'],
    ['architecture', 'orchestrator'],
  ] as const)('blocks dispatch for %s failures', (failure, action) => {
    expect(
      chooseFleetRoute({
        risk: 'routine',
        failure,
        attempt: 1,
        alternateAvailable: true,
      }),
    ).toMatchObject({ family: null, effort: null, action })
  })

  it('stops at the attempt limit before any retry route', () => {
    expect(
      chooseFleetRoute({
        risk: 'routine',
        failure: 'reasoning',
        attempt: 3,
        alternateAvailable: true,
      }),
    ).toMatchObject({ family: null, effort: null, action: 'stop' })
  })

  it('describes the orchestration and acceptance boundaries', () => {
    expect(FLEET_INSTRUCTIONS).toContain('Existing configured agents override')
    expect(FLEET_INSTRUCTIONS).toContain(
      'Recommended Sol high; actual configured alias',
    )
    expect(FLEET_INSTRUCTIONS).toContain('without hidden reasoning')
    expect(FLEET_INSTRUCTIONS).toContain('set_fleet_plan')
    expect(FLEET_INSTRUCTIONS).toContain('update_fleet_node')
    expect(FLEET_INSTRUCTIONS).toContain(
      'only explicit user acceptance records accepted nodes',
    )
  })
})
