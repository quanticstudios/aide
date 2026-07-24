const INGEST_PATH = '/v1/ota-health/events'

function normalizeHostname(hostname) {
  const normalized = hostname.toLowerCase()
  return normalized.endsWith('.') ? null : normalized
}

function isProviderDefaultHostname(hostname) {
  return (
    hostname === 'workers.dev' ||
    hostname.endsWith('.workers.dev') ||
    hostname === 'r2.dev' ||
    hostname.endsWith('.r2.dev')
  )
}

export function validateUpdateHealthEndpoint(endpoint) {
  if (!endpoint || endpoint.length > 2_048) return null
  try {
    const url = new URL(endpoint)
    const hostname = normalizeHostname(url.hostname)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== INGEST_PATH ||
      !hostname ||
      isProviderDefaultHostname(hostname)
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}
