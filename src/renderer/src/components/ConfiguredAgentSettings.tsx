import { Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import {
  type ProviderCapabilitiesSnapshot,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { useClickOutside } from '../lib/use-click-outside'
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
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useClickOutside(containerRef, () => setIsOpen(false), isOpen)
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

      if (!modelId) {
        return
      }

      onChange(
        agents.map((agent) =>
          agent.alias === alias
            ? {
                alias: agent.alias,
                selection: {
                  ...(effort ? { effort } : {}),
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

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        aria-expanded={isOpen}
        className="composer-tool"
        disabled={isDisabled || !capabilities}
        onClick={() => setIsOpen((open) => !open)}
        type="button"
      >
        <Settings2 className="size-4" />
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
