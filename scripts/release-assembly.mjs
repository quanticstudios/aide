import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { cp, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const sha512Base64 = /^[A-Za-z0-9+/]+={0,2}$/

export function assertProductionOrigin(origin) {
  let parsed
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error('AIDE_UPDATE_ORIGIN must be an HTTPS custom origin.')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/' ||
    parsed.hostname.endsWith('.r2.dev')
  ) {
    throw new Error('AIDE_UPDATE_ORIGIN must be an HTTPS custom origin.')
  }
  return parsed.origin
}

export function assertStableVersion(version) {
  if (typeof version !== 'string' || !stableVersion.test(version)) {
    throw new Error(
      'Release version must be stable SemVer without a prerelease.',
    )
  }
}

async function digests(file) {
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  for await (const chunk of createReadStream(file)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  const details = await stat(file)
  if (!details.isFile() || details.size < 1) {
    throw new Error(
      `Release artifact must be a non-empty regular file: ${file}`,
    )
  }
  const sha512Base64 = sha512.copy().digest('base64')
  return {
    sha256: sha256.digest('hex'),
    sha512: sha512.digest('hex'),
    sha512Base64,
    size: details.size,
  }
}

async function existingFile(directory, name) {
  const file = resolve(directory, name)
  try {
    const details = await stat(file)
    if (!details.isFile()) throw new Error('not a file')
    return file
  } catch {
    throw new Error(`Missing required release artifact: ${file}`)
  }
}

function metadataEntry(metadata, name) {
  const expression = new RegExp(
    `- url: ${escapeRegExp(name)}\\n\\s+sha512: ([^\\n]+)\\n\\s+size: (\\d+)`,
  )
  const match = expression.exec(metadata)
  if (!match || !sha512Base64.test(match[1])) {
    throw new Error(
      `Updater metadata does not describe the expected artifact ${name}.`,
    )
  }
  return { sha512: match[1], size: Number(match[2]) }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function verifyUpdaterMetadata(directory, metadataName, artifact) {
  const metadataPath = await existingFile(directory, metadataName)
  const metadata = await readFile(metadataPath, 'utf8')
  const entry = metadataEntry(metadata, basename(artifact))
  const artifactDigests = await digests(artifact)
  if (
    entry.size !== artifactDigests.size ||
    entry.sha512 !== artifactDigests.sha512Base64
  ) {
    throw new Error(
      `Updater metadata does not describe the expected artifact ${basename(artifact)}.`,
    )
  }
  return { metadata, metadataPath, artifactDigests }
}

function updaterYaml(version, entries) {
  const files = entries
    .map(({ blockMapSize, name, hashes }) =>
      [
        `  - url: ${name}`,
        `    sha512: ${hashes.sha512Base64}`,
        `    size: ${hashes.size}`,
        ...(blockMapSize === undefined
          ? []
          : [`    blockMapSize: ${blockMapSize}`]),
      ].join('\n'),
    )
    .join('\n')
  const primary = entries.at(-1)
  return [
    `version: ${version}`,
    'files:',
    files,
    `path: ${primary.name}`,
    `sha512: ${primary.hashes.sha512Base64}`,
    'releaseDate: 1970-01-01T00:00:00.000Z',
    '',
  ].join('\n')
}

async function copyOutput(source, outputDirectory, name) {
  const destination = resolve(outputDirectory, name)
  await cp(source, destination, { force: false })
  return destination
}

function asset(key, source, hashes, kind) {
  return {
    key,
    kind,
    sha256: hashes.sha256,
    sha512: hashes.sha512,
    size: hashes.size,
    // The bundle manifest is published as an audit record. Keep only a local
    // bundle-relative filename in it; Actions runner paths are neither stable
    // nor useful to a release verifier.
    source: basename(source),
  }
}

async function collectTarget({ directory, version, platform, arch }) {
  const suffix = platform === 'linux' ? 'linux-x64' : `mac-${arch}`
  const appName =
    platform === 'linux'
      ? `Aide-${version}-linux-x86_64.AppImage`
      : `Aide-${version}-${suffix}.zip`
  const primary = await existingFile(directory, appName)
  const metadataName =
    platform === 'linux' ? 'latest-linux.yml' : 'latest-mac.yml'
  const verified = await verifyUpdaterMetadata(directory, metadataName, primary)
  const primaryEntry = {
    name: basename(primary),
    source: primary,
    hashes: verified.artifactDigests,
    kind: 'ota',
  }
  const files = [primaryEntry]
  if (platform === 'darwin') {
    const blockmap = await existingFile(directory, `${appName}.blockmap`)
    primaryEntry.blockMapSize = (await stat(blockmap)).size
    files.push({
      name: basename(blockmap),
      source: blockmap,
      hashes: await digests(blockmap),
      kind: 'ota',
    })
  }
  const manualName =
    platform === 'linux'
      ? `Aide-${version}-linux-x64.tar.gz`
      : `Aide-${version}-${suffix}.dmg`
  const manual = await existingFile(directory, manualName)
  files.push({
    name: basename(manual),
    source: manual,
    hashes: await digests(manual),
    kind: 'manual',
  })
  return { files, metadata: verified.metadata, primary, primaryEntry }
}

/**
 * Collects only verified Actions artifacts into a deterministic publication bundle.
 * The returned manifest contains local source paths; do not publish it from an
 * untrusted checkout or before verifying the release tag separately.
 */
export async function collectReleaseBundle({
  commit,
  linuxDirectory,
  macArm64Directory,
  macX64Directory,
  outputDirectory,
  origin,
  version,
}) {
  assertStableVersion(version)
  const checkedOrigin = assertProductionOrigin(origin)
  if (!/^[a-f0-9]{40}$/.test(commit)) {
    throw new Error('Release commit must be a full lowercase SHA-1.')
  }
  await mkdir(outputDirectory, { recursive: true })
  if ((await readdir(outputDirectory)).length !== 0) {
    throw new Error('Release output directory must be empty.')
  }
  const linux = await collectTarget({
    directory: linuxDirectory,
    version,
    platform: 'linux',
    arch: 'x64',
  })
  const macArm64 = await collectTarget({
    directory: macArm64Directory,
    version,
    platform: 'darwin',
    arch: 'arm64',
  })
  const macX64 = await collectTarget({
    directory: macX64Directory,
    version,
    platform: 'darwin',
    arch: 'x64',
  })
  const targets = [macArm64, macX64, linux]
  const assets = []
  for (const target of targets) {
    for (const file of target.files) {
      const platform = file.name.includes('-linux-') ? 'linux' : 'darwin'
      const arch = file.name.includes('arm64') ? 'arm64' : 'x64'
      const prefix =
        file.kind === 'manual'
          ? `releases/v${version}/manual/${platform}/${arch}`
          : `releases/v${version}/${platform}/${arch}`
      const source = await copyOutput(file.source, outputDirectory, file.name)
      assets.push(
        asset(`${prefix}/${file.name}`, source, file.hashes, file.kind),
      )
    }
  }
  assets.sort((left, right) => left.key.localeCompare(right.key))
  const linuxMetadata = updaterYaml(version, [
    {
      name: basename(linux.primary),
      hashes: await digests(linux.primary),
    },
  ])
  const macMetadata = updaterYaml(version, [
    {
      name: basename(macArm64.primary),
      hashes: await digests(macArm64.primary),
      blockMapSize: macArm64.primaryEntry.blockMapSize,
    },
    {
      name: basename(macX64.primary),
      hashes: await digests(macX64.primary),
      blockMapSize: macX64.primaryEntry.blockMapSize,
    },
  ])
  const metadata = []
  for (const [name, contents, key] of [
    [
      'latest-linux.yml',
      linuxMetadata,
      `releases/v${version}/linux/x64/latest-linux.yml`,
    ],
    [
      'latest-mac.yml',
      macMetadata,
      `releases/v${version}/darwin/latest-mac.yml`,
    ],
  ]) {
    const source = resolve(outputDirectory, name)
    await writeFile(source, contents, { encoding: 'utf8', flag: 'wx' })
    const hashes = await digests(source)
    metadata.push(asset(key, source, hashes, 'metadata'))
  }
  const components = [...assets, ...metadata].map((entry) => ({
    type: 'file',
    name: entry.key,
    hashes: [
      { alg: 'SHA-256', content: entry.sha256 },
      { alg: 'SHA-512', content: entry.sha512 },
    ],
  }))
  const sbomSource = resolve(outputDirectory, 'sbom.cdx.json')
  await writeFile(
    sbomSource,
    `${JSON.stringify({ bomFormat: 'CycloneDX', components, specVersion: '1.6', version: 1 })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  )
  const provenanceSource = resolve(outputDirectory, 'provenance-input.json')
  await writeFile(
    provenanceSource,
    `${JSON.stringify({ commit, tag: `v${version}`, version })}\n`,
    { encoding: 'utf8', flag: 'wx' },
  )
  const audit = [
    asset(
      `releases/v${version}/audit/sbom.cdx.json`,
      sbomSource,
      await digests(sbomSource),
      'audit',
    ),
    asset(
      `releases/v${version}/audit/provenance-input.json`,
      provenanceSource,
      await digests(provenanceSource),
      'audit',
    ),
  ]
  const checksumsSource = resolve(outputDirectory, 'SHA256SUMS')
  const checksumEntries = [...assets, ...metadata, ...audit].sort(
    (left, right) => left.key.localeCompare(right.key),
  )
  await writeFile(
    checksumsSource,
    [
      '# SHA256 checksums for immutable release inputs and audit documents.',
      '# This file and release-manifest.json are excluded to avoid self-reference.',
      ...checksumEntries.map((entry) => `${entry.sha256}  ${entry.key}`),
      '',
    ].join('\n'),
    { encoding: 'utf8', flag: 'wx' },
  )
  audit.push(
    asset(
      `releases/v${version}/audit/SHA256SUMS`,
      checksumsSource,
      await digests(checksumsSource),
      'audit',
    ),
  )
  const manifest = {
    assets,
    audit,
    metadata,
    origin: checkedOrigin,
    schemaVersion: 1,
    version,
  }
  await writeFile(
    resolve(outputDirectory, 'release-manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { encoding: 'utf8', flag: 'wx' },
  )
  return manifest
}

async function run(command, argumentsList) {
  const { spawn } = await import('node:child_process')
  await new Promise((resolvePromise, reject) => {
    const child = spawn(command, argumentsList, { stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code) =>
      code === 0
        ? resolvePromise()
        : reject(new Error(`${command} failed with ${code}.`)),
    )
  })
}

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`)
  return value
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const version = argument('--version')
  const commit = argument('--commit')
  const outputDirectory = resolve(argument('--output'))
  const origin = argument('--origin')
  await collectReleaseBundle({
    commit,
    linuxDirectory: resolve(argument('--linux')),
    macArm64Directory: resolve(argument('--mac-arm64')),
    macX64Directory: resolve(argument('--mac-x64')),
    outputDirectory,
    origin,
    version,
  })
  await run('node', [
    '-e',
    `console.log(${JSON.stringify(`Collected immutable release v${version}.`)})`,
  ])
}
