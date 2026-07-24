import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

function argument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`)
  return value
}

async function sha512Base64(file) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest('base64')
}

export async function writeUpdaterMetadata({
  arch,
  directory,
  platform,
  version,
}) {
  if (
    !['linux', 'darwin'].includes(platform) ||
    !['x64', 'arm64'].includes(arch)
  ) {
    throw new Error(
      'Updater metadata requires a supported platform and architecture.',
    )
  }
  const artifact =
    platform === 'linux'
      ? `Aide-${version}-linux-x86_64.AppImage`
      : `Aide-${version}-mac-${arch}.zip`
  const source = resolve(directory, artifact)
  const details = await stat(source)
  if (!details.isFile() || details.size < 1)
    throw new Error(`Missing updater artifact ${artifact}.`)
  const sha512 = await sha512Base64(source)
  const blockMapSize =
    platform === 'darwin'
      ? (await stat(resolve(directory, `${artifact}.blockmap`))).size
      : undefined
  const contents = [
    `version: ${version}`,
    'files:',
    `  - url: ${artifact}`,
    `    sha512: ${sha512}`,
    `    size: ${details.size}`,
    ...(blockMapSize === undefined
      ? []
      : [`    blockMapSize: ${blockMapSize}`]),
    `path: ${artifact}`,
    `sha512: ${sha512}`,
    'releaseDate: 1970-01-01T00:00:00.000Z',
    '',
  ].join('\n')
  const output = resolve(
    directory,
    platform === 'linux' ? 'latest-linux.yml' : 'latest-mac.yml',
  )
  await writeFile(output, contents, 'utf8')
  return output
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const root = resolve(import.meta.dirname, '..')
  const packageJson = JSON.parse(
    await readFile(resolve(root, 'package.json'), 'utf8'),
  )
  await writeUpdaterMetadata({
    arch: argument('--arch'),
    directory: resolve(argument('--directory')),
    platform: argument('--platform'),
    version: packageJson.version,
  })
}
