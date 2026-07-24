import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const distributablePattern = /(?:\.AppImage|\.tar\.gz|\.dmg|\.zip)$/

async function sha256(file) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk)
  }
  return hash.digest('hex')
}

export async function writeChecksums(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const artifacts = entries
    .filter((entry) => entry.isFile() && distributablePattern.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  if (artifacts.length === 0) {
    throw new Error(`No distributable artifacts found in ${directory}.`)
  }

  const contents = await Promise.all(
    artifacts.map(async (artifact) => {
      const digest = await sha256(resolve(directory, artifact))
      return `${digest}  ${artifact}`
    }),
  )
  const destination = resolve(directory, 'SHA256SUMS')
  const temporary = `${destination}.tmp`

  await writeFile(temporary, `${contents.join('\n')}\n`, 'utf8')
  await rename(temporary, destination)
  return artifacts
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const directory = resolve(process.cwd(), process.argv[2] ?? 'dist')
  const artifacts = await writeChecksums(directory)
  console.log(`Wrote SHA-256 checksums for ${artifacts.length} artifact(s).`)
}
