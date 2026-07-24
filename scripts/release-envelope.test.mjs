import { execFile as executeFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

import { expect, test } from 'vitest'

const execFile = promisify(executeFile)
const root = resolve(import.meta.dirname, '..')

function inputEnvelope() {
  return {
    arch: 'x64',
    artifact: {
      sha256: 'a'.repeat(64),
      sha512: 'b'.repeat(128),
      size: 42,
      url: 'https://updates.example.test/releases/v0.2.1/Aide.AppImage',
    },
    channel: 'stable',
    feed: {
      sha256: 'c'.repeat(64),
      url: 'https://updates.example.test/releases/v0.2.1/latest-linux.yml',
    },
    keyId: 'offline-test-key',
    platform: 'linux',
    productId: 'studio.quantic.aide',
    publishedAt: '2026-07-24T00:00:00.000Z',
    revokedVersions: [],
    rolloutPercentage: 100,
    schemaVersion: 1,
    urgency: 'normal',
    version: '0.2.1',
  }
}

test('creates, signs, and verifies a canonical envelope using an external private PEM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-release-script-'))
  const input = join(directory, 'input.json')
  const envelope = join(directory, 'envelope.json')
  const signature = join(directory, 'envelope.sig')
  const privateKey = join(directory, 'private.pem')
  const publicKey = join(directory, 'public.pem')
  const keys = generateKeyPairSync('ed25519')

  await Promise.all([
    writeFile(input, JSON.stringify({ version: '0.2.1', ...inputEnvelope() })),
    writeFile(
      privateKey,
      keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ),
    writeFile(
      publicKey,
      keys.publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    ),
  ])

  await execFile(
    'bun',
    [
      'scripts/create-release-envelope.ts',
      '--input',
      input,
      '--output',
      envelope,
    ],
    { cwd: root },
  )
  await execFile(
    'bun',
    [
      'scripts/sign-release-envelope.ts',
      '--envelope',
      envelope,
      '--private-key',
      privateKey,
      '--signature',
      signature,
    ],
    { cwd: root },
  )
  const verification = await execFile(
    'bun',
    [
      'scripts/verify-release-envelope.ts',
      '--envelope',
      envelope,
      '--signature',
      signature,
      '--public-key',
      publicKey,
      '--key-id',
      'offline-test-key',
    ],
    { cwd: root },
  )

  expect(verification.stdout).toMatch(/Verified release envelope 0\.2\.1/)
  expect((await readFile(signature)).byteLength).toBe(64)
  expect(
    (await readdir(directory)).some((name) => name.includes('.tmp-')),
  ).toBe(false)
})

test('never signs a noncanonical envelope', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-release-script-'))
  const envelope = join(directory, 'envelope.json')
  const privateKey = join(directory, 'private.pem')
  const signature = join(directory, 'envelope.sig')
  const keys = generateKeyPairSync('ed25519')

  await Promise.all([
    writeFile(envelope, `${JSON.stringify(inputEnvelope(), null, 2)}\n`),
    writeFile(
      privateKey,
      keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ),
  ])

  await expect(
    execFile(
      'bun',
      [
        'scripts/sign-release-envelope.ts',
        '--envelope',
        envelope,
        '--private-key',
        privateKey,
        '--signature',
        signature,
      ],
      { cwd: root },
    ),
  ).rejects.toThrow(/Envelope must be canonical/)
})

test('refuses signature path collisions without modifying either input', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-release-script-'))
  const envelope = join(directory, 'envelope.json')
  const privateKey = join(directory, 'private.pem')
  const keys = generateKeyPairSync('ed25519')
  const privatePem = keys.privateKey
    .export({ format: 'pem', type: 'pkcs8' })
    .toString()
  const rawEnvelope = JSON.stringify(inputEnvelope())

  await Promise.all([
    writeFile(envelope, rawEnvelope),
    writeFile(privateKey, privatePem),
  ])

  for (const signature of [envelope, privateKey]) {
    await expect(
      execFile(
        'bun',
        [
          'scripts/sign-release-envelope.ts',
          '--envelope',
          envelope,
          '--private-key',
          privateKey,
          '--signature',
          signature,
        ],
        { cwd: root },
      ),
    ).rejects.toThrow(/collide/i)
  }

  expect(await readFile(envelope, 'utf8')).toBe(rawEnvelope)
  expect(await readFile(privateKey, 'utf8')).toBe(privatePem)
})

test('publishes signatures without clobbering an existing output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-release-script-'))
  const input = join(directory, 'input.json')
  const envelope = join(directory, 'envelope.json')
  const privateKey = join(directory, 'private.pem')
  const signature = join(directory, 'envelope.sig')
  const keys = generateKeyPairSync('ed25519')

  await Promise.all([
    writeFile(input, JSON.stringify(inputEnvelope())),
    writeFile(
      privateKey,
      keys.privateKey.export({ format: 'pem', type: 'pkcs8' }).toString(),
    ),
    writeFile(signature, 'existing signature'),
  ])
  await execFile(
    'bun',
    [
      'scripts/create-release-envelope.ts',
      '--input',
      input,
      '--output',
      envelope,
    ],
    { cwd: root },
  )

  await expect(
    execFile(
      'bun',
      [
        'scripts/sign-release-envelope.ts',
        '--envelope',
        envelope,
        '--private-key',
        privateKey,
        '--signature',
        signature,
      ],
      { cwd: root },
    ),
  ).rejects.toThrow(/already exists/i)
  expect(await readFile(signature, 'utf8')).toBe('existing signature')
})
