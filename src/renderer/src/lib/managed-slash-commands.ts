import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'
import type { ProviderSkill } from '../../../shared/provider-skills'

export interface SlashCommandContext {
  readonly agentMode: 'build' | 'plan'
  readonly clearDraft: () => void
  readonly copyTranscript: () => Promise<void>
  readonly interrupt: () => void
  readonly sessionState: ManagedProviderRuntimeSessionState | undefined
  readonly setAgentMode: (mode: 'build' | 'plan') => void | Promise<void>
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
  '• Esc — dismiss menus and modals, or stop the running turn',
  '• Cmd/Ctrl+K — command palette',
  '• Cmd/Ctrl+Shift+M — model selector',
  '• Cmd/Ctrl+Shift+E — reasoning effort',
  '• Cmd/Ctrl+Shift+A — permission mode',
  '• Cmd/Ctrl+Shift+Enter — send the oldest queued message now',
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
  {
    description: 'Plan mode: the agent reads and proposes, no edits',
    id: 'plan',
    isAvailable: (ctx) => ctx.agentMode !== 'plan',
    label: '/plan',
    run: async (ctx) => {
      ctx.clearDraft()
      await ctx.setAgentMode('plan')
    },
  },
  {
    description: 'Build mode: the agent edits and runs commands',
    id: 'build',
    isAvailable: (ctx) => ctx.agentMode !== 'build',
    label: '/build',
    run: async (ctx) => {
      ctx.clearDraft()
      await ctx.setAgentMode('build')
    },
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

export function filterProviderSkills(
  skills: readonly ProviderSkill[],
  query: string,
): ProviderSkill[] {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replace(/[-_:]+/g, ' ')
      .trim()
  const normalized = normalize(query)

  if (normalized.length === 0) {
    return [...skills]
  }

  const words = normalized.split(/\s+/)
  return skills
    .map((skill) => {
      const name = normalize(skill.name)
      const searchable = normalize(
        `${skill.name} ${skill.description} ${skill.owner} ${skill.provider}`,
      )
      const rank =
        name === normalized
          ? 0
          : name.startsWith(normalized)
            ? 1
            : words.every((word) => name.includes(word))
              ? 2
              : words.every((word) => searchable.includes(word))
                ? 3
                : -1
      return { skill, rank }
    })
    .filter(({ rank }) => rank >= 0)
    .sort((left, right) => left.rank - right.rank)
    .map(({ skill }) => skill)
}
