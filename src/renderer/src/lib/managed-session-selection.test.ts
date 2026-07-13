import { describe, expect, it } from 'vitest'

import {
  canChangeManagedSessionSelection,
  isProviderSelectionHydrated,
  planManagedSessionSelectionChange,
  providerSelectionHydrationKey,
} from './managed-session-selection'

describe('managed session selection', () => {
  const resolution = {
    effort: 'high',
    explanation: null,
    modelId: 'gpt-5.6-terra',
    serviceTier: 'priority',
  }

  it('waits for the persisted selection for the active workspace and provider', () => {
    const key = providerSelectionHydrationKey('workspace-1', 'codex')

    expect(isProviderSelectionHydrated(null, 'workspace-1', 'codex')).toBe(
      false,
    )
    expect(isProviderSelectionHydrated(key, 'workspace-1', 'codex')).toBe(true)
    expect(isProviderSelectionHydrated(key, 'workspace-2', 'codex')).toBe(false)
  })

  it('plans local selection changes before a session starts and switches after it starts', () => {
    expect(
      planManagedSessionSelectionChange(false, 'codex', resolution),
    ).toEqual({
      kind: 'local',
      selection: {
        effort: 'high',
        mode: 'codex',
        model: 'gpt-5.6-terra',
        serviceTier: 'priority',
      },
    })
    expect(
      planManagedSessionSelectionChange(true, 'codex', resolution),
    ).toMatchObject({
      kind: 'switch',
      selection: {
        effort: 'high',
        mode: 'codex',
        model: 'gpt-5.6-terra',
        serviceTier: 'priority',
      },
    })
  })

  it('does not allow selection mutation while a session has active work', () => {
    expect(canChangeManagedSessionSelection(null)).toBe(true)
    expect(
      canChangeManagedSessionSelection({
        pendingApprovals: [],
        pendingUserInputs: [],
        sessionState: 'ready',
      }),
    ).toBe(true)
    expect(
      canChangeManagedSessionSelection({
        pendingApprovals: [],
        pendingUserInputs: [],
        sessionState: 'running',
      }),
    ).toBe(false)
    expect(
      canChangeManagedSessionSelection({
        pendingApprovals: [{}],
        pendingUserInputs: [],
        sessionState: 'waiting',
      }),
    ).toBe(false)
    expect(
      canChangeManagedSessionSelection({
        pendingApprovals: [],
        pendingUserInputs: [],
        sessionState: 'connecting',
      }),
    ).toBe(false)
  })
})
