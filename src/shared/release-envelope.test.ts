import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rename, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  canonicalizeReleaseEnvelope,
  cohortForInstallation,
  ED25519_SIGNATURE_BYTES,
  MAX_RELEASE_ENVELOPE_BYTES,
  MAX_RELEASE_FEED_BYTES,
  parseAndVerifyReleaseEnvelope,
  type ReleaseEnvelope,
  ReleaseEnvelopeError,
  releaseFileMatchesIdentity,
  validateReleaseEligibility,
  verifyArtifactDigest,
  verifyReleaseFileDigest,
} from './release-envelope'

const TEST_ORIGIN = 'http://127.0.0.1:43123'

function createEnvelope(
  changes: Partial<ReleaseEnvelope> = {},
): ReleaseEnvelope {
  return {
    arch: 'x64',
    artifact: {
      sha256: 'a'.repeat(64),
      sha512: 'b'.repeat(128),
      size: 42,
      url: `${TEST_ORIGIN}/releases/v0.2.1/Aide-0.2.1-linux-x64.AppImage`,
    },
    channel: 'stable',
    feed: {
      sha256: 'c'.repeat(64),
      url: `${TEST_ORIGIN}/releases/v0.2.1/latest-linux.yml`,
    },
    keyId: 'test-2026-01',
    platform: 'linux',
    productId: 'studio.quantic.aide',
    publishedAt: '2026-07-24T00:00:00.000Z',
    revokedVersions: [],
    rolloutPercentage: 100,
    schemaVersion: 1,
    urgency: 'normal',
    version: '0.2.1',
    ...changes,
  }
}

function signedEnvelope(envelope = createEnvelope()) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const payload = canonicalizeReleaseEnvelope(envelope)
  const signature = sign(null, payload, privateKey)

  return {
    payload,
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    signature,
  }
}

