import { Check, ChevronDown, Search } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { ManagedSessionMode } from '../../../shared/terminal'
import { AnthropicIcon, OpenAIIcon } from './ui/provider-icons'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface ModelOption {
  readonly id: string
  readonly label: string
  readonly provider: ManagedSessionMode
}

interface ProviderGroup {
  readonly icon: SvgIcon
  readonly label: string
  readonly models: readonly ModelOption[]
  readonly provider: ManagedSessionMode
}

const PROVIDER_GROUPS: readonly ProviderGroup[] = [
  {
    icon: AnthropicIcon,
    label: 'Claude',
    models: [
      { id: 'claude-opus-4-7', label: 'Opus 4.7', provider: 'claude' },
      { id: 'claude-opus-4-6', label: 'Opus 4.6', provider: 'claude' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', provider: 'claude' },
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Haiku 4.5',
        provider: 'claude',
      },
    ],
    provider: 'claude',
  },
  {
    icon: OpenAIIcon,
    label: 'Codex',
    models: [
      { id: 'gpt-5.5', label: 'GPT-5.5', provider: 'codex' },
      { id: 'gpt-5.4', label: 'GPT-5.4', provider: 'codex' },
      { id: 'gpt-5.4-mini', label: 'GPT-5.4-Mini', provider: 'codex' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3-Codex', provider: 'codex' },
      {
        id: 'gpt-5.3-codex-spark',
        label: 'GPT-5.3-Codex-Spark',
        provider: 'codex',
      },
      { id: 'gpt-5.2', label: 'GPT-5.2', provider: 'codex' },
    ],
    provider: 'codex',
  },
]

const ALL_MODELS = PROVIDER_GROUPS.flatMap((g) => g.models)

const DEFAULT_MODELS: Record<ManagedSessionMode, string> = {
  claude: 'claude-sonnet-4-6',
  codex: 'gpt-5.4',
}

export function resolveModelOption(
  modelId: string | undefined,
  provider: ManagedSessionMode,
): ModelOption {
  if (modelId) {
    const found = ALL_MODELS.find((m) => m.id === modelId)
    if (found) return found
  }
  const fallbackId = DEFAULT_MODELS[provider]
  return ALL_MODELS.find((m) => m.id === fallbackId) ?? ALL_MODELS[0]
}

interface ModelSelectorProps {
  readonly isDisabled?: boolean
  readonly model: string | undefined
  readonly onChange: (provider: ManagedSessionMode, modelId: string) => void
  readonly provider: ManagedSessionMode
}

export default function ModelSelector({
  isDisabled,
  model,
  onChange,
  provider,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const activeModel = resolveModelOption(model, provider)
  const activeGroup = PROVIDER_GROUPS.find(
    (g) => g.provider === activeModel.provider,
  )
  const ActiveProviderIcon = activeGroup?.icon ?? AnthropicIcon

  const filteredGroups = useMemo(() => {
    const groups = search
      ? PROVIDER_GROUPS.map((group) => {
          const q = search.toLowerCase()
          return {
            ...group,
            models: group.models.filter(
              (m) =>
                m.label.toLowerCase().includes(q) ||
                m.id.toLowerCase().includes(q) ||
                group.label.toLowerCase().includes(q),
            ),
          }
        }).filter((group) => group.models.length > 0)
      : [...PROVIDER_GROUPS]

    return groups.sort((a, b) => {
      if (a.provider === provider) return -1
      if (b.provider === provider) return 1
      return 0
    })
  }, [provider, search])

  const handleSelect = useCallback(
    (opt: ModelOption) => {
      onChange(opt.provider, opt.id)
      setIsOpen(false)
      setSearch('')
    },
    [onChange],
  )

  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false)
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  useEffect(() => {
    if (isOpen && searchRef.current) {
      searchRef.current.focus()
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ActiveProviderIcon className="size-3.5" />
        {activeModel.label}
        <ChevronDown className="size-3 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1 w-[280px] rounded-xl border border-border bg-popover shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <div className="px-3 pb-2 pt-2.5">
            <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-background px-2.5 py-1.5">
              <Search className="size-3.5 text-muted-foreground" />
              <input
                ref={searchRef}
                className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search models..."
                type="text"
                value={search}
              />
            </div>
          </div>
          <div className="max-h-[320px] overflow-y-auto px-1.5 pb-1.5">
            {filteredGroups.map((group) => {
              const GroupIcon = group.icon

              return (
                <div key={group.provider}>
                  <div className="flex items-center gap-2 px-3 pb-1 pt-2 text-[10px] uppercase tracking-wider text-muted-foreground">
                    <GroupIcon className="size-3" />
                    {group.label}
                  </div>
                  {group.models.map((opt) => {
                    const isSelected = opt.id === activeModel.id

                    return (
                      <button
                        className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${
                          isSelected
                            ? 'bg-secondary text-foreground'
                            : 'text-foreground/80 hover:bg-secondary/60'
                        }`}
                        key={opt.id}
                        onClick={() => handleSelect(opt)}
                        type="button"
                      >
                        <span className="flex-1 text-left">{opt.label}</span>
                        {isSelected && (
                          <Check className="size-3.5 text-muted-foreground" />
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
            {filteredGroups.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No models found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
