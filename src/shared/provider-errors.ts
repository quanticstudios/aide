import type { ManagedSessionErrorKind } from './managed-session'

const ERROR_KIND_PATTERNS: [ManagedSessionErrorKind, RegExp][] = [
  [
    'executable',
    /configured executable|\bspawn \S+ ENOENT\b|executable not found|native binary not found/i,
  ],
  [
    'auth',
    /not logged in|please run \/login|\blog ?in again\b|invalid api key|authentication_failed|authentication failed|\b401\b|unauthorized|oauth token (?:has )?expired|codex login/i,
  ],
  [
    'network',
    /\bECONNREFUSED\b|\bECONNRESET\b|\bENOTFOUND\b|\bEAI_AGAIN\b|\bETIMEDOUT\b|connection error|connection refused|fetch failed|error sending request|stream disconnected|network (?:error|is unreachable)|could not resolve host/i,
  ],
]

/**
 * Names the fix a provider error needs from its message, or null when there is no known one.
 * @remarks shortcut: matches CLI and SDK error text, since neither sends a structured auth or spawn code to aide; switch to codes once the daemon reports them.
 */
export function classifyProviderError(
  message: string | null | undefined,
): ManagedSessionErrorKind | null {
  if (!message) return null
  return (
    ERROR_KIND_PATTERNS.find(([, pattern]) => pattern.test(message))?.[0] ??
    null
  )
}
