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

const inputPath = resolve(process.cwd(), argument('--input'))
const outputPath = resolve(process.cwd(), argument('--output'))
const input = JSON.parse(await readFile(inputPath, 'utf8'))
const envelope = canonicalizeReleaseEnvelope(input)

await writeFile(outputPath, envelope)
console.log(`Wrote canonical release envelope to ${outputPath}.`)
