import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

function readPath(result, path) {
  return path.split('.').reduce((value, key) => value?.[key], result)
}

export function checkPerfBudget(result, ceilings) {
  const failures = []

  for (const [path, ceiling] of Object.entries(ceilings)) {
    const value = readPath(result, path)

    if (typeof value !== 'number' || !Number.isFinite(value)) {
      failures.push(`${path} is missing from the perf result.`)
    } else if (value > ceiling) {
      failures.push(`${path} is ${value}, over the ${ceiling} ceiling.`)
    }
  }

  return failures
}

function run() {
  const [
    resultPath = 'perf-baseline.json',
    ceilingsPath = 'scripts/perf-budget.json',
  ] = process.argv.slice(2)
  const result = JSON.parse(readFileSync(resultPath, 'utf8'))
  const ceilings = JSON.parse(readFileSync(ceilingsPath, 'utf8'))
  const failures = checkPerfBudget(result, ceilings)

  for (const path of Object.keys(ceilings)) {
    console.log(
      `${path}: ${readPath(result, path)} (ceiling ${ceilings[path]})`,
    )
  }

  if (failures.length > 0) {
    console.error(failures.join('\n'))
    process.exitCode = 1
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  run()
}
