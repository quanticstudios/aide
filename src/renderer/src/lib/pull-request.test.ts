import { describe, expect, it } from 'vitest'
import type { DaemonPullRequest } from './daemon-transport'
import { sendableParts, summarizeChecks, threadsByLine } from './pull-request'

const pullRequest: DaemonPullRequest = {
  checks: [
    { name: 'linux', state: 'fail' },
    { name: 'macos', state: 'pass' },
    { name: 'windows', state: 'pending' },
    { name: 'docs', state: 'skip' },
  ],
  conflicts: false,
  detail: '',
  draft: false,
  head: 'abc',
  number: 7,
  reason: 'checks_failing',
  review: '',
  state: 'open',
  url: 'https://github.com/o/r/pull/7',
}

const thread = (path: string, line: number) => ({
  comments: [{ author: 'octocat', body: `${path}:${line}` }],
  line,
  more: 0,
  path,
})

describe('pull request helpers', () => {
  it('names the failing checks and counts the rest', () => {
    expect(summarizeChecks(pullRequest)).toEqual({
      failing: ['linux'],
      passing: 1,
      pending: 1,
    })
  })

  it('offers failures while a check fails and the review while one is outstanding, only on an open pull request', () => {
    expect(sendableParts(pullRequest, null)).toEqual({
      failures: true,
      review: false,
    })
    expect(
      sendableParts(
        { ...pullRequest, checks: [] },
        { changeRequests: [], threads: [thread('a.ts', 1)] },
      ),
    ).toEqual({ failures: false, review: true })
    expect(
      sendableParts({ ...pullRequest, checks: [], review: 'changes' }, null),
    ).toEqual({ failures: false, review: true })
    expect(
      sendableParts(
        { ...pullRequest, review: 'changes', state: 'merged' },
        null,
      ),
    ).toEqual({ failures: false, review: false })
  })

  it("groups a file's threads by line, the whole-file ones under 0", () => {
    const byLine = threadsByLine(
      [
        thread('a.ts', 3),
        thread('b.ts', 3),
        thread('a.ts', 3),
        thread('a.ts', 0),
      ],
      'a.ts',
    )
    expect([...byLine.keys()]).toEqual([3, 0])
    expect(byLine.get(3)).toHaveLength(2)
  })
})
