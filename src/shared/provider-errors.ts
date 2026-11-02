import type {
  ManagedSessionErrorKind,
  ManagedSessionSnapshot,
} from './managed-session'

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

/** The error a chat's banner shows: its last error, unless it only reports the turn the user stopped. */
export function threadError(
  snapshot: Pick<
    ManagedSessionSnapshot,
    'lastError' | 'lastErrorAt' | 'lastErrorKind' | 'turns'
  > | null,
): { kind: ManagedSessionErrorKind | null; message: string } | null {
  if (!snapshot?.lastError) return null
  const last = snapshot.turns.at(-1)
  // why: pitwall reports a stopped turn as a lastError stamped with the turn's end, which is no failure.
  if (
    (last?.state === 'interrupted' || last?.state === 'cancelled') &&
    last.completedAt === snapshot.lastErrorAt
  ) {
    return null
  }
  return {
    kind: snapshot.lastErrorKind ?? classifyProviderError(snapshot.lastError),
    message: snapshot.lastError,
  }
}
