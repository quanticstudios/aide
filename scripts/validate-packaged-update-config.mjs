import { createPublicKey } from 'node:crypto'

import {
  validateTrustedHealthEndpoint,
  validateTrustedUpdateOrigin,
} from '../src/shared/trusted-update-url.mjs'

const keyId = process.env.AIDE_RELEASE_KEY_ID
const publicKeyPem = process.env.AIDE_RELEASE_PUBLIC_KEY_PEM
const origin = validateTrustedUpdateOrigin(process.env.AIDE_UPDATE_ORIGIN)
const healthEndpoint = validateTrustedHealthEndpoint(
  process.env.AIDE_UPDATE_HEALTH_ENDPOINT,
)

if (process.env.AIDE_OTA_DRILL_BUILD) {
  console.error('Tagged releases must not enable the OTA drill build policy.')
  process.exit(1)
}

if (
  !origin ||
  !healthEndpoint ||
  !keyId ||
  !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(keyId) ||
  keyId.includes('dev') ||
  !publicKeyPem ||
  publicKeyPem.length > 8_192 ||
  !/^-----BEGIN PUBLIC KEY-----\n(?:[A-Za-z0-9+/]{1,64}={0,2}\n)+-----END PUBLIC KEY-----\n?$/.test(
    publicKeyPem,
  )
) {
  console.error(
    'Tagged releases require protected custom HTTPS update, health, and non-development public-key inputs.',
  )
  process.exit(1)
}

try {
  if (createPublicKey(publicKeyPem).asymmetricKeyType !== 'ed25519') throw null
} catch {
  console.error('Tagged releases require a valid Ed25519 public key.')
  process.exit(1)
}
