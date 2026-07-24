import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { parsePackagedUpdateConfiguration } from './update-release-config'

const keyPair = generateKeyPairSync('ed25519')
const publicKeyPem = keyPair.publicKey
  .export({
    format: 'pem',
    type: 'spki',
  })
  .toString()

describe('parsePackagedUpdateConfiguration', () => {
  it('accepts only a custom HTTPS origin and a non-development Ed25519 key', () => {
    expect(
      parsePackagedUpdateConfiguration({
        keyId: 'aide-release-2026-07',
        origin: 'https://updates.example.com',
        publicKeyPem,
      }),
    ).toEqual({
      keyId: 'aide-release-2026-07',
      origin: 'https://updates.example.com',
      publicKeyPem,
    })
  })

  it.each([
    'https://updates.r2.dev',
    'https://updates.r2.dev.',
    'https://tenant.workers.dev',
    'https://tenant.workers.dev.',
    'https://localhost',
    'https://127.0.0.1',
    'https://[::1]',
    'https://192.168.1.1',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://169.254.1.1',
    'https://0.0.0.0',
    'https://198.51.100.1',
    'https://[fd00::1]',
    'https://[fe80::1]',
    'https://[::ffff:127.0.0.1]',
    'http://updates.example.com',
  ])('rejects an untrusted origin: %s', (origin) => {
    expect(
      parsePackagedUpdateConfiguration({
        keyId: 'aide-release-2026-07',
        origin,
        publicKeyPem,
      }),
    ).toBeNull()
  })

  it('allows only the explicit loopback drill policy', () => {
    const input = {
      keyId: 'aide-release-2026-07',
      origin: 'https://127.0.0.1:4567',
      publicKeyPem,
    }
    expect(parsePackagedUpdateConfiguration(input)).toBeNull()
    expect(
      parsePackagedUpdateConfiguration(input, { allowLoopback: true }),
    ).toMatchObject({ origin: input.origin })
  })

  it('rejects development ids and non-Ed25519 keys', () => {
    const rsaKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ format: 'pem', type: 'spki' })
      .toString()
    expect(
      parsePackagedUpdateConfiguration({
        keyId: 'aide-release-dev-2026',
        origin: 'https://updates.example.com',
        publicKeyPem,
      }),
    ).toBeNull()
    expect(
      parsePackagedUpdateConfiguration({
        keyId: 'aide-release-2026-07',
        origin: 'https://updates.example.com',
        publicKeyPem: keyPair.privateKey
          .export({ format: 'pem', type: 'pkcs8' })
          .toString(),
      }),
    ).toBeNull()
    expect(
      parsePackagedUpdateConfiguration({
        keyId: 'aide-release-2026-07',
        origin: 'https://updates.example.com',
        publicKeyPem: rsaKey,
      }),
    ).toBeNull()
  })
})
