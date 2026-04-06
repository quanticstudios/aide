import { describe, expect, it } from 'vitest'

import {
  type WorkspaceActivitySnapshot,
  compareWorkspaceActivityPriority,
  formatWorkspaceActivityLabel,
  resolveAggregateWorkspaceActivity,
  resolveWorkspaceActivityAccentClassName,
  resolveWorkspaceActivityDotClassName,
  shouldPulseWorkspaceActivity,
} from './workspace-activity'

function createActivity(
  state: WorkspaceActivitySnapshot['state'],
  overrides?: Partial<WorkspaceActivitySnapshot>,
): WorkspaceActivitySnapshot {
  return {
    detail: null,
    provider: 'claude',
    source: 'managed',
    state,
    updatedAt: '2026-04-06T12:00:00Z',
    workspaceId: 'workspace-1',
    ...overrides,
  }
}

describe('workspace activity helpers', () => {
  it('formats provider-aware labels for managed and shell sessions', () => {
    expect(formatWorkspaceActivityLabel(createActivity('working'))).toBe(
      'Claude Working',
    )
    expect(
      formatWorkspaceActivityLabel(
        createActivity('terminal-running', {
          provider: 'terminal',
          source: 'fallback',
        }),
      ),
    ).toBe('Terminal Running')
  })

  it('prioritizes errors and approvals above background work', () => {
    expect(
      compareWorkspaceActivityPriority(
        createActivity('working'),
        createActivity('pending-approval'),
      ),
    ).toBeGreaterThan(0)
    expect(
      compareWorkspaceActivityPriority(
        createActivity('completed'),
        createActivity('error'),
      ),
    ).toBeGreaterThan(0)
  })

  it('resolves aggregate activity by status priority', () => {
    expect(
      resolveAggregateWorkspaceActivity([
        createActivity('completed'),
        createActivity('working'),
        createActivity('pending-approval'),
      ]),
    ).toMatchObject({ state: 'pending-approval' })
  })

  it('returns null when no workspace activity exists', () => {
    expect(resolveAggregateWorkspaceActivity([])).toBeNull()
  })

  it('maps activity states to accent styling', () => {
    expect(
      resolveWorkspaceActivityAccentClassName(
        createActivity('pending-approval'),
      ),
    ).toBe('text-amber-400')
    expect(
      resolveWorkspaceActivityDotClassName(createActivity('connecting')),
    ).toBe('bg-sky-300')
  })

  it('only pulses for live connecting and working states', () => {
    expect(shouldPulseWorkspaceActivity(createActivity('working'))).toBe(true)
    expect(shouldPulseWorkspaceActivity(createActivity('connecting'))).toBe(
      true,
    )
    expect(shouldPulseWorkspaceActivity(createActivity('completed'))).toBe(
      false,
    )
  })
})
