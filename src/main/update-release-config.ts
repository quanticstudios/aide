import { createPublicKey } from 'node:crypto'

import type { UpdateReleaseOptions } from './update-manager'
import { validateTrustedUpdateOrigin } from '../shared/trusted-update-url.mjs'

declare const __AIDE_UPDATE_ORIGIN__: string | undefined
declare const __AIDE_RELEASE_KEY_ID__: string | undefined
declare const __AIDE_RELEASE_PUBLIC_KEY_PEM__: string | undefined
declare const __AIDE_OTA_DRILL_BUILD__: string | undefined

export interface PackagedUpdateConfiguration {
  keyId: string
  origin: string
  publicKeyPem: string
}

const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const publicPemPattern =
  /^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{1,64}={0,2}\n)+-----END PUBLIC KEY-----\n?$/

/**
 * Parses only public, package-time values.  This is deliberately separate
 * from process.env: a packaged application must not accept an updater trust
 * redirect from its launch environment.
 */
export function parsePackagedUpdateConfiguration(
  input: Partial<PackagedUpdateConfiguration>,
  options: { allowLoopback?: boolean } = {},
): PackagedUpdateConfiguration | null {
  const origin = validateTrustedUpdateOrigin(input.origin, options)
  const keyId = input.keyId
  const publicKeyPem = input.publicKeyPem
  if (
    !origin ||
    typeof keyId !== 'string' ||
    !keyIdPattern.test(keyId) ||
    keyId.includes('dev') ||
    typeof publicKeyPem !== 'string' ||
    publicKeyPem.length > 8_192 ||
    !publicPemPattern.test(publicKeyPem)
  ) {
    return null
  }
  try {
    if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519')
      return null
  } catch {
    return null
  }
  return { keyId, origin, publicKeyPem }
}

export function configuredUpdateRelease(): UpdateReleaseOptions | null {
  const drillBuild = __AIDE_OTA_DRILL_BUILD__ === '1'
  const configuration = parsePackagedUpdateConfiguration(
    {
      keyId:
        typeof __AIDE_RELEASE_KEY_ID__ === 'string'
          ? __AIDE_RELEASE_KEY_ID__
          : undefined,
      origin:
        typeof __AIDE_UPDATE_ORIGIN__ === 'string'
          ? __AIDE_UPDATE_ORIGIN__
          : undefined,
      publicKeyPem:
        typeof __AIDE_RELEASE_PUBLIC_KEY_PEM__ === 'string'
          ? __AIDE_RELEASE_PUBLIC_KEY_PEM__
          : undefined,
    },
    { allowLoopback: drillBuild },
  )
  return configuration
    ? {
        keyring: { [configuration.keyId]: configuration.publicKeyPem },
        origin: configuration.origin,
        allowLoopbackDrillOrigin: drillBuild,
      }
    : null
}
