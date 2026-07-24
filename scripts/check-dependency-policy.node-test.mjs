import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REQUIRED_DEV_DEPENDENCIES,
  REQUIRED_OVERRIDES,
  validateDependencyPolicy,
} from './check-dependency-policy.mjs'

function createPackageJson(overrides = REQUIRED_OVERRIDES) {
  return {
    packageManager: 'bun@1.3.14',
    dependencies: {
      'example-runtime': '1.2.3',
    },
    devDependencies: {
      'example-tool': '4.5.6-beta.7',
      ...REQUIRED_DEV_DEPENDENCIES,
    },
    overrides,
  }
}

function createLockfile() {
  return {
    packages: Object.fromEntries(
      [
        ...Object.entries(REQUIRED_OVERRIDES),
        ...Object.entries(REQUIRED_DEV_DEPENDENCIES),
      ].map(([name, version]) => [name, [`${name}@${version}`]]),
    ),
  }
}

const validBunfig = `
[install]
minimumReleaseAge = 604800
minimumReleaseAgeExcludes = ["fast-uri"]
`

test('accepts exact direct pins, the seven-day release age, and resolved security overrides', () => {
  assert.deepEqual(
    validateDependencyPolicy({
      packageJson: createPackageJson(),
      bunfig: validBunfig,
      lockfile: createLockfile(),
    }),
    [],
  )
})

test('rejects a ranged direct dependency', () => {
  const packageJson = createPackageJson()
  packageJson.dependencies['example-runtime'] = '^1.2.3'

  assert.match(
    validateDependencyPolicy({
      packageJson,
      bunfig: validBunfig,
      lockfile: createLockfile(),
    }).join('\n'),
    /example-runtime must be pinned to an exact SemVer version/,
  )
})

test('rejects a release age below seven days or an unapproved exemption', () => {
  const errors = validateDependencyPolicy({
    packageJson: createPackageJson(),
    bunfig: `[install]\nminimumReleaseAge = 1\nminimumReleaseAgeExcludes = ["example-runtime"]`,
    lockfile: createLockfile(),
  }).join('\n')

  assert.match(errors, /minimumReleaseAge = 604800/)
  assert.match(errors, /must exempt only fast-uri/)
})

test('rejects a release age outside the install table and quoted exemption keys', () => {
  const misplacedAgeErrors = validateDependencyPolicy({
    packageJson: createPackageJson(),
    bunfig: `minimumReleaseAge = 604800\n[install]\nminimumReleaseAgeExcludes = ["fast-uri"]`,
    lockfile: createLockfile(),
  }).join('\n')
  const quotedExemptionErrors = validateDependencyPolicy({
    packageJson: createPackageJson(),
    bunfig: `[install]\nminimumReleaseAge = 604800\n"minimumReleaseAgeExcludes" = ["example-runtime"]`,
    lockfile: createLockfile(),
  }).join('\n')

  assert.match(misplacedAgeErrors, /minimumReleaseAge = 604800/)
  assert.match(quotedExemptionErrors, /must exempt only fast-uri/)
})

test('rejects invalid TOML without crashing the policy report', () => {
  const errors = validateDependencyPolicy({
    packageJson: createPackageJson(),
    bunfig: `[install\nminimumReleaseAge = 604800`,
    lockfile: createLockfile(),
  }).join('\n')

  assert.match(errors, /must be valid TOML/)
})

test('rejects an unpinned security override or a lockfile that did not resolve it', () => {
  const overrides = { ...REQUIRED_OVERRIDES, hono: '^4.12.25' }
  const lockfile = createLockfile()
  lockfile.packages['fast-uri'] = ['fast-uri@3.1.1']

  const errors = validateDependencyPolicy({
    packageJson: createPackageJson(overrides),
    bunfig: validBunfig,
    lockfile,
  }).join('\n')

  assert.match(errors, /overrides.hono must be exactly 4\.12\.25/)
  assert.match(errors, /bun.lock must resolve fast-uri to exactly 3\.1\.4/)
})

test('rejects an unpinned Worker deployment CLI or mismatched lockfile', () => {
  const packageJson = createPackageJson()
  packageJson.devDependencies.wrangler = '4.112.0'
  const lockfile = createLockfile()
  lockfile.packages.wrangler = ['wrangler@4.112.0']

  const errors = validateDependencyPolicy({
    packageJson,
    bunfig: validBunfig,
    lockfile,
  }).join('\n')

  assert.match(errors, /devDependencies\.wrangler must be exactly 4\.113\.0/)
  assert.match(errors, /bun\.lock must resolve wrangler to exactly 4\.113\.0/)
})
