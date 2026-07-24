import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { writeUpdaterMetadata } from './write-updater-metadata.mjs'

test('writes a standard updater manifest only for the exact target artifact', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-updater-metadata-'))
  try {
    await writeFile(
      join(directory, 'Aide-1.2.3-linux-x86_64.AppImage'),
      'appimage',
    )
    const result = await writeUpdaterMetadata({
      arch: 'x64',
      directory,
      platform: 'linux',
      version: '1.2.3',
    })
    const metadata = await readFile(result, 'utf8')
    assert.match(metadata, /^version: 1\.2\.3/m)
    assert.match(metadata, /url: Aide-1\.2\.3-linux-x86_64\.AppImage/)
    assert.match(metadata, /sha512: [A-Za-z0-9+/]+=*/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})

test('records macOS ZIP blockmap metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'aide-updater-metadata-'))
  try {
    await writeFile(join(directory, 'Aide-1.2.3-mac-arm64.zip'), 'zip')
    await writeFile(
      join(directory, 'Aide-1.2.3-mac-arm64.zip.blockmap'),
      'blockmap',
    )
    const result = await writeUpdaterMetadata({
      arch: 'arm64',
      directory,
      platform: 'darwin',
      version: '1.2.3',
    })
    assert.match(await readFile(result, 'utf8'), /blockMapSize: 8/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
