import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const supportedArchitectures = new Set(['x64', 'arm64'])
const macCredentialVariables = [
  'APPLE_API_ISSUER',
  'APPLE_API_KEY',
  'APPLE_API_KEY_ID',
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'APPLE_KEYCHAIN',
  'APPLE_KEYCHAIN_PROFILE',
  'APPLE_TEAM_ID',
  'CSC_KEY_PASSWORD',
  'CSC_LINK',
]

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: 'inherit',
      ...options,
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }

      reject(
        new Error(
          `${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}.`,
        ),
      )
    })
  })
}

function hasValue(value) {
  return typeof value === 'string' && value.length > 0
}

export function hasMacSigningCredentials(environment = process.env) {
  return (
    hasValue(environment.CSC_LINK) && hasValue(environment.CSC_KEY_PASSWORD)
  )
}

export function hasMacNotarizationCredentials(environment = process.env) {
  return (
    (hasValue(environment.APPLE_API_KEY) &&
      hasValue(environment.APPLE_API_KEY_ID) &&
      hasValue(environment.APPLE_API_ISSUER)) ||
    (hasValue(environment.APPLE_ID) &&
      hasValue(environment.APPLE_APP_SPECIFIC_PASSWORD) &&
      hasValue(environment.APPLE_TEAM_ID)) ||
    (hasValue(environment.APPLE_KEYCHAIN) &&
      hasValue(environment.APPLE_KEYCHAIN_PROFILE))
  )
}

export function macPackagingEnvironment(environment = process.env) {
  const sanitized = { ...environment }
  for (const variable of macCredentialVariables) {
    if (!hasValue(sanitized[variable])) {
      delete sanitized[variable]
    }
  }
  return sanitized
}

export function macTargetFromArguments(argumentsList) {
  const targets = argumentsList.filter((argument) =>
    supportedArchitectures.has(argument.replace(/^--/, '')),
  )

  if (targets.length !== 1 || argumentsList.length !== 1) {
    throw new Error('Pass exactly one native macOS target: --x64 or --arm64.')
  }

  return targets[0].replace(/^--/, '')
}

export function assertMacReleaseCredentials(
  requiresSigning,
  environment = process.env,
) {
  if (!requiresSigning) {
    return
  }
  if (!hasMacSigningCredentials(environment)) {
    throw new Error(
      'CSC_LINK and CSC_KEY_PASSWORD are required for this release.',
    )
  }
  if (!hasMacNotarizationCredentials(environment)) {
    throw new Error(
      'Apple notarization credentials are required for this release.',
    )
  }
}

export async function packageMacos(target) {
  if (process.platform !== 'darwin') {
    throw new Error('macOS packages must be built on a native macOS host.')
  }
  if (!supportedArchitectures.has(target)) {
    throw new Error('Pass exactly one native macOS target: --x64 or --arm64.')
  }
  if (process.arch !== target) {
    throw new Error(
      `Refusing to cross-build macOS ${target} from ${process.arch}; use a native runner.`,
    )
  }

  assertMacReleaseCredentials(process.env.AIDE_REQUIRE_MAC_SIGNING === '1')

  await rm(resolve(root, 'dist'), { force: true, recursive: true })
  await run('bun', ['run', 'build'])
  await run('bun', ['run', 'rebuild:native'])
  await run('bun', ['run', 'test:native'])
  await run(
    resolve(root, 'node_modules/.bin/electron-builder'),
    ['--mac', `--${target}`, '--publish', 'never'],
    {
      env: macPackagingEnvironment(),
    },
  )
  await run(process.execPath, ['scripts/write-checksums.mjs', 'dist'])
  await run(process.execPath, [
    'scripts/write-updater-metadata.mjs',
    '--platform',
    'darwin',
    '--arch',
    target,
    '--directory',
    'dist',
  ])

  const verificationArguments = [
    'scripts/verify-macos-package.mjs',
    'dist',
    target,
  ]
  if (hasMacSigningCredentials() && hasMacNotarizationCredentials()) {
    verificationArguments.push('--signed')
  }
  await run(process.execPath, verificationArguments)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await packageMacos(macTargetFromArguments(process.argv.slice(2)))
}
