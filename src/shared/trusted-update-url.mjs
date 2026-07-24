/**
 * The small shared URL policy used by the release assembler, package-time
 * configuration and the desktop client.  Provider-default hostnames are not
 * an ownership boundary, and production OTA must never target a loopback
 * address (including the less obvious IPv6 spelling).
 */
import { isIP } from 'node:net'

const blockedSuffixes = ['r2.dev', 'workers.dev']

export function normalizedPublicHostname(hostname) {
  const normalized = hostname.toLowerCase()
  if (!normalized || normalized.endsWith('.')) return null
  const withoutBrackets = normalized.replace(/^\[(.*)\]$/, '$1')
  if (
    // An owned OTA endpoint must be a DNS name. This intentionally rejects
    // every literal address, not merely the common private ranges: accepting a
    // newly allocated or IPv4-mapped address would turn DNS ownership checks
    // into a launch-time network redirect.
    isIP(withoutBrackets) !== 0 ||
    normalized === 'localhost' ||
    normalized === '::1' ||
    normalized === '127.0.0.1' ||
    normalized === '0.0.0.0' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  ) {
    return null
  }
  if (
    blockedSuffixes.some(
      (suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`),
    )
  ) {
    return null
  }
  return normalized
}

function isLoopbackHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[(.*)\]$/, '$1')
  return normalized === '127.0.0.1'
}

/** Returns a canonical owned HTTPS origin or null. */
export function validateTrustedUpdateOrigin(value, options = {}) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048)
    return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/' ||
      (!normalizedPublicHostname(url.hostname) &&
        !(options.allowLoopback === true && isLoopbackHostname(url.hostname)))
    ) {
      return null
    }
    return url.origin
  } catch {
    return null
  }
}

/** Returns a canonical owned HTTPS health ingestion endpoint or null. */
export function validateTrustedHealthEndpoint(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 2_048)
    return null
  try {
    const url = new URL(value)
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== '/v1/ota-health/events' ||
      !normalizedPublicHostname(url.hostname)
    ) {
      return null
    }
    return url.href
  } catch {
    return null
  }
}