describe('release envelopes', () => {
  it('verifies exact canonical bytes with the declared Ed25519 key', () => {
    const { payload, publicKeyPem, signature } = signedEnvelope()

    expect(
      parseAndVerifyReleaseEnvelope(payload, signature, {
        'test-2026-01': publicKeyPem,
      }),
    ).toMatchObject({ version: '0.2.1', productId: 'studio.quantic.aide' })
  })

  it('rejects malformed, enriched, noncanonical, and tampered envelopes', () => {
    const { payload, publicKeyPem, signature } = signedEnvelope()
    const enriched = Buffer.from(
      `${payload.subarray(0, -1).toString('utf8')},"unexpected":true}`,
    )
    const reordered = Buffer.from(
      JSON.stringify({
        version: '0.2.1',
        ...JSON.parse(payload.toString('utf8')),
      }),
    )
    const alteredSignature = Buffer.from(signature)
    alteredSignature[0] ^= 1

    for (const [candidate, candidateSignature] of [
      [enriched, signature],
      [reordered, signature],
      [payload, alteredSignature],
      [Buffer.from('{not JSON}'), signature],
    ] as const) {
      expect(() =>
        parseAndVerifyReleaseEnvelope(candidate, candidateSignature, {
          'test-2026-01': publicKeyPem,
        }),
      ).toThrow(ReleaseEnvelopeError)
    }
  })

  it('rejects oversized untrusted bytes before decoding or verification', () => {
    const { payload, publicKeyPem } = signedEnvelope()

    expect(() =>
      parseAndVerifyReleaseEnvelope(
        Buffer.alloc(MAX_RELEASE_ENVELOPE_BYTES + 1, 0x7b),
        Buffer.alloc(ED25519_SIGNATURE_BYTES),
        { 'test-2026-01': publicKeyPem },
      ),
    ).toThrow(/too large/i)
    expect(() =>
      parseAndVerifyReleaseEnvelope(
        payload,
        Buffer.alloc(ED25519_SIGNATURE_BYTES + 1),
        { 'test-2026-01': publicKeyPem },
      ),
    ).toThrow(/64 bytes/i)
  })

  it('bounds semantic version digits and the revocation list', () => {
    expect(() =>
      canonicalizeReleaseEnvelope(
        createEnvelope({ version: `${'9'.repeat(11)}.0.0` }),
      ),
    ).toThrow(/SemVer/i)
    expect(() =>
      canonicalizeReleaseEnvelope(
        createEnvelope({
          revokedVersions: Array.from(
            { length: 101 },
            (_, index) => `1.0.${index}`,
          ),
        }),
      ),
    ).toThrow(/at most 100/i)
    expect(() =>
      canonicalizeReleaseEnvelope(createEnvelope({ keyId: 'k'.repeat(65) })),
    ).toThrow(/keyId/i)
    expect(() =>
      canonicalizeReleaseEnvelope(
        createEnvelope({ publishedAt: '2'.repeat(1_024) }),
      ),
    ).toThrow(/publishedAt/i)
  })

  it('rejects unknown keys and unsupported release fields before accepting a signature', () => {
    const { payload, signature } = signedEnvelope()

    expect(() => parseAndVerifyReleaseEnvelope(payload, signature, {})).toThrow(
      /key/i,
    )
  })

  it('accepts only eligible newer stable releases from the injected test origin', () => {
    const release = createEnvelope()

    expect(
      validateReleaseEligibility(release, {
        allowInsecureTestOrigin: true,
        allowedOrigin: TEST_ORIGIN,
        arch: 'x64',
        currentVersion: '0.2.0',
        installationId: 'installation-a',
        platform: 'linux',
      }),
    ).toBe(true)

    for (const envelope of [
      createEnvelope({ version: '0.2.0' }),
      createEnvelope({ version: '0.1.9' }),
      createEnvelope({ version: '0.2.1-beta.1' }),
      createEnvelope({ revokedVersions: ['0.2.1'] }),
      createEnvelope({
        artifact: { ...release.artifact, url: 'https://evil.invalid/a' },
      }),
      createEnvelope({ platform: 'darwin' }),
    ]) {
      expect(() =>
        validateReleaseEligibility(envelope, {
          allowInsecureTestOrigin: true,
          allowedOrigin: TEST_ORIGIN,
          arch: 'x64',
          currentVersion: '0.2.0',
          installationId: 'installation-a',
          platform: 'linux',
        }),
      ).toThrow(ReleaseEnvelopeError)
    }
  })

  it('requires HTTPS production origins and rejects credentials, queries, and fragments', () => {
    expect(() =>
      validateReleaseEligibility(createEnvelope(), {
        allowedOrigin: TEST_ORIGIN,
        arch: 'x64',
        currentVersion: '0.2.0',
        installationId: 'installation-a',
        platform: 'linux',
      }),
    ).toThrow(/HTTPS/i)

    const envelope = createEnvelope({
      artifact: {
        ...createEnvelope().artifact,
        url: 'https://user:secret@updates.example.test/release?token=secret',
      },
      feed: {
        ...createEnvelope().feed,
        url: 'https://updates.example.test/latest.yml#fragment',
      },
    })

    expect(() =>
      validateReleaseEligibility(envelope, {
        allowedOrigin: 'https://updates.example.test',
        arch: 'x64',
        currentVersion: '0.2.0',
        installationId: 'installation-a',
        platform: 'linux',
      }),
    ).toThrow(ReleaseEnvelopeError)
  })

  it('assigns installations to a deterministic [0, 99] rollout cohort', () => {
    const first = cohortForInstallation('installation-a', '0.2.1')

    expect(first).toBe(cohortForInstallation('installation-a', '0.2.1'))
    expect(first).toBeGreaterThanOrEqual(0)
    expect(first).toBeLessThan(100)
    expect(cohortForInstallation('installation-b', '0.2.1')).not.toBe(first)
  })

  it('enforces the signed rollout boundary', () => {
    const installationId = Array.from(
      { length: 1_000 },
      (_, index) => `installation-${index}`,
    ).find((candidate) => {
      const cohort = cohortForInstallation(candidate, '0.2.1')
      return cohort >= 10 && cohort < 50
    })

    expect(installationId).toBeDefined()
    const input = {
      allowInsecureTestOrigin: true,
      allowedOrigin: TEST_ORIGIN,
      arch: 'x64' as const,
      currentVersion: '0.2.0',
      installationId: installationId as string,
      platform: 'linux' as const,
    }

    expect(() =>
      validateReleaseEligibility(
        createEnvelope({ rolloutPercentage: 10 }),
        input,
      ),
    ).toThrow(/cohort/i)
    expect(
      validateReleaseEligibility(
        createEnvelope({ rolloutPercentage: 50 }),
        input,
      ),
    ).toBe(true)
  })

  it('checks both expected artifact digests and size through one file identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aide-envelope-'))
    const artifact = join(directory, 'artifact.bin')
    await writeFile(artifact, 'release payload')

    const identity = await verifyArtifactDigest(artifact, {
      sha256:
        'd11a02dfb3d8dfdc9229678b67f948c32aabeb9e5d409434b171cd7e5275774f',
      sha512:
        '52f462270a45b78c9494256e3af98ca81b5fccf3d3ab4c2faedbf3e1c58806597077a8975a02135559c2488d9913e7c7a10ceae64dc6bcdf2f1a4a4966c81bef',
      size: 15,
    })

    expect(identity.size).toBe(15)
    await expect(releaseFileMatchesIdentity(artifact, identity)).resolves.toBe(
      true,
    )

    await expect(
      verifyArtifactDigest(artifact, {
        sha256: '0'.repeat(64),
        sha512: '0'.repeat(128),
        size: 15,
      }),
    ).rejects.toThrow(/digest/i)
  })

  it('verifies bounded feed metadata before updater consumption', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aide-feed-'))
    const feed = join(directory, 'latest-linux.yml')
    const contents = Buffer.from('version: 0.2.1\npath: Aide.AppImage\n')
    await writeFile(feed, contents)
    const digest = createHash('sha256').update(contents).digest('hex')

    await expect(verifyReleaseFileDigest(feed, digest)).resolves.toMatchObject({
      size: contents.byteLength,
    })
    await expect(verifyReleaseFileDigest(feed, '0'.repeat(64))).rejects.toThrow(
      /digest/i,
    )

    await writeFile(feed, Buffer.alloc(MAX_RELEASE_FEED_BYTES + 1))
    await expect(verifyReleaseFileDigest(feed, digest)).rejects.toThrow(
      /too large/i,
    )
  })

  it('rejects symlinks and detects path replacement after verification', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'aide-identity-'))
    const artifact = join(directory, 'artifact.bin')
    const symlinkPath = join(directory, 'artifact-link.bin')
    const replacement = join(directory, 'replacement.bin')
    const contents = Buffer.from('release payload')
    const expected = {
      sha256: createHash('sha256').update(contents).digest('hex'),
      sha512: createHash('sha512').update(contents).digest('hex'),
      size: contents.byteLength,
    }
    await writeFile(artifact, contents)
    await symlink(artifact, symlinkPath)

    await expect(verifyArtifactDigest(symlinkPath, expected)).rejects.toThrow(
      /regular file|symbolic link/i,
    )

    const identity = await verifyArtifactDigest(artifact, expected)
    await writeFile(replacement, contents)
    await rename(replacement, artifact)

    await expect(releaseFileMatchesIdentity(artifact, identity)).resolves.toBe(
      false,
    )
  })
})
