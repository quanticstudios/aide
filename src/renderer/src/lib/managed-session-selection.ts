import type { ManagedSessionProviderSelection } from '../../../shared/managed-session'
import type { ProviderSelectionResolution } from '../../../shared/provider-capabilities'
import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'
import type { ManagedSessionMode } from '../../../shared/terminal'

export function providerSelectionHydrationKey(
  workspaceId: string,
  provider: ManagedSessionMode,
): string {
  return `${workspaceId}:${provider}`
}

export function isProviderSelectionHydrated(
  hydratedKey: string | null,
  workspaceId: string,
  provider: ManagedSessionMode,
): boolean {
  return hydratedKey === providerSelectionHydrationKey(workspaceId, provider)
}

export interface ResolvedManagedSessionProviderSelection
  extends ManagedSessionProviderSelection {
  readonly model: string
}

export type ManagedSessionSelectionChange =
  | {
      readonly kind: 'local' | 'switch'
      readonly selection: ResolvedManagedSessionProviderSelection
    }
  | { readonly kind: 'unavailable' }

export function planManagedSessionSelectionChange(
  hasStartedSession: boolean,
  mode: ManagedSessionMode,
  resolution: ProviderSelectionResolution,
): ManagedSessionSelectionChange {
  if (!resolution.modelId) {
    return { kind: 'unavailable' }
  }

  return {
    kind: hasStartedSession ? 'switch' : 'local',
    selection: {
      ...(resolution.effort ? { effort: resolution.effort } : {}),
      mode,
      model: resolution.modelId,
      serviceTier: resolution.serviceTier,
    },
  }
}

export function canChangeManagedSessionSelection(
  session: {
    readonly pendingApprovals: readonly unknown[]
    readonly pendingUserInputs: readonly unknown[]
    readonly sessionState: ManagedProviderRuntimeSessionState
  } | null,
): boolean {
  return Boolean(
    !session ||
      ((session.sessionState === 'ready' ||
        session.sessionState === 'stopped' ||
        session.sessionState === 'error') &&
        session.pendingApprovals.length === 0 &&
        session.pendingUserInputs.length === 0),
  )
}
