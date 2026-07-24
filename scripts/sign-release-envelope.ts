import { createPrivateKey, randomUUID, sign } from 'node:crypto'
import {
  type FileHandle,
  link,
  open,
  readFile,
  realpath,
  unlink,
} from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { canonicalizeReleaseEnvelope } from '../src/shared/release-envelope'

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv.at(index + 1)
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing ${name}.`)
  }
  return value
}

const envelopePath = resolve(process.cwd(), argument('--envelope'))
const privateKeyPath = resolve(process.cwd(), argument('--private-key'))
const signaturePath = resolve(process.cwd(), argument('--signature'))
const [canonicalEnvelopePath, canonicalPrivateKeyPath, signatureDirectory] =
  await Promise.all([
    realpath(envelopePath),
    realpath(privateKeyPath),
    realpath(dirname(signaturePath)),
  ])
const canonicalSignaturePath = join(signatureDirectory, basename(signaturePath))

if (
  canonicalSignaturePath === canonicalEnvelopePath ||
  canonicalSignaturePath === canonicalPrivateKeyPath
) {
  throw new Error('Signature output must not collide with an input file.')
}

try {
  const existingSignaturePath = await realpath(canonicalSignaturePath)
  if (
    existingSignaturePath === canonicalEnvelopePath ||
    existingSignaturePath === canonicalPrivateKeyPath
  ) {
    throw new Error('Signature output must not collide with an input file.')
  }
  throw new Error('Signature output already exists.')
} catch (error) {
  if (
    error instanceof Error &&
    (error.message.includes('collide') ||
      error.message.includes('already exists'))
  ) {
    throw error
  }
  if (
    typeof error !== 'object' ||
    error === null ||
    !('code' in error) ||
    error.code !== 'ENOENT'
  ) {
    throw error
  }
}

const rawEnvelope = await readFile(envelopePath)
const parsedEnvelope = JSON.parse(rawEnvelope.toString('utf8'))
const canonicalEnvelope = canonicalizeReleaseEnvelope(parsedEnvelope)

if (!rawEnvelope.equals(canonicalEnvelope)) {
  throw new Error('Envelope must be canonical before signing.')
}

const privateKey = createPrivateKey(await readFile(privateKeyPath, 'utf8'))
if (privateKey.asymmetricKeyType !== 'ed25519') {
  throw new Error('Private key must be an Ed25519 key.')
}

const signature = sign(null, rawEnvelope, privateKey)
const temporaryPath = join(
  signatureDirectory,
  `.${basename(signaturePath)}.tmp-${randomUUID()}`,
)
let temporaryHandle: FileHandle | null = null

try {
  temporaryHandle = await open(temporaryPath, 'wx', 0o600)
  await temporaryHandle.writeFile(signature)
  await temporaryHandle.sync()
  await temporaryHandle.close()
  temporaryHandle = null
  await link(temporaryPath, canonicalSignaturePath)
} catch (error) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  ) {
    throw new Error('Signature output already exists.')
  }
  throw error
} finally {
  await temporaryHandle?.close()
  await unlink(temporaryPath).catch((error: unknown) => {
    if (
      typeof error !== 'object' ||
      error === null ||
      !('code' in error) ||
      error.code !== 'ENOENT'
    ) {
      throw error
    }
  })
}

console.log(`Wrote detached release signature to ${canonicalSignaturePath}.`)
