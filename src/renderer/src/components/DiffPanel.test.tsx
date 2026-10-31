// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import type { TurnCheckpointDiff } from '../../../shared/checkpoints'
import { setSessionTransport } from '../lib/session-transport'
import type { SessionTransport } from '../lib/session-transport'
import DiffPanel from './DiffPanel'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
// why: the diff view measures its gutter on a canvas, which happy-dom does not draw.
HTMLCanvasElement.prototype.getContext = (() => ({
  font: '',
  measureText: (text: string) => ({ width: text.length * 7 }),
})) as unknown as HTMLCanvasElement['getContext']
// why: it renders a line's extra row only once the table has a width, and happy-dom lays nothing out.
HTMLElement.prototype.getBoundingClientRect = () =>
  ({
    width: 800,
    height: 20,
    top: 0,
    left: 0,
    right: 800,
    bottom: 20,
  }) as DOMRect

const patch = [
  'diff --git a/README.md b/README.md',
  '--- a/README.md',
  '+++ b/README.md',
  '@@ -1 +1,2 @@',
  ' before',
  '+edited by the turn',
].join('\n')

let unmount = () => {}
afterEach(() => {
  unmount()
  setSessionTransport(null)
})

describe('DiffPanel', () => {
  it("shows a pull request's review threads under their lines, and the whole-file ones above the diff", async () => {
    const diff = {
      additions: 1,
      deletions: 0,
      files: [{ path: 'README.md', patch, status: 'modified' }],
    } as unknown as TurnCheckpointDiff
    setSessionTransport({
      getCheckpointDiff: async () => diff,
    } as unknown as SessionTransport)
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    unmount = () => {
      act(() => root.unmount())
      host.remove()
    }
    await act(async () =>
      root.render(
        <DiffPanel
          checkpointId="c1"
          initialPath="README.md"
          onClose={() => {}}
          reviewThreads={[
            {
              comments: [{ author: 'octocat', body: 'Say which turn.' }],
              line: 2,
              more: 1,
              path: 'README.md',
            },
            {
              comments: [{ author: 'hubot', body: 'Rename this file.' }],
              line: 0,
              path: 'README.md',
              more: 0,
            },
            {
              comments: [{ author: 'octocat', body: 'Elsewhere.' }],
              line: 2,
              path: 'other.md',
              more: 0,
            },
          ]}
          sessionId="s1"
          workspaceId="w1"
        />,
      ),
    )
    await expect
      .poll(
        () =>
          host.querySelectorAll('[data-testid="diff-review-thread"]').length,
      )
      .toBe(2)
    const threads = [
      ...host.querySelectorAll('[data-testid="diff-review-thread"]'),
    ].map((element) => element.textContent)
    expect(threads).toEqual([
      'hubot Rename this file.',
      'octocat Say which turn.1 more on GitHub',
    ])
    // The line thread sits in the diff's table, the row after the line it is on.
    const lineThread = host.querySelectorAll(
      '[data-testid="diff-review-thread"]',
    )[1]
    const row = lineThread?.closest('tr')?.previousElementSibling
    expect(row?.textContent).toContain('edited by the turn')
  })
})
