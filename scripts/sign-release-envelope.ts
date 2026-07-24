import { createPrivateKey, sign } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

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

await writeFile(signaturePath, sign(null, rawEnvelope, privateKey))
console.log(`Wrote detached release signature to ${signaturePath}.`)
