import type { ManagedSessionProviderSelection } from './managed-session'

/** An @agent from the dropped multi-agent routing (ENG-2898); kept only because saved built-in sessions still carry it. */
export interface ManagedSessionAgentConfig {
  readonly alias: string
  readonly selection: ManagedSessionProviderSelection
}

export function getNextRecipientSuggestionIndex(
  activeIndex: number,
  suggestionCount: number,
  key: 'ArrowDown' | 'ArrowUp',
): number | null {
  if (suggestionCount === 0) {
    return null
  }

  if (key === 'ArrowDown') {
    return (activeIndex + 1) % suggestionCount
  }

  return (activeIndex - 1 + suggestionCount) % suggestionCount
}
