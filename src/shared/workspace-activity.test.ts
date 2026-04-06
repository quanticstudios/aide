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
  updatedAt = '2026-04-06T12:00:00Z',
): WorkspaceActivitySnapshot {
  return {
    detail: null,
    provider: 'claude',
    state,
    updatedAt,
    workspaceId: 'workspace-1',
  }
}

describe('workspace activity helpers', () => {
  it('formats a compact provider-aware label', () => {
    expect(formatWorkspaceActivityLabel(createActivity('working'))).toBe(
      'Claude working',
    )
  })

  it('prioritizes attention above other live states', () => {
    expect(
      compareWorkspaceActivityPriority(
        createActivity('working'),
        createActivity('attention'),
      ),
    ).toBeGreaterThan(0)
  })

  it('resolves aggregate activity by state priority', () => {
    expect(
      resolveAggregateWorkspaceActivity([
        createActivity('ready'),
        createActivity('working'),
        createActivity('attention'),
      ]),
    ).toMatchObject({ state: 'attention' })
  })

  it('returns null when no workspace activity exists', () => {
    expect(resolveAggregateWorkspaceActivity([])).toBeNull()
  })

  it('maps activity states to accent styling', () => {
    expect(
      resolveWorkspaceActivityAccentClassName(createActivity('working')),
    ).toBe('text-sky-400')
    expect(resolveWorkspaceActivityDotClassName(createActivity('error'))).toBe(
      'bg-red-400',
    )
  })

  it('only pulses for active work', () => {
    expect(shouldPulseWorkspaceActivity(createActivity('working'))).toBe(true)
    expect(shouldPulseWorkspaceActivity(createActivity('ready'))).toBe(false)
  })
})
