import { ChevronDown, Cpu, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ManagedSessionMode } from '../../../shared/terminal'

const PROVIDER_OPTIONS: ReadonlyArray<{
  icon: LucideIcon
  label: string
  mode: ManagedSessionMode
}> = [
  { icon: Sparkles, label: 'Claude', mode: 'claude' },
  { icon: Cpu, label: 'Codex', mode: 'codex' },
]

interface ModelSelectorProps {
  readonly isDisabled?: boolean
  readonly onChange: (mode: ManagedSessionMode) => void
  readonly value: ManagedSessionMode
}

export default function ModelSelector({
  isDisabled,
  onChange,
  value,
}: ModelSelectorProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeOption =
    PROVIDER_OPTIONS.find((opt) => opt.mode === value) ?? PROVIDER_OPTIONS[0]
  const ActiveIcon = activeOption.icon

  const handleSelect = useCallback(
    (mode: ManagedSessionMode) => {
      onChange(mode)
      setIsOpen(false)
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
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
        disabled={isDisabled}
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <ActiveIcon className="size-3.5" />
        {activeOption.label}
        <ChevronDown className="size-3 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 mb-1 z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg">
          {PROVIDER_OPTIONS.map((opt) => {
            const Icon = opt.icon

            return (
              <button
                className={`flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-xs transition-colors ${
                  opt.mode === value
                    ? 'bg-secondary text-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                }`}
                key={opt.mode}
                onClick={() => handleSelect(opt.mode)}
                type="button"
              >
                <Icon className="size-3.5" />
                {opt.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
