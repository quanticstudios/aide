import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

import { validateUpdateHealthEndpoint } from '../src/shared/update-health-endpoint.mjs'

const root = resolve(import.meta.dirname, '..')

test('collector creates official provenance attestations for checksum and SBOM', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/release-packages.yml'),
    'utf8',
  )
  const pin =
    'actions/attest-build-provenance@0f67c3f4856b2e3261c31976d6725780e5e4c373'
  assert.match(workflow, /attestations: write/)
  assert.match(workflow, /id-token: write/)
  assert.match(
    workflow,
    /collect-release:[\s\S]*?environment: ota-production[\s\S]*?AIDE_UPDATE_ORIGIN:/,
  )
  assert.equal(workflow.split(pin).length - 1, 2)
  assert.match(workflow, /subject-path: release-bundle\/SHA256SUMS/)
  assert.match(workflow, /subject-path: release-bundle\/sbom\.cdx\.json/)
})

test('tagged collection fails closed without a protected update origin', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/release-packages.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /if \[\[ "\$EVENT_NAME" == push \]\]; then\n\s+\[\[ -n "\$AIDE_UPDATE_ORIGIN" \]\] \|\| \{ echo "Tagged releases require the protected AIDE_UPDATE_ORIGIN variable\./,
  )
  assert.match(
    workflow,
    /else\n\s+AIDE_UPDATE_ORIGIN="\$\{AIDE_UPDATE_ORIGIN:-https:\/\/updates\.invalid\}"/,
  )
})

test('promotion trusts an immutable packaging workflow path rather than display name', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/ota-production.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /jq -r \.path release-run\.json\).*\.github\/workflows\/release-packages\.yml/,
  )
  assert.doesNotMatch(workflow, /jq -r \.name release-run\.json/)
})

test('health reporting endpoint is a fail-closed package-time main bundle value', async () => {
  const vite = await readFile(resolve(root, 'electron.vite.config.ts'), 'utf8')
  const config = await readFile(
    resolve(root, 'src/main/update-health-config.ts'),
    'utf8',
  )
  assert.match(vite, /AIDE_UPDATE_HEALTH_ENDPOINT/)
  assert.match(vite, /AIDE_UPDATE_ORIGIN/)
  assert.match(vite, /AIDE_RELEASE_PUBLIC_KEY_PEM/)
  assert.match(vite, /AIDE_OTA_DRILL_BUILD/)
  assert.match(vite, /__AIDE_UPDATE_HEALTH_ENDPOINT__/)
  assert.doesNotMatch(config, /process\.env/)
})

test('tagged package validation refuses the drill-only build flag', async () => {
  const config = await readFile(
    resolve(root, 'scripts/validate-packaged-update-config.mjs'),
    'utf8',
  )
  assert.match(config, /AIDE_OTA_DRILL_BUILD/)
  assert.match(config, /must not enable the OTA drill build policy/)
})

test('tagged packages embed only validated protected public OTA configuration', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/release-packages.yml'),
    'utf8',
  )
  assert.match(workflow, /node scripts\/validate-packaged-update-config\.mjs/)
  assert.match(
    workflow,
    /AIDE_RELEASE_PUBLIC_KEY_PEM: \$\{\{ vars\.AIDE_RELEASE_PUBLIC_KEY_PEM \}\}/,
  )
  assert.match(workflow, /linux-x64:[\s\S]*?environment: ota-production/)
  assert.match(workflow, /macos:[\s\S]*?environment: ota-production/)
  assert.equal(
    workflow.split('node scripts/validate-packaged-update-config.mjs').length -
      1,
    3,
  )
  assert.match(
    workflow,
    /Test release assembly[\s\S]*?validate-packaged-update-config\.node-test\.mjs/,
  )
})

test('tagged packages receive a protected custom health endpoint', async () => {
  const workflow = await readFile(
    resolve(root, '.github/workflows/release-packages.yml'),
    'utf8',
  )
  assert.match(
    workflow,
    /validate-release:[\s\S]*?environment: ota-production[\s\S]*?AIDE_UPDATE_HEALTH_ENDPOINT: \$\{\{ vars\.AIDE_UPDATE_HEALTH_ENDPOINT \}\}/,
  )
  assert.match(workflow, /node scripts\/validate-packaged-update-config\.mjs/)
  assert.match(
    workflow,
    /linux-x64:[\s\S]*?AIDE_UPDATE_HEALTH_ENDPOINT: \$\{\{ needs\.validate-release\.outputs\.health_endpoint \}\}/,
  )
  assert.match(
    workflow,
    /macos:[\s\S]*?AIDE_UPDATE_HEALTH_ENDPOINT: \$\{\{ needs\.validate-release\.outputs\.health_endpoint \}\}/,
  )
})

test('health endpoint validation rejects provider defaults and ambiguous DNS forms', () => {
  assert.equal(
    validateUpdateHealthEndpoint(
      'https://health.example.com/v1/ota-health/events',
    ),
    'https://health.example.com/v1/ota-health/events',
  )
  for (const hostname of [
    'workers.dev',
    'tenant.workers.dev',
    'r2.dev',
    'bucket.r2.dev',
    'tenant.workers.dev.',
    'bucket.r2.dev.',
  ]) {
    assert.equal(
      validateUpdateHealthEndpoint(`https://${hostname}/v1/ota-health/events`),
      null,
    )
  }
})
