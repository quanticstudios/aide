import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import TOML from '@iarna/toml'

export const REQUIRED_OVERRIDES = Object.freeze({
  'fast-uri': '3.1.8',
  picomatch: '4.0.4',
  postcss: '8.5.19',
  sharp: '0.35.5',
  tar: '7.5.21',
  undici: '7.30.1',
  zod: '4.6.7',
})

export const REQUIRED_DEV_DEPENDENCIES = Object.freeze({
  wrangler: '4.151.1',
})

// ENG-2706: sessions run in pitwall's daemon, so aide ships no provider SDK.
export const REMOVED_DEPENDENCIES = Object.freeze([
  '@anthropic-ai/claude-agent-sdk',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
])

const EXACT_SEMVER =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const MINIMUM_RELEASE_AGE = 604800
export const MINIMUM_RELEASE_AGE_EXCLUDES = Object.freeze([
  'fast-uri',
  // workaround(until 2026-10-29): the exact-pinned security fixes for electron and happy-dom are inside the seven-day window until then.
  'electron',
  'happy-dom',
])

function policyError(message) {
  return `Dependency policy violation: ${message}`
}

function packageVersion(lockfile, name) {
  const entry = lockfile.packages?.[name]
  const identifier = Array.isArray(entry) ? entry[0] : undefined
  const prefix = `${name}@`

  return typeof identifier === 'string' && identifier.startsWith(prefix)
    ? identifier.slice(prefix.length)
    : undefined
}

export function validateDependencyPolicy({ packageJson, bunfig, lockfile }) {
  const errors = []

  if (packageJson.packageManager !== 'bun@1.4.4') {
    errors.push(policyError('packageManager must be exactly bun@1.4.4'))
  }

  for (const section of ['dependencies', 'devDependencies']) {
    for (const [name, version] of Object.entries(packageJson[section] ?? {})) {
      if (typeof version !== 'string' || !EXACT_SEMVER.test(version)) {
        errors.push(
          policyError(
            `${section}.${name} must be pinned to an exact SemVer version`,
          ),
        )
      }
    }
  }

  for (const name of [
    ...Object.keys(packageJson.dependencies ?? {}),
    ...Object.keys(packageJson.devDependencies ?? {}),
    ...Object.keys(packageJson.optionalDependencies ?? {}),
    ...Object.keys(lockfile.packages ?? {}),
  ]) {
    if (
      REMOVED_DEPENDENCIES.some(
        (removed) => name === removed || name.startsWith(`${removed}-`),
      )
    ) {
      errors.push(policyError(`${name} was removed and must stay removed`))
    }
  }

  let parsedBunfig
  try {
    parsedBunfig = TOML.parse(bunfig)
  } catch (error) {
    errors.push(
      policyError(
        `bunfig.toml must be valid TOML: ${error instanceof Error ? error.message : String(error)}`,
      ),
    )
  }

  if (parsedBunfig?.install?.minimumReleaseAge !== MINIMUM_RELEASE_AGE) {
    errors.push(
      policyError(
        `bunfig.toml must set minimumReleaseAge = ${MINIMUM_RELEASE_AGE}`,
      ),
    )
  }
  if (
    JSON.stringify(parsedBunfig?.install?.minimumReleaseAgeExcludes) !==
    JSON.stringify(MINIMUM_RELEASE_AGE_EXCLUDES)
  ) {
    errors.push(
      policyError(
        'bunfig.toml must exempt only the approved packages from the release-age gate',
      ),
    )
  }

  for (const [name, expectedVersion] of Object.entries(REQUIRED_OVERRIDES)) {
    if (packageJson.overrides?.[name] !== expectedVersion) {
      errors.push(
        policyError(`overrides.${name} must be exactly ${expectedVersion}`),
      )
    }
    if (packageVersion(lockfile, name) !== expectedVersion) {
      errors.push(
        policyError(
          `bun.lock must resolve ${name} to exactly ${expectedVersion}`,
        ),
      )
    }
  }

  for (const [name, expectedVersion] of Object.entries(
    REQUIRED_DEV_DEPENDENCIES,
  )) {
    if (packageJson.devDependencies?.[name] !== expectedVersion) {
      errors.push(
        policyError(
          `devDependencies.${name} must be exactly ${expectedVersion}`,
        ),
      )
    }
    if (packageVersion(lockfile, name) !== expectedVersion) {
      errors.push(
        policyError(
          `bun.lock must resolve ${name} to exactly ${expectedVersion}`,
        ),
      )
    }
  }

  return errors
}

export function assertDependencyPolicy(policy) {
  const errors = validateDependencyPolicy(policy)
  if (errors.length > 0) {
    throw new Error(errors.join('\n'))
  }
}

function readPolicyFiles(root) {
  return {
    packageJson: JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8'),
    ),
    bunfig: readFileSync(resolve(root, 'bunfig.toml'), 'utf8'),
    lockfile: JSON.parse(
      readFileSync(resolve(root, 'bun.lock'), 'utf8').replace(
        /,\s*([}\]])/g,
        '$1',
      ),
    ),
  }
}

function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  assertDependencyPolicy(readPolicyFiles(root))
  console.log('Dependency policy passed.')
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main()
}
