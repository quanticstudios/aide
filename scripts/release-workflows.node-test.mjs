import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import test from 'node:test'

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
