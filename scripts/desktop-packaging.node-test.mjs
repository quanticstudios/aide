import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import {
  mkdtemp,
  open,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import test from 'node:test'
import { installLinux } from './install-linux.mjs'
import {
  assertMacReleaseCredentials,
  hasMacNotarizationCredentials,
  hasMacSigningCredentials,
  macPackagingEnvironment,
  macTargetFromArguments,
} from './package-macos.mjs'
import { writeChecksums } from './write-checksums.mjs'

const root = resolve(import.meta.dirname, '..')
const packageJson = JSON.parse(
  readFileSync(resolve(root, 'package.json'), 'utf8'),
)
const build = packageJson.build

test('locks a reproducible desktop packaging configuration', () => {
  assert.equal(packageJson.devDependencies['electron-builder'], '26.15.3')
  assert.equal(
    packageJson.scripts['test:packaging'],
    'node --test scripts/desktop-packaging.node-test.mjs scripts/linux-ota-upgrade-drill.node-test.mjs scripts/release-assembly.node-test.mjs scripts/publish-ota-release.node-test.mjs scripts/release-workflows.node-test.mjs scripts/validate-packaged-update-config.node-test.mjs scripts/write-updater-metadata.node-test.mjs',
  )
  assert.equal(build.appId, 'studio.quantic.aide')
  assert.equal(build.productName, 'aIDE')
  assert.equal(build.icon, 'build/icon.png')
  assert.equal(existsSync(resolve(root, build.icon)), true)
  assert.equal(build.executableName, 'aide')
  assert.equal(packageJson.author, 'Quantic Studios')
  assert.equal(packageJson.desktopName, 'aIDE')
  assert.equal(
    build.artifactName,
    [
      'Aide',
      '$' + '{version}',
      '$' + '{os}',
      '$' + '{arch}.' + '$' + '{ext}',
    ].join('-'),
  )
  assert.equal(build.asar, true)
  assert.deepEqual(build.extraResources, [
    { from: 'build/icon.png', to: 'icon.png' },
    { from: 'build/app-update.yml', to: 'app-update.yml' },
  ])
  const updaterConfig = readFileSync(
    resolve(root, 'build', 'app-update.yml'),
    'utf8',
  )
  assert.equal(updaterConfig, 'updaterCacheDirName: aide-updater\n')
  assert.doesNotMatch(updaterConfig, /provider|url|https?|channel|auth|trust/i)
  assert.deepEqual(build.asarUnpack, [
    'node_modules/node-pty/**',
    'node_modules/@anthropic-ai/claude-agent-sdk-*/**',
  ])
  assert.deepEqual(build.linux.target, [
    { target: 'AppImage', arch: ['x64'] },
    { target: 'tar.gz', arch: ['x64'] },
  ])
  assert.equal(build.linux.syncDesktopName, true)
  assert.deepEqual(build.mac.target, ['dmg', 'zip'])
})

test('reinstalls behind one launcher without truncating an open image or changing saved data', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "aide install 'space-"))
  const dataHome = resolve(directory, 'share')
  const source = resolve(directory, 'build.AppImage')
  const imageBytes = (version) =>
    Buffer.concat([
      Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 0x02]),
      Buffer.from(version),
    ])
  try {
    await writeFile(source, imageBytes('first'))
    const first = await installLinux(source, { home: directory, dataHome })
    const desktop = await readFile(first.desktopFile, 'utf8')
    const savedData = resolve(dataHome, 'aide/saved-workspace')
    await writeFile(savedData, 'keep this')
    const runningImage = await open(first.installedImage, 'r')
    try {
      await writeFile(source, imageBytes('second'))
      assert.deepEqual(
        await installLinux(source, { home: directory, dataHome }),
        first,
      )
      assert.deepEqual(await runningImage.readFile(), imageBytes('first'))
    } finally {
      await runningImage.close()
    }
    assert.deepEqual(await readFile(first.installedImage), imageBytes('second'))
    assert.equal(await readFile(first.desktopFile, 'utf8'), desktop)
    assert.deepEqual(await readdir(resolve(dataHome, 'applications')), [
      'aide.desktop',
    ])
    assert.equal(await readFile(savedData, 'utf8'), 'keep this')
    assert.ok((await stat(first.launcher)).mode & 0o111)
    assert.ok((await stat(first.installedImage)).mode & 0o111)
    assert.match(await readFile(first.launcher, 'utf8'), /launch-env/)
    assert.deepEqual(
      await readFile(resolve(dataHome, 'aide/icon.png')),
      await readFile(resolve(root, build.icon)),
    )
    await writeFile(source, 'broken build')
    await assert.rejects(
      installLinux(source, { home: directory, dataHome }),
      /AppImage/,
    )
    assert.deepEqual(await readFile(first.installedImage), imageBytes('second'))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('uses hardened runtime entitlements and native-only packaging entry points', () => {
  assert.equal(build.mac.hardenedRuntime, true)
  assert.equal(build.mac.entitlements, 'build/entitlements.mac.plist')
  assert.equal(build.mac.entitlementsInherit, 'build/entitlements.mac.plist')
  assert.equal(existsSync(resolve(root, build.mac.entitlements)), true)
  assert.match(
    readFileSync(resolve(root, 'scripts/package-linux.mjs'), 'utf8'),
    /process\.platform !== 'linux'/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/package-linux.mjs'), 'utf8'),
    /write-updater-metadata\.mjs/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/package-macos.mjs'), 'utf8'),
    /process\.platform !== 'darwin'/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/package-macos.mjs'), 'utf8'),
    /write-updater-metadata\.mjs/,
  )
})

test('ships release automation on native Linux and macOS runners only', () => {
  const workflow = readFileSync(
    resolve(root, '.github/workflows/release-packages.yml'),
    'utf8',
  )
  const macosJob = workflow.slice(workflow.indexOf('  macos:'))
  const macosJobHeader = macosJob.slice(0, macosJob.indexOf('    steps:'))

  assert.match(workflow, /runs-on: ubuntu-24\.04/)
  assert.match(workflow, /runner: macos-15-intel/)
  assert.match(workflow, /runner: macos-15/)
  assert.match(workflow, /bun install --frozen-lockfile/)
  assert.match(
    workflow,
    /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/,
  )
  assert.match(workflow, /actions\/upload-artifact@[0-9a-f]{40}/)
  assert.match(workflow, /bun run test:packaging/)
  assert.match(workflow, /validate-release:/)
  assert.match(workflow, /collect-release:/)
  assert.match(workflow, /latest-linux\.yml/)
  assert.match(workflow, /latest-mac\.yml/)
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/)
  assert.doesNotMatch(macosJobHeader, /secrets\./)
  assert.match(
    readFileSync(resolve(root, 'scripts/verify-linux-package.mjs'), 'utf8'),
    /--appimage-extract/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/package-macos.mjs'), 'utf8'),
    /await run\(process\.execPath, verificationArguments\)/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/verify-macos-package.mjs'), 'utf8'),
    /verifySignature: process\.argv\.includes\('--signed'\)/,
  )
  assert.match(
    readFileSync(resolve(root, 'scripts/verify-macos-package.mjs'), 'utf8'),
    /app-update\.yml/,
  )
  assert.match(
    readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'),
    /bun run test:packaging/,
  )
})

