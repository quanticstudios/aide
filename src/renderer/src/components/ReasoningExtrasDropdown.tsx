import { Dropdown } from '@heroui/react/dropdown'
import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ManagedSessionEffort } from '../../../shared/managed-session'
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
  readonly provider: ManagedSessionMode
  readonly serviceTier: string | null
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

function formatReasoningLabel(id: string, label: string): string {
  return id === 'xhigh' ? 'Extra High' : label
}

export default function ReasoningExtrasDropdown({
  capabilities,
  effort,
  isDisabled,
  model,
  onEffortChange,
  onServiceTierChange,
  provider,
  serviceTier,
}: ReasoningExtrasDropdownProps) {
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
      : effortOption
        ? formatReasoningLabel(effortOption.id, effortOption.label)
        : effort
  const extraLabel =
    serviceTierOption?.label ?? (provider === 'claude' ? null : 'Default')
  const hasReasoningOptions = modelCapability
    ? modelCapability.reasoningEfforts.length > 0 ||
      modelCapability.serviceTiers.length > 0
    : false

  return (
    <Dropdown>
      <Dropdown.Trigger
        aria-label="Reasoning settings"
        className="composer-tool is-pill"
        isDisabled={isDisabled || !modelCapability || !hasReasoningOptions}
      >
        {extraLabel ? `${effortLabel} · ${extraLabel}` : effortLabel}
        <ChevronDown className="size-3.5 opacity-50" />
      </Dropdown.Trigger>

      {modelCapability ? (
        <Dropdown.Popover
          className="z-50 mb-1 w-[250px] rounded-lg floating-surface py-2"
          placement="top start"
        >
          <Dropdown.Menu aria-label="Reasoning settings">
            {modelCapability.reasoningEfforts.length > 0 ? (
              <Dropdown.Section aria-label="Reasoning">
                <Dropdown.Item
                  className="eyebrow px-4 pb-1.5"
                  id="reasoning-heading"
                  isDisabled
                  textValue="Reasoning"
                >
                  Reasoning
                </Dropdown.Item>
                {modelCapability.reasoningEfforts.map((option) => {
                  const isSelected = option.id === effort
                  const label = formatReasoningLabel(option.id, option.label)

                  return (
                    <Dropdown.Item
                      className={cn(
                        'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground/80',
                      )}
                      id={`effort:${option.id}`}
                      key={option.id}
                      onAction={() => onEffortChange(option.id)}
                      textValue={label}
                    >
                      {isSelected ? (
                        <Check className="size-3.5" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      <span className="flex flex-col text-left">
                        <span className="flex items-center gap-1">
                          {label}
                          {option.id ===
                          modelCapability.defaultReasoningEffort ? (
                            <span className="rounded bg-[var(--surface-2)] px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                              Default
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </Dropdown.Item>
                  )
                })}
              </Dropdown.Section>
            ) : null}

            {modelCapability.serviceTiers.length > 0 ? (
              <Dropdown.Section aria-label="Service Tier">
                <Dropdown.Item
                  className="eyebrow px-4 pb-1.5"
                  id="service-tier-heading"
                  isDisabled
                  textValue="Service Tier"
                >
                  Service Tier
                </Dropdown.Item>
                <Dropdown.Item
                  className={cn(
                    'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                    serviceTier === null
                      ? 'bg-primary/10 text-primary'
                      : 'text-foreground/80',
                  )}
                  id="service-tier:provider-default"
                  onAction={() => onServiceTierChange(null)}
                  textValue="Provider default"
                >
                  {serviceTier === null ? (
                    <Check className="size-3.5" />
                  ) : (
                    <span className="size-3.5" />
                  )}
                  <span>Provider default</span>
                </Dropdown.Item>
                {modelCapability.serviceTiers.map((option) => {
                  const isSelected = option.id === serviceTier

                  return (
                    <Dropdown.Item
                      className={cn(
                        'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                        isSelected
                          ? 'bg-primary/10 text-primary'
                          : 'text-foreground/80',
                      )}
                      id={`service-tier:${option.id}`}
                      key={option.id}
                      onAction={() => onServiceTierChange(option.id)}
                      textValue={option.label}
                    >
                      {isSelected ? (
                        <Check className="size-3.5" />
                      ) : (
                        <span className="size-3.5" />
                      )}
                      <span className="flex flex-col text-left">
                        <span className="flex items-center gap-1">
                          {option.label}
                          {option.id === modelCapability.defaultServiceTier ? (
                            <span className="rounded bg-[var(--surface-2)] px-1.5 py-px text-[10px] font-medium text-muted-foreground">
                              Default
                            </span>
                          ) : null}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {option.description}
                        </span>
                      </span>
                    </Dropdown.Item>
                  )
                })}
              </Dropdown.Section>
            ) : null}
          </Dropdown.Menu>
        </Dropdown.Popover>
      ) : null}
    </Dropdown>
  )
}
