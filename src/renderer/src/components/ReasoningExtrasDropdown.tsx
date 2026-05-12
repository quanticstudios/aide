import { Check, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type {
  ManagedSessionContextWindow,
  ManagedSessionEffort,
  ManagedSessionThinkingBudget,
} from '../../../shared/managed-session'
import type { ManagedSessionMode } from '../../../shared/terminal'

interface ReasoningExtrasDropdownProps {
  readonly contextWindow: ManagedSessionContextWindow
  readonly effort: ManagedSessionEffort
  readonly fastMode: boolean
  readonly onContextWindowChange: (value: ManagedSessionContextWindow) => void
  readonly onEffortChange: (value: ManagedSessionEffort) => void
  readonly onFastModeChange: (value: boolean) => void
  readonly onThinkingBudgetChange: (value: ManagedSessionThinkingBudget) => void
  readonly provider: ManagedSessionMode
  readonly thinkingBudget: ManagedSessionThinkingBudget
}

interface ClaudeTier {
  readonly id: string
  readonly label: string
  readonly effort: ManagedSessionEffort
  readonly thinkingBudget: ManagedSessionThinkingBudget
}

interface CodexTier {
  readonly id: string
  readonly label: string
  readonly effort: ManagedSessionEffort
}

const CLAUDE_TIERS: readonly ClaudeTier[] = [
  { id: 'low', label: 'Low', effort: 'low', thinkingBudget: 'default' },
  {
    id: 'medium',
    label: 'Medium',
    effort: 'medium',
    thinkingBudget: 'default',
  },
  { id: 'high', label: 'High', effort: 'high', thinkingBudget: 'default' },
  {
    id: 'extra-high',
    label: 'Extra High (default)',
    effort: 'max',
    thinkingBudget: 'default',
  },
  { id: 'max', label: 'Max', effort: 'max', thinkingBudget: 'extra' },
  {
    id: 'ultrathink',
    label: 'Ultrathink',
    effort: 'max',
    thinkingBudget: 'ultra',
  },
]

const CODEX_TIERS: readonly CodexTier[] = [
  { id: 'low', label: 'Low', effort: 'low' },
  { id: 'medium', label: 'Medium (default)', effort: 'medium' },
  { id: 'high', label: 'High', effort: 'high' },
  { id: 'extra-high', label: 'Extra High', effort: 'max' },
]

function getClaudeTier(
  effort: ManagedSessionEffort,
  thinkingBudget: ManagedSessionThinkingBudget,
): ClaudeTier {
  return (
    CLAUDE_TIERS.find(
      (t) => t.effort === effort && t.thinkingBudget === thinkingBudget,
    ) ?? CLAUDE_TIERS[3]
  )
}

function getCodexTier(effort: ManagedSessionEffort): CodexTier {
  return CODEX_TIERS.find((t) => t.effort === effort) ?? CODEX_TIERS[1]
}

function getEffortChipLabel({
  effort,
  provider,
  thinkingBudget,
}: {
  readonly effort: ManagedSessionEffort
  readonly provider: ManagedSessionMode
  readonly thinkingBudget: ManagedSessionThinkingBudget
}): string {
  if (provider === 'claude') {
    const tier = getClaudeTier(effort, thinkingBudget)
    return tier.label.replace(/ \(default\)$/, '')
  }

  return getCodexTier(effort).label.replace(/ \(default\)$/, '')
}

export default function ReasoningExtrasDropdown({
  contextWindow,
  effort,
  fastMode,
  onContextWindowChange,
  onEffortChange,
  onFastModeChange,
  onThinkingBudgetChange,
  provider,
  thinkingBudget,
}: ReasoningExtrasDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

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

  const effortLabel = getEffortChipLabel({ effort, provider, thinkingBudget })
  const extraLabel =
    provider === 'claude'
      ? contextWindow === '1m'
        ? '1M'
        : '200k'
      : fastMode
        ? 'Fast'
        : 'Slow'

  return (
    <div ref={containerRef} className="relative">
      <button
        className="composer-pill flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {effortLabel} · {extraLabel}
        <ChevronDown className="size-3 opacity-50" />
      </button>

      {isOpen ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-[210px] rounded-md border border-border bg-surface py-2 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          <p className="eyebrow px-4 pb-1.5">Reasoning</p>

          {provider === 'claude'
            ? CLAUDE_TIERS.map((tier) => {
                const isSelected =
                  tier.effort === effort &&
                  tier.thinkingBudget === thinkingBudget

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={tier.id}
                    onClick={() => {
                      onEffortChange(tier.effort)
                      onThinkingBudgetChange(tier.thinkingBudget)
                      setIsOpen(false)
                    }}
                    type="button"
                  >
                    {isSelected ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {tier.label}
                  </button>
                )
              })
            : CODEX_TIERS.map((tier) => {
                const isSelected = tier.effort === effort

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={tier.id}
                    onClick={() => {
                      onEffortChange(tier.effort)
                      setIsOpen(false)
                    }}
                    type="button"
                  >
                    {isSelected ? (
                      <Check className="size-3.5" />
                    ) : (
                      <span className="size-3.5" />
                    )}
                    {tier.label}
                  </button>
                )
              })}

          <div className="my-2 border-t border-border" />

          {provider === 'claude' ? (
            <>
              <p className="eyebrow px-4 pb-1.5">Context Window</p>
              {(
                [
                  { id: '200k', label: '200k (default)' },
                  { id: '1m', label: '1M' },
                ] as const
              ).map((option) => {
                const isSelected = option.id === contextWindow

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={option.id}
                    onClick={() => {
                      onContextWindowChange(option.id)
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
          ) : (
            <>
              <p className="eyebrow px-4 pb-1.5">Fast Mode</p>
              {(
                [
                  { id: true, label: 'On' },
                  { id: false, label: 'Off' },
                ] as const
              ).map((option) => {
                const isSelected = option.id === fastMode

                return (
                  <button
                    className={cn(
                      'flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors hover:bg-[var(--surface-2)]',
                      isSelected ? 'text-foreground' : 'text-foreground/80',
                    )}
                    key={String(option.id)}
                    onClick={() => {
                      onFastModeChange(option.id)
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
          )}
        </div>
      ) : null}
    </div>
  )
}
