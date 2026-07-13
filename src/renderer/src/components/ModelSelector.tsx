import { ChevronDown, Search, Star } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
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
      { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'claude' },
      { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'claude' },
      {
        id: 'claude-sonnet-4-6',
        label: 'Claude Sonnet 4.6',
        provider: 'claude',
      },
      {
        id: 'claude-haiku-4-5-20251001',
        label: 'Claude Haiku 4.5',
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

const FAVORITES_STORAGE_KEY = 'aide.favoriteModels'

type TabId = 'favorites' | ManagedSessionMode

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

function loadFavorites(): Set<string> {
  if (typeof window === 'undefined') {
    return new Set()
  }

  try {
    const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY)

    if (!raw) {
      return new Set()
    }

    const parsed = JSON.parse(raw) as unknown

    if (!Array.isArray(parsed)) {
      return new Set()
    }

    return new Set(parsed.filter((v): v is string => typeof v === 'string'))
  } catch {
    return new Set()
  }
}

function persistFavorites(favorites: Set<string>): void {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(
      FAVORITES_STORAGE_KEY,
      JSON.stringify(Array.from(favorites)),
    )
  } catch {
    // Quota / private-mode failures are non-fatal.
  }
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
  const [activeTab, setActiveTab] = useState<TabId>(provider)
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const activeModel = resolveModelOption(model, provider)
  const activeGroup = PROVIDER_GROUPS.find(
    (g) => g.provider === activeModel.provider,
  )
  const ActiveProviderIcon = activeGroup?.icon ?? AnthropicIcon

  const toggleFavorite = useCallback((modelId: string) => {
    setFavorites((current) => {
      const next = new Set(current)

      if (next.has(modelId)) {
        next.delete(modelId)
      } else {
        next.add(modelId)
      }

      persistFavorites(next)
      return next
    })
  }, [])

  const visibleModels = useMemo<readonly ModelOption[]>(() => {
    const pool =
      activeTab === 'favorites'
        ? ALL_MODELS.filter((m) => favorites.has(m.id))
        : (PROVIDER_GROUPS.find((g) => g.provider === activeTab)?.models ?? [])

    if (!search) {
      return pool
    }

    const q = search.toLowerCase()
    return pool.filter(
      (m) =>
        m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
    )
  }, [activeTab, favorites, search])

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

  useEffect(() => {
    if (isOpen) {
      setActiveTab(provider)
    }
  }, [isOpen, provider])

  useEffect(() => {
    if (!isOpen) return

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        setSearch('')
        return
      }

      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
        const index = Number.parseInt(event.key, 10) - 1
        const target = visibleModels[index]

        if (target) {
          event.preventDefault()
          handleSelect(target)
        }
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleSelect, isOpen, visibleModels])

  return (
    <div ref={containerRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-30"
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ActiveProviderIcon className="size-3.5" />
        {activeModel.label}
        <ChevronDown className="size-3 opacity-50" />
      </button>

      {isOpen ? (
        <div className="absolute bottom-full left-0 z-50 mb-1 flex w-[480px] overflow-hidden rounded-xl border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
          {/* Provider rail */}
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-[var(--surface-1)] py-2">
            <ProviderRailButton
              ariaLabel="Favorites"
              icon={Star}
              isActive={activeTab === 'favorites'}
              onClick={() => setActiveTab('favorites')}
            />
            {PROVIDER_GROUPS.map((group) => (
              <ProviderRailButton
                ariaLabel={group.label}
                icon={group.icon}
                isActive={activeTab === group.provider}
                key={group.provider}
                onClick={() => setActiveTab(group.provider)}
              />
            ))}
          </div>

          {/* Right column: search + model list */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-border px-3 pb-2 pt-2.5">
              <div className="flex items-center gap-2 rounded-full border border-border bg-[var(--surface-2)] px-3 py-1.5">
                <Search className="size-3.5 text-muted-foreground" />
                <input
                  ref={searchRef}
                  className="w-full bg-transparent text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models..."
                  type="text"
                  value={search}
                />
              </div>
            </div>

            <div className="h-[320px] overflow-y-auto p-1.5">
              {visibleModels.length === 0 ? (
                <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                  {activeTab === 'favorites'
                    ? 'No starred models yet. Click ★ on any row to add it.'
                    : 'No models found'}
                </p>
              ) : (
                visibleModels.map((opt, index) => {
                  const isSelected = opt.id === activeModel.id
                  const providerLabel =
                    PROVIDER_GROUPS.find((g) => g.provider === opt.provider)
                      ?.label ?? ''
                  const ProviderIcon =
                    PROVIDER_GROUPS.find((g) => g.provider === opt.provider)
                      ?.icon ?? AnthropicIcon
                  const isFavorite = favorites.has(opt.id)
                  const keycapLabel = index < 9 ? `Ctrl+${index + 1}` : null

                  return (
                    <div
                      className={cn(
                        'group/row relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'bg-[var(--surface-2)] text-foreground'
                          : 'text-foreground hover:bg-[var(--surface-1)]',
                      )}
                      key={opt.id}
                    >
                      {isSelected ? (
                        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r bg-primary" />
                      ) : null}
                      <button
                        aria-label={
                          isFavorite ? 'Unfavorite model' : 'Favorite model'
                        }
                        className={cn(
                          'shrink-0 rounded p-0.5 transition-colors',
                          isFavorite
                            ? 'text-accent-yellow'
                            : 'text-muted-foreground/60 hover:text-foreground',
                        )}
                        onClick={() => toggleFavorite(opt.id)}
                        type="button"
                      >
                        <Star
                          className={cn(
                            'size-3.5',
                            isFavorite && 'fill-current',
                          )}
                        />
                      </button>
                      <button
                        aria-pressed={isSelected}
                        className="flex min-w-0 flex-1 flex-col text-left"
                        onClick={() => handleSelect(opt)}
                        type="button"
                      >
                        <span className="display truncate text-sm">
                          {opt.label}
                        </span>
                        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <ProviderIcon className="size-3" />
                          {providerLabel}
                        </span>
                      </button>
                      {keycapLabel ? (
                        <span className="keycap shrink-0">{keycapLabel}</span>
                      ) : null}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProviderRailButton({
  ariaLabel,
  icon: Icon,
  isActive,
  onClick,
}: {
  readonly ariaLabel: string
  readonly icon: SvgIcon
  readonly isActive: boolean
  readonly onClick: () => void
}) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={isActive}
      className={cn(
        'relative flex size-9 items-center justify-center rounded-md transition-colors',
        isActive
          ? 'bg-[var(--surface-2)] text-foreground'
          : 'text-muted-foreground hover:bg-[var(--surface-1)] hover:text-foreground',
      )}
      onClick={onClick}
      type="button"
    >
      <Icon className="size-4" />
      {isActive ? (
        <span className="absolute -right-1 inset-y-2 w-0.5 rounded-l bg-primary" />
      ) : null}
    </button>
  )
}
