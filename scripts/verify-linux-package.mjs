import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const executeFile = promisify(execFile)
const artifactPattern = /^Aide-.+-linux-(?:x64|x86_64)\.(AppImage|tar\.gz)$/

async function run(command, args, options = {}) {
  return executeFile(command, args, {
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  })
}

async function findAppRoot(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue
    }
    try {
      await stat(join(directory, entry.name, 'resources', 'app.asar'))
      return join(directory, entry.name)
    } catch {
      // Continue looking through archive roots.
    }
  }
  throw new Error('The packaged archive does not contain an Electron app root.')
}

async function verifyPackagedRuntime(appRoot) {
  const resources = join(appRoot, 'resources')
  const nodePty = join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    'node-pty',
  )
  const claude = join(
    resources,
    'app.asar.unpacked',
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk-linux-x64',
    'claude',
  )

  await stat(join(resources, 'app.asar'))
  assert.equal(
    await readFile(join(resources, 'app-update.yml'), 'utf8'),
    'updaterCacheDirName: aide-updater\n',
  )
  await stat(join(nodePty, 'build', 'Release', 'pty.node'))
  assert.ok(
    (await stat(claude)).mode & 0o111,
    'The packaged Claude Agent SDK executable is not executable.',
  )
  await run(
    join(appRoot, 'aide'),
    ['-e', 'require(process.argv[1])', nodePty],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    },
  )
}

export async function verifyLinuxPackage(
  directory,
  { appImageOnly = false } = {},
) {
  const entries = await readdir(directory, { withFileTypes: true })
  const artifacts = entries
    .filter((entry) => entry.isFile() && artifactPattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  const appImage = artifacts.find((artifact) => artifact.endsWith('.AppImage'))
  const archive = artifacts.find((artifact) => artifact.endsWith('.tar.gz'))
  assert.ok(appImage, 'Expected one Linux AppImage artifact.')
  if (!appImageOnly) assert.ok(archive, 'Expected one Linux tar.gz artifact.')
  assert.equal(
    artifacts.length,
    appImageOnly ? 1 : 2,
    'Unexpected number of Linux artifacts.',
  )
  assert.ok((await stat(join(directory, appImage))).mode & 0o111)

  if (!appImageOnly) {
    const { stdout } = await run('tar', ['-tzf', join(directory, archive)])
    assert.match(stdout, /resources\/app\.asar\n/)
    assert.match(stdout, /resources\/app-update\.yml\n/)
    assert.match(
      stdout,
      /resources\/app\.asar\.unpacked\/node_modules\/node-pty\/.*pty\.node\n/,
    )
    assert.match(
      stdout,
      /resources\/app\.asar\.unpacked\/node_modules\/@anthropic-ai\/claude-agent-sdk-linux-x64\//,
    )

    const extractionDirectory = await mkdtemp(join(tmpdir(), 'aide-package-'))
    try {
      await run('tar', [
        '-xzf',
        join(directory, archive),
        '-C',
        extractionDirectory,
      ])
      const appRoot = await findAppRoot(extractionDirectory)
      await verifyPackagedRuntime(appRoot)
    } finally {
      await rm(extractionDirectory, { force: true, recursive: true })
    }
  }

  const appImageExtractionDirectory = await mkdtemp(
    join(tmpdir(), 'aide-appimage-'),
  )
  try {
    await run(resolve(directory, appImage), ['--appimage-extract'], {
      cwd: appImageExtractionDirectory,
    })
    await verifyPackagedRuntime(
      join(appImageExtractionDirectory, 'squashfs-root'),
    )
  } finally {
    await rm(appImageExtractionDirectory, { force: true, recursive: true })
  }

  return {
    appImage: basename(appImage),
    ...(archive ? { archive: basename(archive) } : {}),
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (process.platform !== 'linux') {
    throw new Error('Linux package verification must run on Linux.')
  }
  const directory = resolve(process.cwd(), process.argv[2] ?? 'dist')
  const artifacts = await verifyLinuxPackage(directory, {
    appImageOnly: process.argv.includes('--appimage-only'),
  })
  console.log(`Verified ${Object.values(artifacts).join(' and ')}.`)
}
