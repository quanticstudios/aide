import { Settings2, X } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import {
  type ProviderCapabilitiesSnapshot,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type { ManagedSessionMode } from '../../../shared/terminal'
import ModelSelector from './ModelSelector'

interface ConfiguredAgentSettingsProps {
  readonly agents: readonly ManagedSessionAgentConfig[]
  readonly capabilities: ProviderCapabilitiesSnapshot | null
  readonly isDisabled: boolean
  readonly onChange: (agents: readonly ManagedSessionAgentConfig[]) => void
}

export default function ConfiguredAgentSettings({
  agents,
  capabilities,
  isDisabled,
  onChange,
}: ConfiguredAgentSettingsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const enabledLabel = useMemo(
    () => agents.map((agent) => `@${agent.alias}`).join(', '),
    [agents],
  )

  const handleModelChange = useCallback(
    (alias: string, provider: ManagedSessionMode, model: string) => {
      const providerCapabilities = capabilities?.providers[provider]

      if (!providerCapabilities) {
        return
      }

      const resolution = resolveProviderSelection(providerCapabilities, {
        modelId: model,
      })

      const effort = resolution.effort
      const modelId = resolution.modelId

      if (!effort || !modelId) {
        return
      }

      onChange(
        agents.map((agent) =>
          agent.alias === alias
            ? {
                alias: agent.alias,
                selection: {
                  effort,
                  mode: provider,
                  model: modelId,
                  ...(resolution.serviceTier
                    ? { serviceTier: resolution.serviceTier }
                    : {}),
                },
              }
            : agent,
        ),
      )
    },
    [agents, capabilities, onChange],
  )

  return (
    <div className="relative">
      <button
        aria-expanded={isOpen}
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        disabled={isDisabled || !capabilities}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Settings2 className="size-3.5" />
        Agents
      </button>
      {isOpen ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-80 rounded-xl border border-border bg-surface p-3 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">
                Configured agents
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Mention an agent to use its model for one reply.
              </p>
            </div>
            <button
              aria-label="Close agent settings"
              className="rounded p-1 text-muted-foreground hover:text-foreground"
              onClick={() => setIsOpen(false)}
              type="button"
            >
              <X className="size-3.5" />
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {agents.map((agent) => (
              <div
                className="flex items-center justify-between gap-3 rounded-lg border border-border/60 px-2.5 py-2"
                key={agent.alias}
              >
                <span className="text-sm font-semibold text-foreground">
                  @{agent.alias}
                </span>
                <ModelSelector
                  availableProviders={[agent.selection.mode]}
                  capabilities={capabilities}
                  model={agent.selection.model}
                  onChange={(provider, model) =>
                    handleModelChange(agent.alias, provider, model)
                  }
                  provider={agent.selection.mode}
                />
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted-foreground" role="status">
            {enabledLabel || 'No agents are configured.'}
          </p>
        </div>
      ) : null}
    </div>
  )
}
