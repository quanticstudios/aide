import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'

export const RELEASE_ENVELOPE_SCHEMA_VERSION = 1
export const AIDE_RELEASE_PRODUCT_ID = 'studio.quantic.aide'

export type ReleasePlatform = 'darwin' | 'linux'
export type ReleaseArch = 'arm64' | 'x64'
export type ReleaseUrgency = 'critical' | 'normal'
export type ReleaseRolloutPercentage = 10 | 50 | 100

export interface ReleaseFile {
  readonly sha256: string
  readonly url: string
}

export interface ReleaseArtifact extends ReleaseFile {
  readonly sha512: string
  readonly size: number
}

/** The exact, detached-signature payload published for one platform target. */
export interface ReleaseEnvelope {
  readonly arch: ReleaseArch
  readonly artifact: ReleaseArtifact
  readonly channel: 'stable'
  readonly feed: ReleaseFile
  readonly keyId: string
  readonly platform: ReleasePlatform
  readonly productId: typeof AIDE_RELEASE_PRODUCT_ID
  readonly publishedAt: string
  readonly revokedVersions: readonly string[]
  readonly rolloutPercentage: ReleaseRolloutPercentage
  readonly schemaVersion: typeof RELEASE_ENVELOPE_SCHEMA_VERSION
  readonly urgency: ReleaseUrgency
  readonly version: string
}

export interface ReleaseEligibilityInput {
  readonly allowedOrigin: string
  readonly allowInsecureTestOrigin?: boolean
  readonly arch: ReleaseArch
  readonly currentVersion: string
  readonly installationId: string
  readonly platform: ReleasePlatform
}

export type ReleaseEnvelopeErrorCode =
  | 'artifact-digest-mismatch'
  | 'artifact-size-mismatch'
  | 'invalid-envelope'
  | 'invalid-origin'
  | 'invalid-signature'
  | 'not-eligible'
  | 'noncanonical-envelope'
  | 'unknown-key'

export class ReleaseEnvelopeError extends Error {
  public constructor(
    public readonly code: ReleaseEnvelopeErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ReleaseEnvelopeError'
  }
}

const stableSemverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const sha256Pattern = /^[a-f0-9]{64}$/
const sha512Pattern = /^[a-f0-9]{128}$/
const keyIdPattern = /^[a-z0-9][a-z0-9._-]{0,63}$/
const releasePlatforms = new Set<ReleasePlatform>(['darwin', 'linux'])
const releaseArchitectures = new Set<ReleaseArch>(['arm64', 'x64'])
const urgencyValues = new Set<ReleaseUrgency>(['critical', 'normal'])
const rolloutValues = new Set<ReleaseRolloutPercentage>([10, 50, 100])

function invalidEnvelope(message: string): never {
  throw new ReleaseEnvelopeError('invalid-envelope', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) {
    invalidEnvelope(`${name} must be an object.`)
  }
  return value
}

function expectExactKeys(
  value: Record<string, unknown>,
  name: string,
  keys: readonly string[],
): void {
  const actual = Object.keys(value).sort()
  const expected = [...keys].sort()
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    invalidEnvelope(`${name} contains unsupported or missing fields.`)
  }
}

function expectString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    invalidEnvelope(`${name} must be a string.`)
  }
  return value
}

function expectStableSemver(value: unknown, name: string): string {
  const version = expectString(value, name)
  if (!stableSemverPattern.test(version)) {
    invalidEnvelope(`${name} must be a stable SemVer version.`)
  }
  return version
}

function expectDigest(value: unknown, name: string, pattern: RegExp): string {
  const digest = expectString(value, name)
  if (!pattern.test(digest)) {
    invalidEnvelope(`${name} must be a lowercase hexadecimal digest.`)
  }
  return digest
}

function expectIsoTimestamp(value: unknown): string {
  const timestamp = expectString(value, 'publishedAt')
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    invalidEnvelope('publishedAt must be a canonical ISO-8601 timestamp.')
  }
  return timestamp
}

