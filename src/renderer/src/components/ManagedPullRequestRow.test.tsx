// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  DaemonPullRequest,
  DaemonTransport,
} from '../lib/daemon-transport'
import type { PullRequestState } from '../lib/pull-request'
import { setSessionTransport } from '../lib/session-transport'
import ManagedPullRequestRow from './ManagedPullRequestRow'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const pullRequest: DaemonPullRequest = {
  checks: [
    { name: 'linux', state: 'fail' },
    { name: 'macos', state: 'pass' },
  ],
  conflicts: false,
  detail: '',
  draft: false,
  head: 'abc',
  number: 241,
  reason: 'checks_failing',
  review: 'changes',
  state: 'open',
  url: 'https://github.com/o/r/pull/241',
}

const PROMPT =
  'These checks failed on pull request #241:\n- linux\n\nFix these and push.'

let unmount = () => {}
afterEach(() => {
  unmount()
  setSessionTransport(null)
})

function render(state: PullRequestState) {
  const transport = {
    getConnection: () => ({ status: 'connected', server: 'pitwall' }),
    pullRequestPrompt: vi.fn(async () => PROMPT),
    mergePullRequest: vi.fn(async () => {}),
  }
  setSessionTransport(transport as unknown as DaemonTransport)
  const onSend = vi.fn(async () => true)
  const onFixInNewThread = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      <ManagedPullRequestRow
        onFixInNewThread={onFixInNewThread}
        onSend={onSend}
        sessionId="pane-1"
        state={state}
      />,
    ),
  )
  unmount = () => {
    act(() => root.unmount())
    host.remove()
  }
  const button = (name: string, index = 0) => {
    const found = [...document.querySelectorAll('button')].filter(
      (element) => element.textContent?.trim() === name,
    )[index]
    if (!found) throw new Error(`no ${name} button`)
    return found
  }
  return { button, host, onFixInNewThread, onSend, transport }
}

const press = async (element: HTMLElement) => {
  await act(async () => {
    element.click()
  })
}

describe('ManagedPullRequestRow', () => {
  it("shows the checks and review, and sends pitwall's message to the agent or to a new thread", async () => {
    const { button, host, onFixInNewThread, onSend, transport } = render({
      pullRequest,
      review: {
        changeRequests: [],
        threads: [
          { comments: [], line: 3, more: 0, path: 'a.ts' },
          { comments: [], line: 9, more: 0, path: 'a.ts' },
        ],
      },
      reviewError: null,
    })
    expect(host.textContent).toContain('#241')
    expect(host.textContent).toContain('1 passing · 1 failing · 0 pending')
    expect(host.textContent).toContain('Changes requested')
    expect(host.textContent).toContain('Failing: linux')
    expect(host.textContent).toContain('2 unresolved threads')

    await press(button('Send to agent'))
    expect(transport.pullRequestPrompt).toHaveBeenLastCalledWith(
      'pane-1',
      'failures',
    )
    expect(onSend).toHaveBeenCalledWith(PROMPT)

    await press(button('Fix in a new thread', 1))
    expect(transport.pullRequestPrompt).toHaveBeenLastCalledWith(
      'pane-1',
      'review',
    )
    expect(onFixInNewThread).toHaveBeenCalledWith(PROMPT)
  })

  it('merges only after the dialog is confirmed', async () => {
    const { button, transport } = render({
      pullRequest,
      review: null,
      reviewError: null,
    })
    await press(button('Merge'))
    expect(transport.mergePullRequest).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain('Merge #241?')
    expect(document.body.textContent).toContain(
      '1 failing and 0 pending check.',
    )
    await press(button('Merge', 1))
    expect(transport.mergePullRequest).toHaveBeenCalledWith('pane-1')
  })

  it('shows nothing without a pull request', () => {
    const { host } = render({
      pullRequest: null,
      review: null,
      reviewError: null,
    })
    expect(host.textContent).toBe('')
  })
})
