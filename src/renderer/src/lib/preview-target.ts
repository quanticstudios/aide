export function isAllowedPreviewUrl(value: string): boolean {
  try {
    const url = new URL(value)

    if (!['http:', 'https:'].includes(url.protocol)) {
      return false
    }

    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

export function normalizePreviewUrl(value: string): string {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return 'http://127.0.0.1:4173'
  }

  if (/^https?:\/\//.test(trimmedValue)) {
    return trimmedValue
  }

  return `http://${trimmedValue}`
}
