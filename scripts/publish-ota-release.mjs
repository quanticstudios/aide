import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import {
  assertProductionOrigin,
  assertStableVersion,
} from './release-assembly.mjs'

async function hashes(file) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  let size = 0
  for await (const chunk of createReadStream(file)) {
    size += chunk.length
    sha256.update(chunk)
    sha512.update(chunk)
  }
  return { sha256: sha256.digest('hex'), sha512: sha512.digest('hex'), size }
}

function assertManifest(manifest) {
  if (
    manifest?.schemaVersion !== 1 ||
    !Array.isArray(manifest.assets) ||
    !Array.isArray(manifest.metadata) ||
    !Array.isArray(manifest.audit)
  ) {
    throw new Error('Release manifest is malformed.')
  }
  assertStableVersion(manifest.version)
  const auditPrefix = `releases/v${manifest.version}/audit/`
  for (const entry of manifest.audit) {
    if (entry?.kind !== 'audit' || !entry.key?.startsWith(auditPrefix)) {
      throw new Error('Release manifest contains an unsafe audit object.')
    }
  }
  for (const entry of [
    ...manifest.assets,
    ...manifest.metadata,
    ...manifest.audit,
  ]) {
    if (
      !entry ||
      typeof entry.key !== 'string' ||
      !entry.key.startsWith(`releases/v${manifest.version}/`) ||
      entry.key.includes('..') ||
      typeof entry.source !== 'string' ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !/^[a-f0-9]{128}$/.test(entry.sha512) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1
    ) {
      throw new Error('Release manifest contains an unsafe object.')
    }
  }
}

export function rebindManifestSources(manifest, directory) {
  const entries = [...manifest.assets, ...manifest.metadata, ...manifest.audit]
  const names = entries.map((entry) => basename(entry.source))
  if (names.some((name) => !name || name === '.' || name === '..')) {
    throw new Error(
      'Release manifest contains an invalid artifact source path.',
    )
  }
  if (new Set(names).size !== names.length) {
    throw new Error('Release manifest source filenames must not collide.')
  }
  const rebind = (entry) => ({
    ...entry,
    source: resolve(directory, basename(entry.source)),
  })
  return {
    ...manifest,
    assets: manifest.assets.map(rebind),
    metadata: manifest.metadata.map(rebind),
    audit: manifest.audit.map(rebind),
  }
}

async function verifyReadback(response, expected, key) {
  if (!response?.body) {
    throw new Error(`Published object is not readable: ${key}`)
  }
  const contentLength = Number(response.contentLength)
  if (
    !Number.isSafeInteger(contentLength) ||
    contentLength < 1 ||
    contentLength !== expected.size
  ) {
    throw new Error(`Published object has an invalid Content-Length: ${key}`)
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  let size = 0
  for await (const chunk of response.body) {
    size += chunk.length
    if (size > expected.size) {
      throw new Error(`Published object exceeds its expected size: ${key}`)
    }
    sha256.update(chunk)
    sha512.update(chunk)
  }
  const actual = {
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('hex'),
    size,
  }
  if (
    size !== expected.size ||
    actual.sha256 !== expected.sha256 ||
    actual.sha512 !== expected.sha512
  ) {
    throw new Error(`Published object verification failed: ${key}`)
  }
}

function assertPromotion({ envelope, signature, platform, arch }) {
  if (!envelope || !signature)
    throw new Error('Signed promotion envelope and signature are required.')
  if (
    !['linux', 'darwin'].includes(platform) ||
    !['x64', 'arm64'].includes(arch)
  ) {
    throw new Error('Promotion target is invalid.')
  }
  return Promise.all([
    access(envelope),
    access(signature),
    readFile(signature),
  ]).then(([, , contents]) => {
    if (contents.length === 0) throw new Error('Promotion signature is empty.')
  })
}

export async function assertPromotionMatchesManifest({
  envelope,
  manifest,
  origin,
  platform,
  arch,
}) {
  const promotion = JSON.parse(await readFile(envelope, 'utf8'))
  const targetAssets = manifest.assets.filter(
    (entry) =>
      entry.kind === 'ota' &&
      entry.key.startsWith(
        `releases/v${manifest.version}/${platform}/${arch}/`,
      ) &&
      (entry.key.endsWith('.AppImage') || entry.key.endsWith('.zip')),
  )
  const artifact = targetAssets.at(0)
  const feed = manifest.metadata.find(
    (entry) =>
      entry.key ===
      (platform === 'linux'
        ? `releases/v${manifest.version}/linux/x64/latest-linux.yml`
        : `releases/v${manifest.version}/darwin/latest-mac.yml`),
  )
  if (
    !artifact ||
    !feed ||
    promotion.version !== manifest.version ||
    promotion.platform !== platform ||
    promotion.arch !== arch ||
    promotion.artifact?.url !== `${origin}/${artifact.key}` ||
    promotion.artifact?.sha256 !== artifact.sha256 ||
    promotion.artifact?.sha512 !== artifact.sha512 ||
    promotion.artifact?.size !== artifact.size ||
    promotion.feed?.url !== `${origin}/${feed.key}` ||
    promotion.feed?.sha256 !== feed.sha256
  ) {
    throw new Error(
      `Signed promotion record does not match immutable ${platform}/${arch} release inputs.`,
    )
  }
}

function channelKey({ platform, arch }, filename) {
  return `channels/stable/${platform}/${arch}/${filename}`
}

export async function publishRelease({
  manifestSource,
  manifest,
  origin,
  promotions,
  storage,
  verifyPromotion,
}) {
  const checkedOrigin = assertProductionOrigin(origin)
  assertManifest(manifest)
  if (!Array.isArray(promotions) || promotions.length === 0) {
    throw new Error('At least one signed promotion record is required.')
  }
  await Promise.all(promotions.map(assertPromotion))
  if (
    new Set(promotions.map(({ platform, arch }) => `${platform}/${arch}`))
      .size !== promotions.length
  ) {
    throw new Error('Promotion targets must be unique.')
  }
  if (typeof verifyPromotion !== 'function')
    throw new Error('A promotion signature verifier is required.')
  if (!manifestSource) {
    throw new Error(
      'The finalized release manifest is required for publication.',
    )
  }
  for (const promotion of promotions) {
    await verifyPromotion({ ...promotion, manifest, origin: checkedOrigin })
    await assertPromotionMatchesManifest({
      ...promotion,
      manifest,
      origin: checkedOrigin,
    })
  }
  const manifestHashes = await hashes(manifestSource)
  const immutable = [
    ...manifest.assets,
    ...manifest.metadata,
    ...manifest.audit,
    {
      key: `releases/v${manifest.version}/audit/release-manifest.json`,
      kind: 'audit',
      ...manifestHashes,
      source: manifestSource,
    },
  ]
  for (const entry of immutable) {
    const actual = await hashes(entry.source)
    if (
      actual.sha256 !== entry.sha256 ||
      actual.sha512 !== entry.sha512 ||
      actual.size !== entry.size
    ) {
      throw new Error(`Release bundle input verification failed: ${entry.key}`)
    }
    if (await storage.exists(entry.key))
      throw new Error(`Immutable release object already exists: ${entry.key}`)
  }
  for (const entry of immutable) {
    await storage.put(entry.key, entry.source, {
      cacheControl: 'public, max-age=31536000, immutable',
    })
    await verifyReadback(await storage.read(entry.key, entry), entry, entry.key)
  }
  // The signature is written first. The envelope is the channel's commit
  // point, so a reader never observes a fresh envelope with an old signature.
  const channelFiles = [
    ...promotions.map((promotion) => [
      channelKey(promotion, 'release-envelope.sig'),
      promotion.signature,
    ]),
    ...promotions.map((promotion) => [
      channelKey(promotion, 'release-envelope.json'),
      promotion.envelope,
    ]),
  ]
  for (const [key, source] of channelFiles) {
    const expected = await hashes(source)
    await storage.put(key, source, {
      cacheControl: 'no-store',
      overwrite: true,
    })
    await verifyReadback(await storage.read(key, expected), expected, key)
  }
}

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`)
  return value
}

async function run(command, argumentsList, environment = process.env) {
  const { spawn } = await import('node:child_process')
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, {
      env: environment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} failed with ${code}.`)),
    )
  })
}

