// Vendors pitwall's web protocol conformance fixtures (its testdata/web-protocol) into fixtures/web-protocol.
// node scripts/vendor-web-protocol.mjs [--check] [--ref <pitwall git ref>]
// Without --check it downloads SHA256SUMS and every file it lists, and writes them only when each checksum matches.
// With --check it exits 1 when the vendored copy differs from the ref's SHA256SUMS or from its own.
import { createHash } from 'node:crypto'
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { fileURLToPath } from 'node:url'

const target = fileURLToPath(
  new URL('../fixtures/web-protocol/', import.meta.url),
)
const args = process.argv.slice(2)
const check = args.includes('--check')
const ref = args.includes('--ref') ? args[args.indexOf('--ref') + 1] : 'main'
const source = `https://raw.githubusercontent.com/quanticstudios/pitwall/${ref}/testdata/web-protocol/`

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** Parses `sha256sum` output into [name, hex] pairs, refusing names that could leave the fixture folder. */
function parseSums(text) {
  return text
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const match = /^([0-9a-f]{64}) {2}([\w .-]+\.json)$/.exec(line)
      if (!match) throw new Error(`bad SHA256SUMS line: ${line}`)
      return [match[2], match[1]]
    })
}

async function download(name) {
  const response = await fetch(source + encodeURIComponent(name))
  if (!response.ok) throw new Error(`${source}${name}: ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function localProblems(sums) {
  const listed = new Map(parseSums(sums))
  const problems = []
  for (const name of readdirSync(target).filter((n) => n.endsWith('.json'))) {
    if (!listed.has(name)) problems.push(`${name} is not in SHA256SUMS`)
  }
  for (const [name, hex] of listed) {
    let bytes
    try {
      bytes = readFileSync(target + name)
    } catch {
      problems.push(`${name} is missing`)
      continue
    }
    if (sha256(bytes) !== hex)
      problems.push(`${name} does not match SHA256SUMS`)
  }
  return problems
}

const sums = (await download('SHA256SUMS')).toString('utf8')
if (check) {
  let local = ''
  try {
    local = readFileSync(`${target}SHA256SUMS`, 'utf8')
  } catch {}
  const problems = localProblems(local)
  if (local !== sums) problems.unshift(`SHA256SUMS differs from pitwall ${ref}`)
  if (problems.length > 0) {
    console.error(
      `fixtures/web-protocol is stale:\n  ${problems.join('\n  ')}\nRun bun run vendor:web-protocol and commit the result.`,
    )
    process.exit(1)
  }
  console.log(`fixtures/web-protocol matches pitwall ${ref}`)
} else {
  const files = []
  for (const [name, hex] of parseSums(sums)) {
    const bytes = await download(name)
    if (sha256(bytes) !== hex) throw new Error(`${name}: checksum mismatch`)
    files.push([name, bytes])
  }
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(target).filter((n) => n.endsWith('.json'))) {
    rmSync(target + name)
  }
  for (const [name, bytes] of files) writeFileSync(target + name, bytes)
  writeFileSync(`${target}SHA256SUMS`, sums)
  console.log(`vendored ${files.length} fixtures from pitwall ${ref}`)
}
