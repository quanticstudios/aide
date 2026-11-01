import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const expectedArchitectures = new Map([
  ['x64', 'x86_64'],
  ['arm64', 'arm64'],
])

async function findApplication(directory, target) {
  const application = join(
    directory,
    target === 'arm64' ? 'mac-arm64' : 'mac',
    'aide.app',
  )
  const applicationStat = await stat(application).catch(() => null)
  if (!applicationStat?.isDirectory()) {
    throw new Error('The packaged macOS output does not contain aide.app.')
  }
  return application
}

async function assertNativeArchitecture(file, target) {
  const expected = expectedArchitectures.get(target)
  if (!expected) {
    throw new Error('Pass a supported macOS architecture: x64 or arm64.')
  }

  const { stdout } = await executeFile('file', ['-b', file])
  if (!stdout.includes(expected)) {
    throw new Error(
      `${file} is not a native macOS ${target} executable: ${stdout.trim()}`,
    )
  }
}

export async function verifyMacosPackage(
  directory,
  target,
  { verifySignature = false } = {},
) {
  const application = await findApplication(directory, target)
  const resources = join(application, 'Contents', 'Resources')
  const nodePty = join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
    'build',
    'Release',
    'pty.node',
  )

  if (
    (await readFile(join(resources, 'app-update.yml'), 'utf8')) !==
    'updaterCacheDirName: aide-updater\n'
  ) {
    throw new Error('The packaged updater cache configuration is invalid.')
  }

  await assertNativeArchitecture(
    join(application, 'Contents', 'MacOS', 'aide'),
    target,
  )
  await assertNativeArchitecture(nodePty, target)
  if (verifySignature) {
    await executeFile('codesign', [
      '--verify',
      '--deep',
      '--strict',
      application,
    ])
    await executeFile('spctl', [
      '--assess',
      '--type',
      'execute',
      '--verbose=4',
      application,
    ])
    await executeFile('xcrun', ['stapler', 'validate', application])
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS package verification must run on macOS.')
  }
  await verifyMacosPackage(
    resolve(process.cwd(), process.argv[2] ?? 'dist'),
    process.argv[3],
    { verifySignature: process.argv.includes('--signed') },
  )
  console.log(
    process.argv.includes('--signed')
      ? 'Verified macOS architecture, codesigning, Gatekeeper assessment, and stapling.'
      : 'Verified macOS application and bundled executable architectures.',
  )
}
