import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { collectReleaseBundle } from './release-assembly.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'aide-release-assembly-'))
  const linux = join(root, 'linux')
  const macX64 = join(root, 'mac-x64')
  const macArm64 = join(root, 'mac-arm64')
  const output = join(root, 'output')
  await Promise.all([mkdir(linux), mkdir(macX64), mkdir(macArm64)])
  const files = [
    [linux, 'Aide-1.2.3-linux-x86_64.AppImage', 'linux-appimage'],
    [linux, 'Aide-1.2.3-linux-x64.tar.gz', 'linux-tarball'],
    [macX64, 'Aide-1.2.3-mac-x64.zip', 'mac-x64-zip'],
    [macX64, 'Aide-1.2.3-mac-x64.zip.blockmap', 'mac-x64-blockmap'],
    [macX64, 'Aide-1.2.3-mac-x64.dmg', 'mac-x64-dmg'],
    [macArm64, 'Aide-1.2.3-mac-arm64.zip', 'mac-arm64-zip'],
    [macArm64, 'Aide-1.2.3-mac-arm64.zip.blockmap', 'mac-arm64-blockmap'],
    [macArm64, 'Aide-1.2.3-mac-arm64.dmg', 'mac-arm64-dmg'],
  ]
  for (const [directory, name, contents] of files) {
    await writeFile(join(directory, name), contents)
  }
  await writeFile(
    join(linux, 'latest-linux.yml'),
    updaterMetadata('Aide-1.2.3-linux-x86_64.AppImage', 'linux-appimage'),
  )
  await writeFile(
    join(macX64, 'latest-mac.yml'),
    updaterMetadata('Aide-1.2.3-mac-x64.zip', 'mac-x64-zip'),
  )
  await writeFile(
    join(macArm64, 'latest-mac.yml'),
    updaterMetadata('Aide-1.2.3-mac-arm64.zip', 'mac-arm64-zip'),
  )
  return { root, linux, macArm64, macX64, output }
}

function updaterMetadata(name, contents) {
  const sha512 = createHash('sha512').update(contents).digest('base64')
  return [
    'version: 1.2.3',
    'files:',
    `  - url: ${name}`,
    `    sha512: ${sha512}`,
    `    size: ${Buffer.byteLength(contents)}`,
    `path: ${name}`,
    `sha512: ${sha512}`,
    'releaseDate: 2026-07-24T00:00:00.000Z',
    '',
  ].join('\n')
}

test('collects exact target artifacts and writes immutable OTA metadata', async () => {
  const workspace = await fixture()
  try {
    const manifest = await collectReleaseBundle({
      commit: 'a'.repeat(40),
      linuxDirectory: workspace.linux,
      macArm64Directory: workspace.macArm64,
      macX64Directory: workspace.macX64,
      outputDirectory: workspace.output,
      origin: 'https://updates.aide.example',
      version: '1.2.3',
    })

    assert.equal(manifest.version, '1.2.3')
    assert.equal(manifest.assets.length, 8)
    assert.deepEqual(
      manifest.audit.map((entry) => entry.key),
      [
        'releases/v1.2.3/audit/sbom.cdx.json',
        'releases/v1.2.3/audit/provenance-input.json',
        'releases/v1.2.3/audit/SHA256SUMS',
      ],
    )
    assert.deepEqual(
      manifest.assets.map((asset) => asset.key),
      [
        'releases/v1.2.3/darwin/arm64/Aide-1.2.3-mac-arm64.zip',
        'releases/v1.2.3/darwin/arm64/Aide-1.2.3-mac-arm64.zip.blockmap',
        'releases/v1.2.3/darwin/x64/Aide-1.2.3-mac-x64.zip',
        'releases/v1.2.3/darwin/x64/Aide-1.2.3-mac-x64.zip.blockmap',
        'releases/v1.2.3/linux/x64/Aide-1.2.3-linux-x86_64.AppImage',
        'releases/v1.2.3/manual/darwin/arm64/Aide-1.2.3-mac-arm64.dmg',
        'releases/v1.2.3/manual/darwin/x64/Aide-1.2.3-mac-x64.dmg',
        'releases/v1.2.3/manual/linux/x64/Aide-1.2.3-linux-x64.tar.gz',
      ],
    )
    assert.match(
      await readFile(join(workspace.output, 'latest-mac.yml'), 'utf8'),
      /files:\n {2}- url: Aide-1\.2\.3-mac-arm64\.zip[\s\S]*Aide-1\.2\.3-mac-x64\.zip/,
    )
    assert.match(
      await readFile(join(workspace.output, 'latest-mac.yml'), 'utf8'),
      /blockMapSize: 16/,
    )
    assert.match(
      await readFile(join(workspace.output, 'sbom.cdx.json'), 'utf8'),
      /CycloneDX/,
    )
    const checksums = await readFile(
      join(workspace.output, 'SHA256SUMS'),
      'utf8',
    )
    const checksumKeys = checksums
      .split('\n')
      .filter((line) => /^[a-f0-9]{64} {2}/.test(line))
      .map((line) => line.slice(66))
      .sort()
    assert.deepEqual(
      checksumKeys,
      [...manifest.assets, ...manifest.metadata, ...manifest.audit]
        .filter((entry) => !entry.key.endsWith('/SHA256SUMS'))
        .map((entry) => entry.key)
        .sort(),
    )
    assert.deepEqual(
      JSON.parse(
        await readFile(join(workspace.output, 'provenance-input.json'), 'utf8'),
      ),
      { commit: 'a'.repeat(40), tag: 'v1.2.3', version: '1.2.3' },
    )
  } finally {
    await rm(workspace.root, { force: true, recursive: true })
  }
})

test('rejects stale, partial, or tampered builder metadata', async () => {
  const workspace = await fixture()
  try {
    await writeFile(
      join(workspace.linux, 'latest-linux.yml'),
      'version: 9.9.9\n',
    )
    await assert.rejects(
      () =>
        collectReleaseBundle({
          commit: 'a'.repeat(40),
          linuxDirectory: workspace.linux,
          macArm64Directory: workspace.macArm64,
          macX64Directory: workspace.macX64,
          outputDirectory: workspace.output,
          origin: 'https://updates.aide.example',
          version: '1.2.3',
        }),
      /metadata does not describe the expected artifact/,
    )
  } finally {
    await rm(workspace.root, { force: true, recursive: true })
  }
})

test('refuses insecure or Cloudflare development origins', async () => {
  const workspace = await fixture()
  try {
    for (const origin of [
      'http://updates.aide.example',
      'https://aide.r2.dev',
    ]) {
      await assert.rejects(
        () =>
          collectReleaseBundle({
            commit: 'a'.repeat(40),
            linuxDirectory: workspace.linux,
            macArm64Directory: workspace.macArm64,
            macX64Directory: workspace.macX64,
            outputDirectory: workspace.output,
            origin,
            version: '1.2.3',
          }),
        /HTTPS custom origin/,
      )
    }
  } finally {
    await rm(workspace.root, { force: true, recursive: true })
  }
})
