// @vitest-environment happy-dom
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, expect, it } from 'vitest'

const commits = { count: 0 }
// why: React reads the DevTools hook once when react-dom loads, so the stub must exist before the dynamic imports.
Object.assign(globalThis, {
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    checkDCE() {},
    inject: () => 1,
    isDisabled: false,
    onCommitFiberRoot() {
      commits.count += 1
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    renderers: new Map(),
    supportsFiber: true,
  },
})
const { createElement, useRef, useState } = await import('react')
const { flushSync } = await import('react-dom')
const { createRoot } = await import('react-dom/client')
const { useTranscriptFollow } = await import('./useTranscriptFollow')

let unmount = () => {}
afterEach(() => unmount())

it('does not commit for scrolls that leave the jump button as it is', async () => {
  const host = document.createElement('div')
  document.body.append(host)
  let stream: (text: string) => void = () => {}
  function Pane() {
    const [text, setText] = useState('')
    stream = setText
    const scrollRef = useRef<HTMLDivElement>(null)
    const contentRef = useRef<HTMLDivElement>(null)
    useTranscriptFollow({
      contentRef,
      pinSelector: '[data-pin]',
      scrollRef,
      sessionId: 'session-1',
    })
    return createElement(
      'div',
      { ref: scrollRef },
      createElement('div', { ref: contentRef }, text),
    )
  }
  const root = createRoot(host)
  unmount = () => {
    root.unmount()
    host.remove()
  }
  flushSync(() => root.render(createElement(Pane)))
  await sleep(20)
  const scroll = host.firstElementChild as HTMLElement

  const frames = 10
  const before = commits.count
  for (let frame = 1; frame <= frames; frame += 1) {
    // why: the frame flush commits the longer reply, then following it scrolls the pane that is already at the bottom.
    flushSync(() => stream('a'.repeat(frame)))
    scroll.dispatchEvent(new Event('scroll'))
    await sleep(5)
  }
  expect(commits.count - before).toBe(frames)
})
