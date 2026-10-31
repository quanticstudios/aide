/** What the page shows, read from the URL hash so the phone's Back button returns to the list. */
export type PhoneRoute =
  | { readonly kind: 'list' }
  | { readonly kind: 'new' }
  | { readonly kind: 'session'; readonly sessionId: string }

export function parsePhoneRoute(hash: string): PhoneRoute {
  if (hash === '#/new') return { kind: 'new' }
  const sessionId = /^#\/s\/(.+)$/.exec(hash)?.[1]
  return sessionId
    ? { kind: 'session', sessionId: decodeURIComponent(sessionId) }
    : { kind: 'list' }
}

export function sessionHash(sessionId: string): string {
  return `#/s/${encodeURIComponent(sessionId)}`
}
