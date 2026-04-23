import { Command } from '@heroui-pro/react'
import { Kbd } from '@heroui/react'
import type { Key } from 'react'

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

function buildTextValue(command: PaletteCommand): string {
  const keywords = command.keywords?.join(' ') ?? ''
  return `${command.label} ${keywords}`.trim()
}

export default function CommandPalette({
  commands,
  isOpen,
  onClose,
}: CommandPaletteProps) {
  const grouped = new Map<PaletteCommand['group'], PaletteCommand[]>()

  for (const cmd of commands) {
    const existing = grouped.get(cmd.group)

    if (existing) {
      existing.push(cmd)
    } else {
      grouped.set(cmd.group, [cmd])
    }
  }

  const handleAction = (key: Key) => {
    const command = commands.find((cmd) => cmd.id === key)

    if (command) {
      command.onSelect()
      onClose()
    }
  }

  return (
    <Command>
      <Command.Backdrop
        isOpen={isOpen}
        onOpenChange={(open: boolean) => {
          if (!open) {
            onClose()
          }
        }}
        variant="blur"
      >
        <Command.Container>
          <Command.Dialog>
            <Command.InputGroup>
              <Command.InputGroup.Input placeholder="Type a command..." />
              <Command.InputGroup.ClearButton />
              <Command.InputGroup.Suffix>
                <Kbd className="text-xs">
                  <Kbd.Content>Esc</Kbd.Content>
                </Kbd>
              </Command.InputGroup.Suffix>
            </Command.InputGroup>
            <Command.List
              onAction={handleAction}
              renderEmptyState={() => (
                <div className="flex h-12 items-center justify-center px-4 text-sm text-muted-foreground">
                  No results found.
                </div>
              )}
            >
              {GROUP_ORDER.map((group) => {
                const items = grouped.get(group)

                if (!items || items.length === 0) {
                  return null
                }

                return (
                  <Command.Group heading={GROUP_LABELS[group]} key={group}>
                    {items.map((cmd) => {
                      const Icon = cmd.icon

                      return (
                        <Command.Item
                          id={cmd.id}
                          key={cmd.id}
                          textValue={buildTextValue(cmd)}
                        >
                          <Icon className="size-4 shrink-0 text-muted-foreground" />
                          <span className="flex-1 truncate">{cmd.label}</span>
                          {cmd.shortcut ? (
                            <span
                              className="ml-auto flex shrink-0 items-center gap-1"
                              slot="keyboard"
                            >
                              {cmd.shortcut.split(' ').map((part) => (
                                <Kbd
                                  className="min-w-5 border border-border/60 bg-background/70 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                  key={part}
                                >
                                  {part}
                                </Kbd>
                              ))}
                            </span>
                          ) : null}
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )
              })}
            </Command.List>
          </Command.Dialog>
        </Command.Container>
      </Command.Backdrop>
    </Command>
  )
}
