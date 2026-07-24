import { createPublicKey } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import {
  AIDE_RELEASE_KEYRING_VERSION,
  AIDE_RELEASE_PUBLIC_KEYRING,
} from './release-keyring'

describe('AIDE_RELEASE_PUBLIC_KEYRING', () => {
  it('contains only valid Ed25519 public keys', () => {
    expect(AIDE_RELEASE_KEYRING_VERSION).toBe(1)
    expect(Object.keys(AIDE_RELEASE_PUBLIC_KEYRING)).not.toHaveLength(0)

    for (const [keyId, pem] of Object.entries(AIDE_RELEASE_PUBLIC_KEYRING)) {
      expect(keyId).toMatch(/^[a-z0-9][a-z0-9._-]{0,63}$/)
      expect(createPublicKey(pem).asymmetricKeyType).toBe('ed25519')
    }
  })
})