function r2Storage({ bucket, endpoint, origin }) {
  if (
    !bucket ||
    !endpoint ||
    !process.env.AWS_ACCESS_KEY_ID ||
    !process.env.AWS_SECRET_ACCESS_KEY
  ) {
    throw new Error(
      'Temporary R2 AWS credentials, bucket, and endpoint are required.',
    )
  }
  const aws = (argumentsList) =>
    run('aws', [
      's3api',
      ...argumentsList,
      '--bucket',
      bucket,
      '--endpoint-url',
      endpoint,
      '--no-cli-pager',
    ])
  return {
    async exists(key) {
      try {
        await aws(['head-object', '--key', key])
        return true
      } catch {
        return false
      }
    },
    async put(key, source, { cacheControl, overwrite = false }) {
      const conditional = overwrite ? [] : ['--if-none-match', '*']
      await aws([
        'put-object',
        '--key',
        key,
        '--body',
        source,
        '--cache-control',
        cacheControl,
        ...conditional,
      ])
    },
    async read(key, expected) {
      const response = await fetch(`${origin}/${key}`, {
        cache: 'no-store',
        redirect: 'error',
      })
      if (response.status !== 200 || response.url !== `${origin}/${key}`) {
        throw new Error(`Published object is not readable: ${key}`)
      }
      const contentLength = response.headers.get('content-length')
      if (!response.body || !contentLength) {
        throw new Error(
          `Published object has an invalid Content-Length: ${key}`,
        )
      }
      if (Number(contentLength) !== expected.size) {
        throw new Error(
          `Published object has an invalid Content-Length: ${key}`,
        )
      }
      return { body: response.body, contentLength }
    },
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const manifestPath = resolve(argument('--manifest'))
  const publicKey = resolve(argument('--public-key'))
  const keyId = argument('--key-id')
  const origin = argument('--origin')
  const manifest = rebindManifestSources(
    JSON.parse(await readFile(manifestPath, 'utf8')),
    dirname(manifestPath),
  )
  const promotions = [
    ['linux', 'x64'],
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
  ].map(([platform, arch]) => ({
    arch,
    platform,
    envelope: resolve(argument(`--${platform}-${arch}-envelope`)),
    signature: resolve(argument(`--${platform}-${arch}-signature`)),
  }))
  const storage = r2Storage({
    bucket: process.env.R2_BUCKET,
    endpoint: process.env.R2_ENDPOINT,
    origin,
  })
  await publishRelease({
    manifestSource: manifestPath,
    manifest,
    origin,
    promotions,
    storage,
    verifyPromotion: async (promotion) => {
      await run('bun', [
        'scripts/verify-release-envelope.ts',
        '--envelope',
        promotion.envelope,
        '--signature',
        promotion.signature,
        '--public-key',
        publicKey,
        '--key-id',
        keyId,
      ])
    },
  })
}
