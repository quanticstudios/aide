import type { ManagedSessionSnapshot } from './managed-session'

/** A prompt's first non-blank line as plain text, with markdown syntax and runs of whitespace removed. */
export function plainPromptLine(prompt: string): string {
  const line =
    prompt
      .split('\n')
      .map((candidate) => candidate.trim())
      .find(Boolean) ?? ''
  return line
    .replace(/^(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|~~)(.+?)\1/g, '$2')
    .replace(/(^|[^\w*])[*_](\S(?:.*?\S)?)[*_](?![\w*])/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A chat's first prompt as a plain one-line title, or null before the first prompt. */
export function chatTitle(
  snapshot: Pick<ManagedSessionSnapshot, 'content'>,
): string | null {
  const prompt = snapshot.content.find(
    (item) => item.kind === 'user-prompt',
  )?.text
  return (prompt && plainPromptLine(prompt)) || null
}
