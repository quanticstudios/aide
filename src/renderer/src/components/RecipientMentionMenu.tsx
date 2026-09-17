import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'

interface RecipientMentionMenuProps {
  readonly activeIndex: number
  readonly agents: readonly ManagedSessionAgentConfig[]
  readonly onSelect: (agent: ManagedSessionAgentConfig) => void
}

function selectionLabel(agent: ManagedSessionAgentConfig): string {
  const provider = agent.selection.mode === 'claude' ? 'Claude' : 'Codex'
  return agent.selection.model
    ? `${provider} · ${agent.selection.model}`
    : provider
}

export default function RecipientMentionMenu({
  activeIndex,
  agents,
  onSelect,
}: RecipientMentionMenuProps) {
  if (agents.length === 0) {
    return null
  }

  return (
    <div
      aria-label="Agent suggestions"
      className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-md border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
      data-testid="managed-recipient-menu"
      role="listbox"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
        Agents
      </div>
      <ul className="p-1">
        {agents.map((agent, index) => (
          <li key={agent.alias}>
            <button
              aria-selected={index === activeIndex}
              className={`flex w-full flex-col rounded-lg px-3 py-2 text-left transition-colors ${
                index === activeIndex
                  ? 'bg-surface-tertiary text-foreground'
                  : 'text-foreground/80 hover:bg-surface-secondary'
              }`}
              onClick={() => onSelect(agent)}
              role="option"
              type="button"
            >
              <span className="font-semibold">@{agent.alias}</span>
              <span className="text-xs text-muted-foreground">
                {selectionLabel(agent)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
