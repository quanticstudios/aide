// @vitest-environment happy-dom
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'

import type { TranscriptRow } from '../../lib/transcript-rows'

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

const observers: FakeResizeObserver[] = []
// why: happy-dom never lays out, so the test reports the row's growth the way the browser's observer would.
class FakeResizeObserver {
  readonly targets = new Set<Element>()
  constructor(readonly callback: ResizeObserverCallback) {
    observers.push(this)
  }
  observe(target: Element) {
    this.targets.add(target)
  }
  unobserve(target: Element) {
    this.targets.delete(target)
  }
  disconnect() {
    this.targets.clear()
  }
}
Object.assign(window, { ResizeObserver: FakeResizeObserver })

const { createElement, useState } = await import('react')
const { flushSync } = await import('react-dom')
const { createRoot } = await import('react-dom/client')
const { default: TranscriptList } = await import('./TranscriptList')

const row = { items: [], key: 'row-1' } as unknown as TranscriptRow

function resize(target: Element, height: number): void {
  for (const observer of observers) {
    if (!observer.targets.has(target)) continue
    const entry = {
      borderBoxSize: [{ blockSize: height, inlineSize: 600 }],
      target,
    } as unknown as ResizeObserverEntry
    observer.callback([entry], observer as unknown as ResizeObserver)
  }
}

let unmount = () => {}
afterEach(() => unmount())

describe('TranscriptList', () => {
  it('commits once per frame while a streaming row grows', async () => {
    const scroll = document.createElement('div')
    Object.defineProperty(scroll, 'offsetHeight', { value: 600 })
    Object.defineProperty(scroll, 'offsetWidth', { value: 600 })
    document.body.append(scroll)
    let grow: (text: string) => void = () => {}
    function Pane() {
      const [text, setText] = useState('a')
      grow = setText
      return createElement(TranscriptList, {
        renderRow: () => createElement('p', null, text),
        rows: [row],
        scrollRef: { current: scroll },
        sessionId: 'session-1',
        virtualizerRef: { current: null },
      })
    }
    const root = createRoot(scroll)
    unmount = () => {
      root.unmount()
      scroll.remove()
    }
    flushSync(() => root.render(createElement(Pane)))
    await sleep(20)
    const rowElement = scroll.querySelector('[data-index="0"]')
    expect(rowElement).not.toBeNull()

    const frames = 10
    const before = commits.count
    for (let frame = 1; frame <= frames; frame += 1) {
      // why: the frame flush commits the longer reply, then the browser reports the row's new height before paint.
      flushSync(() => grow('a'.repeat(frame * 100)))
      resize(rowElement as Element, 100 + frame * 20)
      await sleep(5)
    }
    expect(commits.count - before).toBe(frames)
  })
})
