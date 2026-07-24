import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { parseAndVerifyReleaseEnvelope } from '../src/shared/release-envelope'

function argument(name: string): string {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv.at(index + 1)
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing ${name}.`)
  }
  return value
}

const envelopePath = resolve(process.cwd(), argument('--envelope'))
const signaturePath = resolve(process.cwd(), argument('--signature'))
const publicKeyPath = resolve(process.cwd(), argument('--public-key'))
const keyId = argument('--key-id')
const envelope = parseAndVerifyReleaseEnvelope(
  await readFile(envelopePath),
  await readFile(signaturePath),
  { [keyId]: await readFile(publicKeyPath, 'utf8') },
)

console.log(`Verified release envelope ${envelope.version}.`)
