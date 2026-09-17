import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export const REQUIRED_CI_WORKFLOW = '.github/workflows/ci.yml'
export const REQUIRED_LINUX_CI_JOB = 'Linux security and quality'

function getArgument(name) {
  const index = process.argv.indexOf(name)
  const value = index === -1 ? undefined : process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing ${name}.`)
  return value
}

function getWorkflowRuns(payload) {
  return (Array.isArray(payload) ? payload : [payload]).flatMap(
    (page) => page.workflow_runs ?? [],
  )
}

function getJobs(payload) {
  return (Array.isArray(payload) ? payload : [payload]).flatMap(
    (page) => page.jobs ?? [],
  )
}

export function selectSuccessfulCiRun(commit, payload) {
  const run = getWorkflowRuns(payload).find(
    (candidate) =>
      candidate.head_sha === commit &&
      candidate.event === 'push' &&
      candidate.status === 'completed' &&
      candidate.conclusion === 'success',
  )
  if (!run) {
    throw new Error(
      `Release commit ${commit} needs a successful push run of ${REQUIRED_CI_WORKFLOW}.`,
    )
  }
  return run.id
}

export function assertSuccessfulLinuxCiJob(runId, payload) {
  const matchingJobs = getJobs(payload).filter(
    (job) => job.name === REQUIRED_LINUX_CI_JOB,
  )
  if (
    matchingJobs.length !== 1 ||
    matchingJobs[0].status !== 'completed' ||
    matchingJobs[0].conclusion !== 'success'
  ) {
    throw new Error(
      `CI run ${runId} needs one successful ${REQUIRED_LINUX_CI_JOB} job.`,
    )
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const commit = getArgument('--commit')
  const runs = JSON.parse(await readFile(getArgument('--runs'), 'utf8'))
  const runId = selectSuccessfulCiRun(commit, runs)
  const hasJobs = process.argv.includes('--jobs')
  if (!hasJobs) {
    console.log(runId)
  } else {
    if (getArgument('--run-id') !== String(runId)) {
      throw new Error('CI jobs must belong to the selected successful CI run.')
    }
    assertSuccessfulLinuxCiJob(
      runId,
      JSON.parse(await readFile(getArgument('--jobs'), 'utf8')),
    )
  }
}
