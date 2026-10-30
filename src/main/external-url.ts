const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isAllowedExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !URL.canParse(url)) return false
  return ALLOWED_PROTOCOLS.has(new URL(url).protocol)
}

/** Opens http, https and mailto URLs in the system handler; refuses and logs anything else. */
export function openAllowedExternalUrl(
  url: unknown,
  openExternal: (url: string) => Promise<void>,
): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    console.warn('Refused to open external URL', String(url).slice(0, 200))
    return Promise.resolve()
  }
  return openExternal(url)
}