test('keeps public OTA promotion separate, protected, and fail-closed', () => {
  const workflow = readFileSync(
    resolve(root, '.github/workflows/ota-production.yml'),
    'utf8',
  )

  assert.match(workflow, /environment: ota-production/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(
    workflow,
    /AIDE_UPDATE_ORIGIN must be a configured HTTPS custom origin/,
  )
  assert.match(workflow, /R2_TEMPORARY_ACCESS_KEY_ID/)
  assert.match(workflow, /release-promotions\/v\$VERSION\/linux-x64/)
  assert.match(workflow, /scripts\/publish-ota-release\.mjs/)
  assert.match(workflow, /actions\/download-artifact@[0-9a-f]{40}/)
})

test('rejects macOS cross-target ambiguity and recognizes complete release credentials', () => {
  assert.equal(macTargetFromArguments(['--x64']), 'x64')
  assert.equal(macTargetFromArguments(['--arm64']), 'arm64')
  assert.throws(
    () => macTargetFromArguments(['--x64', '--arm64']),
    /exactly one native macOS target/,
  )
  assert.equal(
    hasMacSigningCredentials({
      CSC_KEY_PASSWORD: 'password',
      CSC_LINK: 'certificate',
    }),
    true,
  )
  assert.equal(hasMacSigningCredentials({ CSC_LINK: 'certificate' }), false)
  assert.equal(
    hasMacNotarizationCredentials({
      APPLE_API_KEY: '/tmp/key.p8',
      APPLE_API_KEY_ID: 'key-id',
      APPLE_API_ISSUER: 'issuer-id',
    }),
    true,
  )
  assert.throws(
    () => assertMacReleaseCredentials(true, {}),
    /CSC_LINK and CSC_KEY_PASSWORD/,
  )
  assert.throws(
    () =>
      assertMacReleaseCredentials(true, {
        CSC_KEY_PASSWORD: 'password',
        CSC_LINK: 'certificate',
      }),
    /Apple notarization credentials/,
  )
  assert.doesNotThrow(() =>
    assertMacReleaseCredentials(true, {
      APPLE_API_KEY: '/tmp/key.p8',
      APPLE_API_KEY_ID: 'key-id',
      APPLE_API_ISSUER: 'issuer-id',
      CSC_KEY_PASSWORD: 'password',
      CSC_LINK: 'certificate',
    }),
  )
})

test('removes empty macOS credential variables before invoking electron-builder', () => {
  assert.deepEqual(
    macPackagingEnvironment({
      APPLE_API_KEY: '',
      CSC_KEY_PASSWORD: '',
      CSC_LINK: '',
      PATH: '/usr/bin',
    }),
    { PATH: '/usr/bin' },
  )
  assert.deepEqual(
    macPackagingEnvironment({
      APPLE_API_KEY: '/tmp/key.p8',
      CSC_KEY_PASSWORD: 'password',
      CSC_LINK: 'certificate',
    }),
    {
      APPLE_API_KEY: '/tmp/key.p8',
      CSC_KEY_PASSWORD: 'password',
      CSC_LINK: 'certificate',
    },
  )
})

test('writes SHA-256 checksums only for sorted distributable artifacts', async () => {
  const directory = await mkdtemp(resolve(tmpdir(), 'aide-checksums-'))
  try {
    await writeFile(resolve(directory, 'Aide-1.0.0-linux-x64.tar.gz'), 'tar')
    await writeFile(resolve(directory, 'Aide-1.0.0-linux-x64.AppImage'), 'app')
    await writeFile(resolve(directory, 'latest-linux.yml'), 'metadata')

    const artifacts = await writeChecksums(directory)

    assert.deepEqual(artifacts, [
      'Aide-1.0.0-linux-x64.AppImage',
      'Aide-1.0.0-linux-x64.tar.gz',
    ])
    const checksums = await readFile(resolve(directory, 'SHA256SUMS'), 'utf8')
    assert.match(checksums, /Aide-1\.0\.0-linux-x64\.AppImage/)
    assert.match(checksums, /Aide-1\.0\.0-linux-x64\.tar\.gz/)
    assert.doesNotMatch(checksums, /latest-linux\.yml/)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
