import { describe, expect, it } from 'vitest'

import type { ComposerDefaults } from '../../../shared/composer-defaults'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
import type { ProviderCapabilities } from '../../../shared/provider-capabilities'
import { resolveProviderSelection } from '../../../shared/provider-capabilities'
import {
  canChangeManagedSessionSelection,
  composerProviderSelectionInput,
  getComposerProviderSelection,
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

  const storedDefaults: ComposerDefaults = {
    agents: [],
    effort: 'low',
    model: 'gpt-5.6-terra',
    permissionMode: 'bypassPermissions',
    provider: 'codex',
    serviceTier: 'priority',
  }
  const codexCapabilities: ProviderCapabilities = {
    defaultModelId: 'gpt-5.6-terra',
    error: null,
    models: [
      {
        aliases: [],
        defaultReasoningEffort: 'medium',
        defaultServiceTier: null,
        description: 'Codex model.',
        id: 'gpt-5.6-terra',
        isDefault: true,
        label: 'GPT-5.6 Terra',
        reasoningEfforts: [
          { description: 'Fast.', id: 'low', label: 'Low' },
          { description: 'Balanced.', id: 'medium', label: 'Medium' },
        ],
        serviceTiers: [
          { description: 'Higher priority.', id: 'priority', label: 'Fast' },
        ],
      },
    ],
    provider: 'codex',
    version: null,
  }

  it('prefers a live session over stored defaults, and stored defaults over the provider default', () => {
    const snapshot = {
      effort: 'high',
      model: 'claude-sonnet-5',
      pendingProviderSelection: undefined,
      provider: 'claude',
      serviceTier: null,
    } as unknown as ManagedSessionSnapshot

    expect(getComposerProviderSelection(snapshot)).toEqual({
      effort: 'high',
      mode: 'claude',
      model: 'claude-sonnet-5',
      serviceTier: null,
    })
    expect(composerProviderSelectionInput(storedDefaults, 'codex')).toEqual({
      effort: 'low',
      modelId: 'gpt-5.6-terra',
      serviceTier: 'priority',
    })
    expect(composerProviderSelectionInput(storedDefaults, 'claude')).toEqual({})
    expect(composerProviderSelectionInput(null, 'codex')).toEqual({})
    expect(
      resolveProviderSelection(
        codexCapabilities,
        composerProviderSelectionInput(storedDefaults, 'codex'),
      ),
    ).toMatchObject({ effort: 'low', serviceTier: 'priority' })
    expect(
      resolveProviderSelection(
        codexCapabilities,
        composerProviderSelectionInput(null, 'codex'),
      ),
    ).toMatchObject({ effort: 'medium', modelId: 'gpt-5.6-terra' })
  })

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

  it('keeps models that do not support reasoning effort available', () => {
    expect(
      planManagedSessionSelectionChange(false, 'claude', {
        effort: null,
        explanation: null,
        modelId: 'haiku',
        serviceTier: null,
      }),
    ).toEqual({
      kind: 'local',
      selection: {
        mode: 'claude',
        model: 'haiku',
        serviceTier: null,
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
