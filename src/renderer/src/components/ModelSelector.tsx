import { ChevronDown, Search, Star } from 'lucide-react'
import type { ComponentType, SVGProps } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type {
  ProviderCapabilitiesSnapshot,
  ProviderModelCapability,
} from '../../../shared/provider-capabilities'
import { resolveProviderSelection } from '../../../shared/provider-capabilities'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { AnthropicIcon, OpenAIIcon } from './ui/provider-icons'

type SvgIcon = ComponentType<SVGProps<SVGSVGElement>>

export interface ModelOption {
  readonly description: string
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

const FAVORITES_STORAGE_KEY = 'aide.favoriteModels'

type TabId = 'favorites' | ManagedSessionMode

function getProviderLabel(provider: ManagedSessionMode): string {
  return provider === 'claude' ? 'Claude' : 'Codex'
}

function getProviderIcon(provider: ManagedSessionMode): SvgIcon {
  return provider === 'claude' ? AnthropicIcon : OpenAIIcon
}

function toModelOption(
  provider: ManagedSessionMode,
  model: ProviderModelCapability,
): ModelOption {
  return {
    description: model.description,
    id: model.id,
    label: model.label,
    provider,
  }
}

function getProviderGroups(
  capabilities: ProviderCapabilitiesSnapshot | null,
): readonly ProviderGroup[] {
  if (!capabilities) {
    return []
  }

  return (['claude', 'codex'] as const).map((provider) => ({
    icon: getProviderIcon(provider),
    label: getProviderLabel(provider),
    models: capabilities.providers[provider].models.map((model) =>
      toModelOption(provider, model),
    ),
    provider,
  }))
}

export function resolveModelOption(
  modelId: string | undefined,
  provider: ManagedSessionMode,
  capabilities: ProviderCapabilitiesSnapshot | null,
): ModelOption | null {
  const providerCapabilities = capabilities?.providers[provider]

  if (!providerCapabilities) {
    return null
  }

  const selection = resolveProviderSelection(providerCapabilities, { modelId })
  const model = providerCapabilities.models.find(
    (candidate) => candidate.id === selection.modelId,
  )

  return model ? toModelOption(provider, model) : null
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

    return new Set(
      parsed.filter((value): value is string => typeof value === 'string'),
    )
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
  readonly availableProviders?: readonly ManagedSessionMode[]
  readonly capabilities: ProviderCapabilitiesSnapshot | null
  readonly isDisabled?: boolean
  readonly isOpen?: boolean
  readonly model: string | undefined
  readonly onChange: (provider: ManagedSessionMode, modelId: string) => void
  readonly onOpenChange?: (isOpen: boolean) => void
  readonly provider: ManagedSessionMode
}

export default function ModelSelector({
  availableProviders,
  capabilities,
  isDisabled,
  isOpen: controlledIsOpen,
  model,
  onChange,
  onOpenChange,
  provider,
}: ModelSelectorProps) {
  const [uncontrolledIsOpen, setUncontrolledIsOpen] = useState(false)
  const isOpen = controlledIsOpen ?? uncontrolledIsOpen
  const setIsOpen = useCallback(
    (next: boolean) => {
      setUncontrolledIsOpen(next)
      onOpenChange?.(next)
    },
    [onOpenChange],
  )
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>(provider)
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites())
  const containerRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const providerGroups = useMemo(
    () =>
      getProviderGroups(capabilities).filter(
        (group) =>
          !availableProviders || availableProviders.includes(group.provider),
      ),
    [availableProviders, capabilities],
  )
  const allModels = useMemo(
    () => providerGroups.flatMap((group) => group.models),
    [providerGroups],
  )
  const activeModel = resolveModelOption(model, provider, capabilities)
  const ActiveProviderIcon = getProviderIcon(provider)
  const providerError = capabilities?.providers[provider].error ?? null

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
        ? allModels.filter((candidate) => favorites.has(candidate.id))
        : (providerGroups.find((group) => group.provider === activeTab)
            ?.models ?? [])

    if (!search) {
      return pool
    }

    const query = search.toLowerCase()
    return pool.filter(
      (candidate) =>
        candidate.label.toLowerCase().includes(query) ||
        candidate.description.toLowerCase().includes(query) ||
        candidate.id.toLowerCase().includes(query),
    )
  }, [activeTab, allModels, favorites, providerGroups, search])

  const handleSelect = useCallback(
    (option: ModelOption) => {
      onChange(option.provider, option.id)
      setIsOpen(false)
      setSearch('')
    },
    [onChange, setIsOpen],
  )

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
        setSearch('')
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, setIsOpen])

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
    if (!isOpen) {
      return
    }

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setIsOpen(false)
        setSearch('')
        return
      }

      if ((event.ctrlKey || event.metaKey) && /^[1-9]$/.test(event.key)) {
        const option = visibleModels[Number.parseInt(event.key, 10) - 1]

        if (option) {
          event.preventDefault()
          handleSelect(option)
        }
      }
    }

    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [handleSelect, isOpen, setIsOpen, visibleModels])

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        className="composer-tool max-w-full"
        disabled={isDisabled || !capabilities || Boolean(providerError)}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ActiveProviderIcon className="size-4 shrink-0" />
        <span className="truncate">
          {activeModel?.label ??
            (providerError ? 'Models unavailable' : 'Loading models…')}
        </span>
        <ChevronDown className="size-3.5 opacity-50" />
      </button>

      {isOpen ? (
        <div
          data-model-selector-menu
          className="absolute bottom-full left-0 z-50 mb-1 flex w-[480px] overflow-hidden rounded-xl floating-surface"
        >
          <div className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-[var(--surface-1)] py-2">
            <ProviderRailButton
              ariaLabel="Favorites"
              icon={Star}
              isActive={activeTab === 'favorites'}
              onClick={() => setActiveTab('favorites')}
            />
            {providerGroups.map((group) => (
              <ProviderRailButton
                ariaLabel={group.label}
                icon={group.icon}
                isActive={activeTab === group.provider}
                key={group.provider}
                onClick={() => setActiveTab(group.provider)}
              />
            ))}
          </div>

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
                    : 'No models available from this provider.'}
                </p>
              ) : (
                visibleModels.map((option, index) => {
                  const isSelected = option.id === activeModel?.id
                  const providerIcon = getProviderIcon(option.provider)
                  const ProviderIcon = providerIcon
                  const isFavorite = favorites.has(option.id)
                  const keycapLabel = index < 9 ? `Ctrl+${index + 1}` : null

                  return (
                    <div
                      className={cn(
                        'group/row relative flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                        isSelected
                          ? 'bg-[var(--surface-2)] text-foreground'
                          : 'text-foreground hover:bg-[var(--surface-1)]',
                      )}
                      key={`${option.provider}:${option.id}`}
                    >
                      {isSelected ? (
                        <span className="absolute bottom-1.5 left-0 top-1.5 w-0.5 rounded-r bg-primary" />
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
                        onClick={() => toggleFavorite(option.id)}
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
                        onClick={() => handleSelect(option)}
                        type="button"
                      >
                        <span className="display truncate text-sm">
                          {option.label}
                        </span>
                        <span className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
                          <ProviderIcon className="size-3 shrink-0" />
                          {option.description ||
                            getProviderLabel(option.provider)}
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
