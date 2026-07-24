import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import test from 'node:test'

import {
  validateTrustedHealthEndpoint,
  validateTrustedUpdateOrigin,
} from '../src/shared/trusted-update-url.mjs'

test('shared trusted URL policy rejects provider defaults, loopback, and trailing dots', () => {
  assert.equal(
    validateTrustedUpdateOrigin('https://updates.example.com'),
    'https://updates.example.com',
  )
  assert.equal(
    validateTrustedHealthEndpoint(
      'https://health.example.com/v1/ota-health/events',
    ),
    'https://health.example.com/v1/ota-health/events',
  )
  for (const hostname of [
    'r2.dev',
    'bucket.r2.dev',
    'bucket.r2.dev.',
    'workers.dev',
    'tenant.workers.dev',
    'tenant.workers.dev.',
    'localhost',
    '127.0.0.1',
    '[::1]',
    '192.168.1.2',
    '10.2.3.4',
    '172.18.0.1',
    '169.254.0.1',
    '198.51.100.3',
    '[fd00::1]',
    '[fe80::1]',
    '[::ffff:127.0.0.1]',
  ]) {
    assert.equal(validateTrustedUpdateOrigin(`https://${hostname}`), null)
    assert.equal(
      validateTrustedHealthEndpoint(`https://${hostname}/v1/ota-health/events`),
      null,
    )
  }
})

test('package validation accepts a public Ed25519 key without printing it', () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const publicKeyPem = publicKey.export({ format: 'pem', type: 'spki' })
  const child = spawnSync(
    'node',
    ['scripts/validate-packaged-update-config.mjs'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        AIDE_RELEASE_KEY_ID: 'aide-release-2026-07',
        AIDE_RELEASE_PUBLIC_KEY_PEM: publicKeyPem,
        AIDE_UPDATE_HEALTH_ENDPOINT:
          'https://health.example.com/v1/ota-health/events',
        AIDE_UPDATE_ORIGIN: 'https://updates.example.com',
      },
    },
  )
  assert.equal(child.status, 0, child.stderr)
  assert.doesNotMatch(child.stdout, /PUBLIC KEY/)
})

test('package validation rejects the drill flag even with otherwise valid inputs', () => {
  const { publicKey } = generateKeyPairSync('ed25519')
  const child = spawnSync(
    'node',
    ['scripts/validate-packaged-update-config.mjs'],
    {
      cwd: new URL('..', import.meta.url),
      encoding: 'utf8',
      env: {
        ...process.env,
        AIDE_OTA_DRILL_BUILD: '1',
        AIDE_RELEASE_KEY_ID: 'aide-release-2026-07',
        AIDE_RELEASE_PUBLIC_KEY_PEM: publicKey
          .export({ format: 'pem', type: 'spki' })
          .toString(),
        AIDE_UPDATE_HEALTH_ENDPOINT:
          'https://health.example.com/v1/ota-health/events',
        AIDE_UPDATE_ORIGIN: 'https://updates.example.com',
      },
    },
  )
  assert.equal(child.status, 1)
  assert.match(child.stderr, /must not enable the OTA drill build policy/)
})
