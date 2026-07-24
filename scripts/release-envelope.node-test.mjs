import assert from 'node:assert/strict'
import { execFile as executeFile } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

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

  assert.match(verification.stdout, /Verified release envelope 0\.2\.1/)
  assert.equal((await readFile(signature)).byteLength, 64)
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

  await assert.rejects(
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
    /Envelope must be canonical/,
  )
})