function expectUrl(value: unknown, name: string): string {
  const url = expectString(value, name)
  if (url.length > 2_048) {
    invalidEnvelope(`${name} is too long.`)
  }
  try {
    const parsed = new URL(url)
    if (
      (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.href !== url
    ) {
      invalidEnvelope(`${name} must be a normalized credential-free URL.`)
    }
  } catch {
    invalidEnvelope(`${name} must be a URL.`)
  }
  return url
}

function parseReleaseFile(value: unknown, name: string): ReleaseFile {
  const file = expectRecord(value, name)
  expectExactKeys(file, name, ['sha256', 'url'])
  return {
    sha256: expectDigest(file.sha256, `${name}.sha256`, sha256Pattern),
    url: expectUrl(file.url, `${name}.url`),
  }
}

function parseReleaseArtifact(value: unknown): ReleaseArtifact {
  const artifact = expectRecord(value, 'artifact')
  expectExactKeys(artifact, 'artifact', ['sha256', 'sha512', 'size', 'url'])
  const size = artifact.size
  if (!Number.isSafeInteger(size) || typeof size !== 'number' || size < 1) {
    invalidEnvelope('artifact.size must be a positive safe integer.')
  }
  return {
    sha256: expectDigest(artifact.sha256, 'artifact.sha256', sha256Pattern),
    sha512: expectDigest(artifact.sha512, 'artifact.sha512', sha512Pattern),
    size,
    url: expectUrl(artifact.url, 'artifact.url'),
  }
}

/** Parses the strict schema but does not trust its signature or release eligibility. */
export function parseReleaseEnvelope(value: unknown): ReleaseEnvelope {
  const envelope = expectRecord(value, 'release envelope')
  expectExactKeys(envelope, 'release envelope', [
    'arch',
    'artifact',
    'channel',
    'feed',
    'keyId',
    'platform',
    'productId',
    'publishedAt',
    'revokedVersions',
    'rolloutPercentage',
    'schemaVersion',
    'urgency',
    'version',
  ])
  if (envelope.schemaVersion !== RELEASE_ENVELOPE_SCHEMA_VERSION) {
    invalidEnvelope('Unsupported release envelope schema version.')
  }
  if (envelope.productId !== AIDE_RELEASE_PRODUCT_ID) {
    invalidEnvelope('Unexpected release product ID.')
  }
  if (envelope.channel !== 'stable') {
    invalidEnvelope('Only the stable update channel is supported.')
  }
  if (
    typeof envelope.platform !== 'string' ||
    !releasePlatforms.has(envelope.platform as ReleasePlatform)
  ) {
    invalidEnvelope('platform must be linux or darwin.')
  }
  if (
    typeof envelope.arch !== 'string' ||
    !releaseArchitectures.has(envelope.arch as ReleaseArch)
  ) {
    invalidEnvelope('arch must be x64 or arm64.')
  }
  if (
    typeof envelope.urgency !== 'string' ||
    !urgencyValues.has(envelope.urgency as ReleaseUrgency)
  ) {
    invalidEnvelope('urgency must be normal or critical.')
  }
  if (
    !rolloutValues.has(envelope.rolloutPercentage as ReleaseRolloutPercentage)
  ) {
    invalidEnvelope('rolloutPercentage must be 10, 50, or 100.')
  }
  const keyId = expectString(envelope.keyId, 'keyId')
  if (!keyIdPattern.test(keyId)) {
    invalidEnvelope('keyId has an unsupported format.')
  }
  if (!Array.isArray(envelope.revokedVersions)) {
    invalidEnvelope('revokedVersions must be an array.')
  }
  const revokedVersions = envelope.revokedVersions.map((version) =>
    expectStableSemver(version, 'revokedVersions entry'),
  )
  if (new Set(revokedVersions).size !== revokedVersions.length) {
    invalidEnvelope('revokedVersions must not contain duplicates.')
  }

  return {
    arch: envelope.arch as ReleaseArch,
    artifact: parseReleaseArtifact(envelope.artifact),
    channel: 'stable',
    feed: parseReleaseFile(envelope.feed, 'feed'),
    keyId,
    platform: envelope.platform as ReleasePlatform,
    productId: AIDE_RELEASE_PRODUCT_ID,
    publishedAt: expectIsoTimestamp(envelope.publishedAt),
    revokedVersions,
    rolloutPercentage: envelope.rolloutPercentage as ReleaseRolloutPercentage,
    schemaVersion: RELEASE_ENVELOPE_SCHEMA_VERSION,
    urgency: envelope.urgency as ReleaseUrgency,
    version: expectStableSemver(envelope.version, 'version'),
  }
}

function canonicalize(value: unknown): string {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number'
  ) {
    return JSON.stringify(value)
  }
  if (typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(',')}]`
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(',')}}`
  }
  invalidEnvelope('Release envelope contains an unsupported value.')
}

