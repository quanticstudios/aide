import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { FleetState } from '../../../shared/fleet'
import { FleetDrawerContent } from './FleetDrawer'

const fleet: FleetState = {
  acceptedNodeIds: ['prepare'],
  attemptCounts: { implement: 2, prepare: 1 },
  events: [],
  plan: {
    nodes: [
      {
        dependsOn: [],
        detail: 'Select the required workspace context.',
        evidence: 'Jev selected two source files.',
        id: 'prepare',
        status: 'completed',
        title: 'Prepare context',
      },
      {
        dependsOn: ['prepare'],
        detail: 'Implement the planned UI.',
        evidence: '',
        id: 'implement',
        status: 'running',
        title: 'Build interface',
      },
    ],
    summary: 'Prepare context before implementation.',
  },
  updatedAt: '2026-09-18T09:00:00.000Z',
}

describe('FleetDrawerContent', () => {
  it('starts on Plan with dependency, execution, acceptance, and evidence details', () => {
    const markup = renderToStaticMarkup(
      <FleetDrawerContent
        error={null}
        fleet={fleet}
        isAccepting={false}
        jevGates={null}
        onAcceptNode={vi.fn()}
        snapshot={null}
      />,
    )

    expect(markup).toContain('aria-selected="true"')
    expect(markup).toContain('Prepare context before implementation.')
    expect(markup).toContain('1 / 2 completed')
    expect(markup).toContain('1 / 2 accepted')
    expect(markup).toContain('Depends on prepare')
    expect(markup).toContain('Orchestrator-reported evidence')
    expect(markup).toContain('Jev selected two source files.')
  })

  it('does not invent a plan for a session without fleet state', () => {
    const markup = renderToStaticMarkup(
      <FleetDrawerContent
        error={null}
        fleet={null}
        isAccepting={false}
        jevGates={null}
        onAcceptNode={vi.fn()}
        snapshot={null}
      />,
    )

    expect(markup).toContain('No fleet plan has been recorded')
    expect(markup).not.toContain('Prepare context before implementation.')
  })
})
