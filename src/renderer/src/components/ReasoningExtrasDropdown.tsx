import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import type {
  ManagedSessionEffort,
  ManagedSessionThinkingBudget,
} from '../../../shared/managed-session'
import type {
  ProviderCapabilitiesSnapshot,
  ProviderModelCapability,
} from '../../../shared/provider-capabilities'
import { resolveProviderSelection } from '../../../shared/provider-capabilities'
import type { ManagedSessionMode } from '../../../shared/terminal'

interface ReasoningExtrasDropdownProps {
  readonly capabilities: ProviderCapabilitiesSnapshot | null
  readonly effort: ManagedSessionEffort | undefined
  readonly isDisabled?: boolean
  readonly model: string | undefined
  readonly onEffortChange: (value: ManagedSessionEffort) => void
  readonly onServiceTierChange: (value: string | null) => void
  readonly onThinkingBudgetChange: (value: ManagedSessionThinkingBudget) => void
  readonly provider: ManagedSessionMode
  readonly serviceTier: string | null
  readonly thinkingBudget: ManagedSessionThinkingBudget
}

function getModelCapability(
  capabilities: ProviderCapabilitiesSnapshot | null,
  provider: ManagedSessionMode,
  model: string | undefined,
): ProviderModelCapability | null {
  const providerCapabilities = capabilities?.providers[provider]

  if (!providerCapabilities) {
    return null
  }

  const selection = resolveProviderSelection(providerCapabilities, {
    modelId: model,
  })

  return (
    providerCapabilities.models.find(
      (candidate) => candidate.id === selection.modelId,
    ) ?? null
  )
}

function getThinkingLabel(
  effort: ManagedSessionEffort | undefined,
  thinkingBudget: ManagedSessionThinkingBudget,
): string {
  if (thinkingBudget === 'ultra') {
    return 'Ultrathink'
  }

  if (thinkingBudget === 'extra') {
    return 'Max'
  }

  return effort ?? 'Default'
}

export default function ReasoningExtrasDropdown({
  capabilities,
  effort,
  isDisabled,
  model,
  onEffortChange,
  onServiceTierChange,
  onThinkingBudgetChange,
  provider,
  serviceTier,
  thinkingBudget,
}: ReasoningExtrasDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const modelCapability = getModelCapability(capabilities, provider, model)
  const effortOption = modelCapability?.reasoningEfforts.find(
    (candidate) => candidate.id === effort,
  )
  const serviceTierOption = modelCapability?.serviceTiers.find(
    (candidate) => candidate.id === serviceTier,
  )
  const effortLabel =
    modelCapability?.reasoningEfforts.length === 0
      ? 'Provider default'
      : provider === 'claude'
        ? getThinkingLabel(effort, thinkingBudget)
        : (effortOption?.label ?? effort)
  const extraLabel =
    serviceTierOption?.label ?? (provider === 'claude' ? null : 'Default')
  const hasReasoningOptions = modelCapability
    ? modelCapability.reasoningEfforts.length > 0 ||
      modelCapability.serviceTiers.length > 0
    : false

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
      }
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKey)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        className="composer-pill flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold disabled:pointer-events-none disabled:opacity-30"
        disabled={isDisabled || !modelCapability || !hasReasoningOptions}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {extraLabel ? `${effortLabel} · ${extraLabel}` : effortLabel}
        <ChevronDown className="size-3 opacity-50" />
      </button>

      {isOpen && modelCapability ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-[250px] rounded-md border border-border bg-surface py-2 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <p className="eyebrow px-4 pb-1.5">Reasoning</p>
          {modelCapability.reasoningEfforts.map((option) => {
            const isSelected = option.id === effort

            return (
              <button
                className={cn(
                  'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                  isSelected ? 'text-foreground' : 'text-foreground/80',
                )}
                key={option.id}
                onClick={() => {
                  onEffortChange(option.id)
                  setIsOpen(false)
                }}
                type="button"
              >
                {isSelected ? (
                  <Check className="size-3.5" />
                ) : (
                  <span className="size-3.5" />
                )}
                <span className="flex flex-col text-left">
                  {option.label}
                  <span className="text-xs text-muted-foreground">
                    {option.description}
                  </span>
                </span>
              </button>
            )
          })}

          {modelCapability.serviceTiers.length > 0 ? (
            <>
              <div className="my-2 border-t border-border" />
              <p className="eyebrow px-4 pb-1.5">Service Tier</p>
              {modelCapability.serviceTiers.map((option) => {
                const isSelected = option.id === serviceTier

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={option.id}
                    onClick={() => {
                      onServiceTierChange(option.id)
                      setIsOpen(false)
                    }}
                    type="button"
                  >
                    {isSelected ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    <span className="flex flex-col text-left">
                      {option.label}
                      <span className="text-xs text-muted-foreground">
                        {option.description}
                      </span>
                    </span>
                  </button>
                )
              })}
            </>
          ) : null}

          {provider === 'claude' &&
          modelCapability.reasoningEfforts.length > 0 ? (
            <>
              <div className="my-2 border-t border-border" />
              <p className="eyebrow px-4 pb-1.5">Thinking Budget</p>
              {(
                [
                  { id: 'default', label: 'Default' },
                  { id: 'extra', label: 'Max' },
                  { id: 'ultra', label: 'Ultrathink' },
                ] as const
              ).map((option) => {
                const isSelected = option.id === thinkingBudget

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={option.id}
                    onClick={() => {
                      onThinkingBudgetChange(option.id)
                      setIsOpen(false)
                    }}
                    type="button"
                  >
                    {isSelected ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {option.label}
                  </button>
                )
              })}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
