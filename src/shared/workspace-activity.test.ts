import { describe, expect, it } from 'vitest'

import {
  type WorkspaceActivitySnapshot,
  compareWorkspaceActivityPriority,
  formatWorkspaceActivityLabel,
  formatWorkspaceActivityPillLabel,
  resolveAggregateWorkspaceActivity,
  resolveWorkspaceActivityAccentClassName,
  resolveWorkspaceActivityBorderColorClassName,
  resolveWorkspaceActivityDotClassName,
  resolveWorkspaceActivityPillClassName,
  resolveWorkspaceAttentionTier,
  shouldPulseWorkspaceActivity,
} from './workspace-activity'

function createActivity(
  state: WorkspaceActivitySnapshot['state'],
  overrides?: Partial<WorkspaceActivitySnapshot>,
): WorkspaceActivitySnapshot {
  return {
    detail: null,
    paneId: 'pane-1',
    provider: 'claude',
    sessionId: 'session-1',
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
      'Agent Working',
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

  it('orders plan-ready ahead of completed and terminal fallback activity', () => {
    expect(
      resolveAggregateWorkspaceActivity([
        createActivity('completed'),
        createActivity('terminal-running', { provider: 'terminal' }),
        createActivity('plan-ready'),
      ]),
    ).toMatchObject({ state: 'plan-ready' })
    expect(
      resolveWorkspaceActivityAccentClassName(createActivity('plan-ready')),
    ).toBe('text-accent-purple')
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
    ).toBe('text-accent-yellow')
    expect(
      resolveWorkspaceActivityDotClassName(createActivity('connecting')),
    ).toBe('bg-accent-blue')
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

  it('classifies attention tiers by user-action urgency', () => {
    expect(resolveWorkspaceAttentionTier(createActivity('error'))).toBe(
      'attention',
    )
    expect(
      resolveWorkspaceAttentionTier(createActivity('pending-approval')),
    ).toBe('attention')
    expect(
      resolveWorkspaceAttentionTier(createActivity('awaiting-input')),
    ).toBe('attention')
    expect(resolveWorkspaceAttentionTier(createActivity('working'))).toBe(
      'active',
    )
    expect(resolveWorkspaceAttentionTier(createActivity('connecting'))).toBe(
      'active',
    )
    expect(
      resolveWorkspaceAttentionTier(createActivity('terminal-running')),
    ).toBe('active')
    expect(resolveWorkspaceAttentionTier(createActivity('completed'))).toBe(
      'idle',
    )
    expect(resolveWorkspaceAttentionTier(null)).toBe('idle')
    expect(resolveWorkspaceAttentionTier(undefined)).toBe('idle')
  })

  it('formats compact pill labels', () => {
    expect(formatWorkspaceActivityPillLabel(createActivity('working'))).toBe(
      'Agent Working',
    )
    expect(
      formatWorkspaceActivityPillLabel(createActivity('pending-approval')),
    ).toBe('Agent Approval')
    expect(
      formatWorkspaceActivityPillLabel(createActivity('awaiting-input')),
    ).toBe('Agent Input')
    expect(formatWorkspaceActivityPillLabel(createActivity('completed'))).toBe(
      'Agent Done',
    )
    expect(
      formatWorkspaceActivityPillLabel(
        createActivity('terminal-running', {
          provider: 'terminal',
          source: 'fallback',
        }),
      ),
    ).toBe('Running')
  })

  it('returns pill class triples matching activity state', () => {
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('error')),
    ).toContain('text-accent-red')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('pending-approval')),
    ).toContain('text-accent-yellow')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('working')),
    ).toContain('text-accent-blue')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('completed')),
    ).toContain('text-accent-green')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('awaiting-input')),
    ).toContain('text-accent-yellow')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('connecting')),
    ).toContain('text-accent-blue')
    expect(
      resolveWorkspaceActivityPillClassName(createActivity('terminal-running')),
    ).toContain('text-accent-green')
  })

  it('returns border-l color classes per activity state', () => {
    expect(
      resolveWorkspaceActivityBorderColorClassName(createActivity('error')),
    ).toBe('border-l-accent-red')
    expect(
      resolveWorkspaceActivityBorderColorClassName(
        createActivity('pending-approval'),
      ),
    ).toBe('border-l-accent-yellow')
    expect(
      resolveWorkspaceActivityBorderColorClassName(createActivity('working')),
    ).toBe('border-l-accent-blue')
    expect(
      resolveWorkspaceActivityBorderColorClassName(
        createActivity('connecting'),
      ),
    ).toBe('border-l-accent-blue')
    expect(
      resolveWorkspaceActivityBorderColorClassName(
        createActivity('awaiting-input'),
      ),
    ).toBe('border-l-accent-yellow')
    expect(
      resolveWorkspaceActivityBorderColorClassName(createActivity('completed')),
    ).toBe('border-l-accent-green')
    expect(resolveWorkspaceActivityBorderColorClassName(null)).toBe(
      'border-l-transparent',
    )
  })
})