/** Returns the exact UTF-8 bytes that must be detached-signed. */
export function canonicalizeReleaseEnvelope(value: unknown): Buffer {
  const envelope = parseReleaseEnvelope(value)
  return Buffer.from(canonicalize(envelope), 'utf8')
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && timingSafeEqual(left, right)
}

/** Verifies an Ed25519 signature over canonical raw envelope bytes. */
export function parseAndVerifyReleaseEnvelope(
  rawEnvelope: Uint8Array,
  signature: Uint8Array,
  keyring: Readonly<Record<string, string>>,
): ReleaseEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(rawEnvelope),
    )
  } catch {
    throw new ReleaseEnvelopeError(
      'invalid-envelope',
      'Release envelope is not valid UTF-8 JSON.',
    )
  }
  const envelope = parseReleaseEnvelope(parsed)
  const canonical = canonicalizeReleaseEnvelope(envelope)
  if (!bytesEqual(rawEnvelope, canonical)) {
    throw new ReleaseEnvelopeError(
      'noncanonical-envelope',
      'Release envelope bytes are not canonical.',
    )
  }
  const publicKeyPem = keyring[envelope.keyId]
  if (!publicKeyPem) {
    throw new ReleaseEnvelopeError(
      'unknown-key',
      'Release envelope signing key is unknown.',
    )
  }
  try {
    const publicKey = createPublicKey(publicKeyPem)
    if (publicKey.asymmetricKeyType !== 'ed25519') {
      throw new Error('not Ed25519')
    }
    if (!verify(null, rawEnvelope, publicKey, signature)) {
      throw new Error('signature did not verify')
    }
  } catch {
    throw new ReleaseEnvelopeError(
      'invalid-signature',
      'Release envelope signature is invalid.',
    )
  }
  return envelope
}

function parseStableSemver(version: string): readonly [bigint, bigint, bigint] {
  const match = stableSemverPattern.exec(version)
  if (!match) {
    invalidEnvelope('Version must be stable SemVer.')
  }
  return [BigInt(match[1]), BigInt(match[2]), BigInt(match[3])]
}

export function compareStableSemver(left: string, right: string): number {
  const leftParts = parseStableSemver(left)
  const rightParts = parseStableSemver(right)
  for (let index = 0; index < leftParts.length; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1
    if (leftParts[index] < rightParts[index]) return -1
  }
  return 0
}

export function cohortForInstallation(
  installationId: string,
  targetVersion: string,
): number {
  if (!installationId || installationId.length > 256) {
    invalidEnvelope('installationId must be between 1 and 256 characters.')
  }
  expectStableSemver(targetVersion, 'targetVersion')
  const digest = createHash('sha256')
    .update(installationId, 'utf8')
    .update(targetVersion, 'utf8')
    .digest()
  return digest.readUInt32BE(0) % 100
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  )
}

