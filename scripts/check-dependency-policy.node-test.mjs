import assert from 'node:assert/strict'
import test from 'node:test'

import {
  MINIMUM_RELEASE_AGE_EXCLUDES,
  REQUIRED_DEV_DEPENDENCIES,
  REQUIRED_OVERRIDES,
  validateDependencyPolicy,
} from './check-dependency-policy.mjs'

function createPackageJson(overrides = REQUIRED_OVERRIDES) {
  return {
    packageManager: 'bun@1.4.4',
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
minimumReleaseAgeExcludes = ${JSON.stringify(MINIMUM_RELEASE_AGE_EXCLUDES)}
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
  assert.match(errors, /must exempt only the approved packages/)
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
  assert.match(quotedExemptionErrors, /must exempt only the approved packages/)
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
  const overrides = { ...REQUIRED_OVERRIDES, undici: '^7.30.1' }
  const lockfile = createLockfile()
  lockfile.packages['fast-uri'] = ['fast-uri@3.1.1']

  const errors = validateDependencyPolicy({
    packageJson: createPackageJson(overrides),
    bunfig: validBunfig,
    lockfile,
  }).join('\n')

  assert.match(errors, /overrides.undici must be exactly 7\.30\.1/)
  assert.match(errors, /bun.lock must resolve fast-uri to exactly 3\.1\.8/)
})

test('rejects an unpinned Worker deployment CLI or mismatched lockfile', () => {
  const packageJson = createPackageJson()
  packageJson.devDependencies.wrangler = '4.119.0'
  const lockfile = createLockfile()
  lockfile.packages.wrangler = ['wrangler@4.119.0']

  const errors = validateDependencyPolicy({
    packageJson,
    bunfig: validBunfig,
    lockfile,
  }).join('\n')

  assert.match(errors, /devDependencies\.wrangler must be exactly 4\.151\.1/)
  assert.match(errors, /bun\.lock must resolve wrangler to exactly 4\.151\.1/)
})

test('rejects a removed provider SDK as a direct or transitive dependency', () => {
  const packageJson = createPackageJson()
  packageJson.dependencies['@anthropic-ai/sdk'] = '0.110.0'
  const lockfile = createLockfile()
  lockfile.packages['@modelcontextprotocol/sdk'] = [
    '@modelcontextprotocol/sdk@1.32.1',
  ]
  lockfile.packages['@anthropic-ai/claude-agent-sdk-linux-x64'] = [
    '@anthropic-ai/claude-agent-sdk-linux-x64@0.3.282',
  ]

  const errors = validateDependencyPolicy({
    packageJson,
    bunfig: validBunfig,
    lockfile,
  }).join('\n')

  assert.match(errors, /@anthropic-ai\/sdk was removed/)
  assert.match(errors, /@modelcontextprotocol\/sdk was removed/)
  assert.match(errors, /claude-agent-sdk-linux-x64 was removed/)
})
