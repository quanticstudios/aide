import { describe, expect, it } from 'vitest'

import { mapCodexPlanUpdate } from './codex-plan'

describe('mapCodexPlanUpdate', () => {
  it('maps the steps of a turn to one task-list call keyed by the turn', () => {
    expect(
      mapCodexPlanUpdate(
        {
          explanation: null,
          plan: [
            { status: 'completed', step: 'Read the config' },
            { status: 'inProgress', step: 'Rename the flag' },
            { status: 'pending', step: 'Run the tests' },
          ],
          threadId: 'thread',
          turnId: 'turn-1',
        },
        'turn-0',
      ),
    ).toEqual({
      callId: 'plan:turn-1',
      input: expect.any(Object),
      status: 'completed',
      tasks: [
        { status: 'completed', subject: 'Read the config' },
        { status: 'in_progress', subject: 'Rename the flag' },
        { status: 'pending', subject: 'Run the tests' },
      ],
      toolName: 'update_plan',
    })
  })

  it('keeps the same call id across updates so the list updates in place', () => {
    const first = mapCodexPlanUpdate(
      { plan: [{ status: 'pending', step: 'One' }] },
      'turn',
    )
    const second = mapCodexPlanUpdate(
      { plan: [{ status: 'completed', step: 'One' }] },
      'turn',
    )

    expect(first?.callId).toBe('plan:turn')
    expect(second?.callId).toBe(first?.callId)
    expect(second?.tasks).toEqual([{ status: 'completed', subject: 'One' }])
  })

  it('drops blank steps, defaults unknown statuses and ignores empty plans', () => {
    expect(
      mapCodexPlanUpdate(
        { plan: [{ step: ' ' }, { status: 'weird', step: 'Two' }, null] },
        'turn',
      )?.tasks,
    ).toEqual([{ status: 'pending', subject: 'Two' }])
    expect(mapCodexPlanUpdate({ plan: [] }, 'turn')).toBeNull()
    expect(mapCodexPlanUpdate({ plan: [{ step: 'One' }] }, null)).toBeNull()
    expect(mapCodexPlanUpdate(null, 'turn')).toBeNull()
  })
})
