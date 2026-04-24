import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'

export interface SlashCommandContext {
  readonly clearDraft: () => void
  readonly copyTranscript: () => Promise<void>
  readonly interrupt: () => void
  readonly sessionState: ManagedProviderRuntimeSessionState | undefined
  readonly setDraft: (text: string) => void
}

export interface SlashCommand {
  readonly description: string
  readonly id: string
  readonly isAvailable?: (ctx: SlashCommandContext) => boolean
  readonly label: string
  readonly run: (ctx: SlashCommandContext) => void | Promise<void>
}

const HELP_TEXT = [
  'Keybindings:',
  '• Enter — send prompt',
  '• Shift+Enter — new line',
  '• / — open this slash-command menu',
  '• Esc — dismiss menus and modals',
  '• Cmd/Ctrl+K — command palette',
].join('\n')

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  {
    description: 'Clear the prompt draft',
    id: 'clear',
    label: '/clear',
    run: (ctx) => ctx.clearDraft(),
  },
  {
    description: 'Stop the current turn',
    id: 'interrupt',
    isAvailable: (ctx) => ctx.sessionState === 'running',
    label: '/interrupt',
    run: (ctx) => {
      ctx.interrupt()
      ctx.clearDraft()
    },
  },
  {
    description: 'Copy the full pane transcript to the clipboard',
    id: 'copy-transcript',
    label: '/copy-transcript',
    run: async (ctx) => {
      await ctx.copyTranscript()
      ctx.clearDraft()
    },
  },
  {
    description: 'Show the keybinding reference',
    id: 'help',
    label: '/help',
    run: (ctx) => ctx.setDraft(HELP_TEXT),
  },
]

export function filterSlashCommands(
  commands: readonly SlashCommand[],
  query: string,
  ctx: SlashCommandContext,
): SlashCommand[] {
  const normalized = query.toLowerCase()

  return commands.filter((command) => {
    if (command.isAvailable && !command.isAvailable(ctx)) {
      return false
    }

    if (normalized.length === 0) {
      return true
    }

    return (
      command.id.toLowerCase().includes(normalized) ||
      command.label.toLowerCase().includes(normalized) ||
      command.description.toLowerCase().includes(normalized)
    )
  })
}

export function extractSlashQuery(draft: string): string | null {
  if (!draft.startsWith('/')) {
    return null
  }

  if (draft.includes(' ') || draft.includes('\n')) {
    return null
  }

  return draft.slice(1)
}
