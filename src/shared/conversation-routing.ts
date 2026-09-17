import type { ManagedSessionProviderSelection } from './managed-session'

const RECIPIENT_MENTION_PATTERN = /^@([A-Za-z][A-Za-z0-9_-]*)(?=\s|$)/
const RECIPIENT_QUERY_PATTERN = /^@([A-Za-z0-9_-]*)$/

export interface ManagedSessionAgentConfig {
  readonly alias: string
  readonly selection: ManagedSessionProviderSelection
}

export interface ExplicitRecipientAliases {
  readonly aliases: readonly string[]
  readonly error?: string
  readonly text: string
}

export interface RecipientMention {
  readonly draft: string
  readonly query: string
}

function normalizeAlias(alias: string): string {
  return alias.toLowerCase()
}

export function getRecipientMentionQuery(draft: string): string | null {
  return RECIPIENT_QUERY_PATTERN.exec(draft)?.[1] ?? null
}

export function getRecipientSuggestions(
  query: string | null,
  configuredAgents: readonly ManagedSessionAgentConfig[],
): readonly ManagedSessionAgentConfig[] {
  if (query === null) {
    return []
  }

  const normalizedQuery = normalizeAlias(query)
  return configuredAgents.filter((agent) =>
    normalizeAlias(agent.alias).startsWith(normalizedQuery),
  )
}

export function getNextRecipientSuggestionIndex(
  activeIndex: number,
  suggestionCount: number,
  key: 'ArrowDown' | 'ArrowUp',
): number | null {
  if (suggestionCount === 0) {
    return null
  }

  if (key === 'ArrowDown') {
    return (activeIndex + 1) % suggestionCount
  }

  return (activeIndex - 1 + suggestionCount) % suggestionCount
}

export function removeRecipientMention(draft: string): RecipientMention | null {
  const match = RECIPIENT_MENTION_PATTERN.exec(draft)

  if (!match) {
    return null
  }

  return {
    draft: draft.slice(match[0].length).trimStart(),
    query: match[1] ?? '',
  }
}

export function extractExplicitRecipientAliases(
  draft: string,
  configuredAliases: readonly string[],
): ExplicitRecipientAliases {
  const configuredAliasSet = new Set(configuredAliases.map(normalizeAlias))
  const aliases: string[] = []
  let text = draft

  while (true) {
    const mention = removeRecipientMention(text)

    if (!mention) {
      return { aliases, text }
    }

    const alias = normalizeAlias(mention.query)

    if (!configuredAliasSet.has(alias)) {
      return {
        aliases,
        error: `Unknown agent @${mention.query}.`,
        text: draft,
      }
    }

    aliases.push(alias)
    text = mention.draft
  }
}