function parseAllowedOrigin(
  value: string,
  allowInsecureTestOrigin: boolean,
): URL {
  let origin: URL
  try {
    origin = new URL(value)
  } catch {
    throw new ReleaseEnvelopeError(
      'invalid-origin',
      'Update origin must be a URL.',
    )
  }
  const isAllowedTestOrigin =
    allowInsecureTestOrigin &&
    origin.protocol === 'http:' &&
    isLoopbackHost(origin.hostname)
  if (origin.protocol !== 'https:' && !isAllowedTestOrigin) {
    throw new ReleaseEnvelopeError(
      'invalid-origin',
      'Update origin must use HTTPS.',
    )
  }
  if (
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new ReleaseEnvelopeError(
      'invalid-origin',
      'Update origin must be a bare origin.',
    )
  }
  return origin
}

function assertSameAllowedOrigin(
  value: string,
  expectedOrigin: URL,
  allowInsecureTestOrigin: boolean,
): void {
  const url = new URL(value)
  const insecureLoopback =
    allowInsecureTestOrigin &&
    url.protocol === 'http:' &&
    isLoopbackHost(url.hostname)
  if (
    (url.protocol !== 'https:' && !insecureLoopback) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.origin !== expectedOrigin.origin
  ) {
    throw new ReleaseEnvelopeError(
      'invalid-origin',
      'Release URL is not on the allowed origin.',
    )
  }
}

/** Applies local platform, origin, version, revocation, and rollout policy. */
export function validateReleaseEligibility(
  envelope: ReleaseEnvelope,
  input: ReleaseEligibilityInput,
): true {
  const expectedOrigin = parseAllowedOrigin(
    input.allowedOrigin,
    input.allowInsecureTestOrigin === true,
  )
  if (envelope.platform !== input.platform || envelope.arch !== input.arch) {
    throw new ReleaseEnvelopeError(
      'not-eligible',
      'Release target does not match this application.',
    )
  }
  assertSameAllowedOrigin(
    envelope.feed.url,
    expectedOrigin,
    input.allowInsecureTestOrigin === true,
  )
  assertSameAllowedOrigin(
    envelope.artifact.url,
    expectedOrigin,
    input.allowInsecureTestOrigin === true,
  )
  if (envelope.revokedVersions.includes(envelope.version)) {
    throw new ReleaseEnvelopeError(
      'not-eligible',
      'Release version is revoked.',
    )
  }
  if (compareStableSemver(envelope.version, input.currentVersion) <= 0) {
    throw new ReleaseEnvelopeError(
      'not-eligible',
      'Release must be newer than the installed version.',
    )
  }
  if (
    cohortForInstallation(input.installationId, envelope.version) >=
    envelope.rolloutPercentage
  ) {
    throw new ReleaseEnvelopeError(
      'not-eligible',
      'Release is not in this installation cohort.',
    )
  }
  return true
}

/** Streams and checks an already-downloaded artifact before it can be installed. */
export async function verifyArtifactDigest(
  artifactPath: string,
  expected: Pick<ReleaseArtifact, 'sha256' | 'sha512' | 'size'>,
): Promise<void> {
  const metadata = await stat(artifactPath)
  if (metadata.size !== expected.size) {
    throw new ReleaseEnvelopeError(
      'artifact-size-mismatch',
      'Downloaded artifact size does not match.',
    )
  }
  const sha256 = createHash('sha256')
  const sha512 = createHash('sha512')
  for await (const chunk of createReadStream(artifactPath)) {
    sha256.update(chunk)
    sha512.update(chunk)
  }
  const actualSha256 = Buffer.from(sha256.digest('hex'), 'utf8')
  const actualSha512 = Buffer.from(sha512.digest('hex'), 'utf8')
  if (
    !bytesEqual(actualSha256, Buffer.from(expected.sha256, 'utf8')) ||
    !bytesEqual(actualSha512, Buffer.from(expected.sha512, 'utf8'))
  ) {
    throw new ReleaseEnvelopeError(
      'artifact-digest-mismatch',
      'Downloaded artifact digest does not match.',
    )
  }
}
