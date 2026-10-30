import { Kbd } from '@heroui/react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from 'cmdk'
import { useEffect, useRef } from 'react'

import type { PaletteCommand } from '@/lib/command-registry'

interface CommandPaletteProps {
  readonly commands: readonly PaletteCommand[]
  readonly isOpen: boolean
  readonly onClose: () => void
}

const GROUP_LABELS: Record<PaletteCommand['group'], string> = {
  create: 'Create',
  navigation: 'Navigation',
  view: 'View',
}

const GROUP_ORDER: readonly PaletteCommand['group'][] = [
  'navigation',
  'create',
  'view',
]

export default function CommandPalette({
  commands,
  isOpen,
  onClose,
}: CommandPaletteProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (isOpen) {
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [isOpen])

  if (!isOpen) {
    return null
  }

  const grouped = new Map<PaletteCommand['group'], PaletteCommand[]>()

  for (const cmd of commands) {
    const existing = grouped.get(cmd.group)

    if (existing) {
      existing.push(cmd)
    } else {
      grouped.set(cmd.group, [cmd])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <button
        aria-label="Close command palette"
        className="fixed inset-0 bg-scrim"
        onClick={onClose}
        type="button"
      />
      <Command
        className="relative w-full max-w-lg rounded-xl floating-surface"
        label="Command palette"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
        }}
      >
        <CommandInput
          className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          placeholder="Type a command..."
          ref={inputRef}
        />
        <CommandList className="max-h-72 overflow-y-auto p-1.5">
          <CommandEmpty className="px-4 py-6 text-center text-sm text-muted-foreground">
            No results found.
          </CommandEmpty>
          {GROUP_ORDER.map((group) => {
            const items = grouped.get(group)

            if (!items || items.length === 0) {
              return null
            }

            return (
              <CommandGroup
                heading={GROUP_LABELS[group]}
                key={group}
                className="[&_[cmdk-group-heading]]:eyebrow [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5"
              >
                {items.map((cmd) => {
                  const Icon = cmd.icon

                  return (
                    <CommandItem
                      className="flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-foreground transition-colors data-[selected=true]:bg-surface-tertiary data-[selected=true]:text-foreground"
                      key={cmd.id}
                      keywords={cmd.keywords as string[] | undefined}
                      onSelect={() => {
                        cmd.onSelect()
                        onClose()
                      }}
                      value={`${cmd.id}:${cmd.label}`}
                    >
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1 truncate">{cmd.label}</span>
                      {cmd.shortcut ? (
                        <span className="ml-auto flex shrink-0 items-center gap-1">
                          {cmd.shortcut.split(' ').map((part) => (
                            <Kbd className="keycap" key={part}>
                              {part}
                            </Kbd>
                          ))}
                        </span>
                      ) : null}
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            )
          })}
        </CommandList>
      </Command>
    </div>
  )
}
