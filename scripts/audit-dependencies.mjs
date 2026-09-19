import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const MAX_ATTEMPTS = 5

// why: bun exits 1 for a registry transport failure and for a real advisory alike, and its outage wording differs across bun versions.
const REGISTRY_FAILURE_PATTERN =
  /audit request failed \(status 5\d\d\)|error: [A-Z]+ https?:\/\/\S+ - 5\d\d|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|socket connection|fetch failed/i

/** Classifies one `bun audit` run as clean, advisory-blocking, or a registry outage. */
export function classifyAuditOutcome({ exitCode, output }) {
  if (exitCode === 0) return 'clean'
  if (REGISTRY_FAILURE_PATTERN.test(output ?? '')) return 'registry-unavailable'
  return 'advisories'
}

/** Returns the backoff in milliseconds before retrying a failed audit attempt. */
export function backoffDelayMs(attempt) {
  return 1000 * 2 ** (attempt - 1)
}

/** Maps an audit outcome to the process exit code, treating a registry outage as non-blocking. */
export function exitCodeForOutcome(outcome) {
  return outcome === 'advisories' ? 1 : 0
}

/** Runs the audit, retrying only while the advisory registry itself is unavailable. */
export async function auditDependencies({
  runAudit,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxAttempts = MAX_ATTEMPTS,
}) {
  let result = { exitCode: 1, output: '' }
  let outcome = 'registry-unavailable'

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    result = await runAudit(attempt)
    outcome = classifyAuditOutcome(result)
    if (outcome !== 'registry-unavailable') {
      return { attempts: attempt, outcome, output: result.output }
    }
    if (attempt < maxAttempts) await sleep(backoffDelayMs(attempt))
  }

  return { attempts: maxAttempts, outcome, output: result.output }
}

function runBunAudit() {
  const audit = spawnSync('bun', ['audit', '--audit-level', 'high'], {
    encoding: 'utf8',
  })
  return {
    exitCode: audit.status ?? 1,
    output: `${audit.stdout ?? ''}${audit.stderr ?? ''}`,
  }
}

async function main() {
  const { attempts, outcome, output } = await auditDependencies({
    runAudit: runBunAudit,
  })

  process.stdout.write(output)
  if (outcome === 'registry-unavailable') {
    console.warn(
      `REGISTRY OUTAGE: npm advisory registry unavailable after ${attempts} attempts; dependency audit skipped.`,
    )
  } else if (outcome === 'clean') {
    console.log('Dependency audit passed.')
  }

  process.exitCode = exitCodeForOutcome(outcome)
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main()
}
