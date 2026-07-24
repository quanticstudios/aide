import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  publishRelease,
  rebindManifestSources,
} from './publish-ota-release.mjs'

function digest(value, algorithm) {
  return createHash(algorithm).update(value).digest('hex')
}

async function* stream(value, chunks = [value]) {
  for (const chunk of chunks) yield chunk
}

function fakeStorage({ readResponse } = {}) {
  const objects = new Map()
  const calls = []
  return {
    calls,
    objects,
    async exists(key) {
      calls.push(`exists:${key}`)
      return objects.has(key)
    },
    async put(key, source, options) {
      calls.push(`put:${key}:${options.cacheControl}`)
      if (objects.has(key) && !options.overwrite)
        throw new Error(`Object already exists: ${key}`)
      objects.set(key, await readFile(source))
    },
    async read(key, expected) {
      calls.push(`read:${key}`)
      const value = objects.get(key)
      if (!value) return undefined
      return (
        readResponse?.({ expected, key, value }) ?? {
          body: stream(value),
          contentLength: String(value.length),
        }
      )
    },
  }
}

async function promotionFixture(directory) {
  const artifact = join(directory, 'Aide.AppImage')
  const metadata = join(directory, 'latest-linux.yml')
  const envelope = join(directory, 'envelope.json')
  const signature = join(directory, 'envelope.sig')
  const audit = join(directory, 'audit.json')
  await writeFile(artifact, 'artifact')
  await writeFile(metadata, 'metadata')
  await writeFile(audit, 'audit')
  const manifest = {
    assets: [
      {
        key: 'releases/v1.2.3/linux/x64/Aide.AppImage',
        kind: 'ota',
        sha256: digest('artifact', 'sha256'),
        sha512: digest('artifact', 'sha512'),
        size: 8,
        source: artifact,
      },
    ],
    metadata: [
      {
        key: 'releases/v1.2.3/linux/x64/latest-linux.yml',
        kind: 'metadata',
        sha256: digest('metadata', 'sha256'),
        sha512: digest('metadata', 'sha512'),
        size: 8,
        source: metadata,
      },
    ],
    audit: [
      {
        key: 'releases/v1.2.3/audit/audit.json',
        kind: 'audit',
        sha256: digest('audit', 'sha256'),
        sha512: digest('audit', 'sha512'),
        size: 5,
        source: audit,
      },
    ],
    schemaVersion: 1,
    version: '1.2.3',
  }
  await writeFile(
    envelope,
    JSON.stringify({
      arch: 'x64',
      artifact: {
        sha256: manifest.assets[0].sha256,
        sha512: manifest.assets[0].sha512,
        size: 8,
        url: 'https://updates.aide.example/releases/v1.2.3/linux/x64/Aide.AppImage',
      },
      feed: {
        sha256: manifest.metadata[0].sha256,
        url: 'https://updates.aide.example/releases/v1.2.3/linux/x64/latest-linux.yml',
      },
      platform: 'linux',
      version: '1.2.3',
    }),
  )
  await writeFile(signature, 'signature')
  const manifestSource = join(directory, 'release-manifest.json')
  await writeFile(manifestSource, JSON.stringify(manifest))
  return { envelope, manifest, manifestSource, signature }
}

test('uploads immutable release objects, verifies readback, then commits channel last', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-publish-'))
  try {
    const { envelope, manifest, manifestSource, signature } =
      await promotionFixture(directory)
    const storage = fakeStorage()

    await publishRelease({
      manifest,
      manifestSource,
      origin: 'https://updates.aide.example',
      promotions: [{ arch: 'x64', envelope, platform: 'linux', signature }],
      storage,
      verifyPromotion: async () => undefined,
    })

    const envelopePut = storage.calls.findIndex((call) =>
      call.includes('channels/stable/'),
    )
    const artifactRead = storage.calls.findIndex((call) =>
      call.startsWith('read:releases/'),
    )
    assert.ok(artifactRead >= 0)
    assert.ok(envelopePut > artifactRead)
    assert.match(
      storage.calls.at(-1),
      /channels\/stable\/linux\/x64\/release-envelope\.json/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('refuses overwrite, invalid origin, unsigned input, and mismatched signed records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-publish-'))
  try {
    const { envelope, manifest, manifestSource, signature } =
      await promotionFixture(directory)
    await writeFile(signature, '')
    const storage = fakeStorage()
    storage.objects.set(
      'releases/v1.2.3/linux/x64/Aide.AppImage',
      Buffer.from('old'),
    )
    const base = {
      manifest,
      manifestSource,
      promotions: [{ arch: 'x64', envelope, platform: 'linux', signature }],
      storage,
      verifyPromotion: async () => undefined,
    }
    await assert.rejects(
      () => publishRelease({ ...base, origin: 'https://aide.r2.dev' }),
      /HTTPS custom origin/,
    )
    await assert.rejects(
      () => publishRelease({ ...base, origin: 'https://updates.aide.example' }),
      /signature is empty/,
    )
    await writeFile(signature, 'signature')
    await assert.rejects(
      () => publishRelease({ ...base, origin: 'https://updates.aide.example' }),
      /already exists/,
    )
    storage.objects.clear()
    await writeFile(envelope, JSON.stringify({ version: '9.9.9' }))
    await assert.rejects(
      () => publishRelease({ ...base, origin: 'https://updates.aide.example' }),
      /does not match immutable/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('rebinding collector paths cannot escape the downloaded bundle or collide', () => {
  const manifest = {
    assets: [{ source: '../../outside/Aide.AppImage' }],
    audit: [],
    metadata: [{ source: '/expired/runner/latest-linux.yml' }],
  }
  const rebound = rebindManifestSources(manifest, '/safe/release-bundle')
  assert.deepEqual(
    rebound.assets.map(({ source }) => source),
    ['/safe/release-bundle/Aide.AppImage'],
  )
  assert.deepEqual(
    rebound.metadata.map(({ source }) => source),
    ['/safe/release-bundle/latest-linux.yml'],
  )
  assert.throws(
    () =>
      rebindManifestSources(
        {
          assets: [{ source: '/one/Aide.AppImage' }],
          audit: [],
          metadata: [{ source: '/two/Aide.AppImage' }],
        },
        '/safe/release-bundle',
      ),
    /must not collide/,
  )
})

test('rejects a mismatched channel readback and bounded provider responses', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-publish-'))
  try {
    const { envelope, manifest, manifestSource, signature } =
      await promotionFixture(directory)
    const promotion = [{ arch: 'x64', envelope, platform: 'linux', signature }]
    await assert.rejects(
      () =>
        publishRelease({
          manifest,
          manifestSource,
          origin: 'https://updates.aide.example',
          promotions: promotion,
          storage: fakeStorage({
            readResponse: ({ expected, key, value }) => ({
              body: stream(
                key.includes('channels/') ? Buffer.from('corrupted') : value,
              ),
              contentLength: String(expected.size),
            }),
          }),
          verifyPromotion: async () => undefined,
        }),
      /verification failed: channels\/stable\/linux\/x64\/release-envelope\.sig/,
    )
    await assert.rejects(
      () =>
        publishRelease({
          manifest,
          manifestSource,
          origin: 'https://updates.aide.example',
          promotions: promotion,
          storage: fakeStorage({
            readResponse: ({ value }) => ({
              body: stream(value, [value, Buffer.from('overrun')]),
              contentLength: String(value.length),
            }),
          }),
          verifyPromotion: async () => undefined,
        }),
      /exceeds its expected size/,
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
