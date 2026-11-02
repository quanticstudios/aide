import { describe, expect, it } from 'vitest'
import { getComposerAction } from './ManagedComposer'

const idle = {
  draft: '',
  hasPendingApproval: false,
  hasQuestion: false,
  isRunning: false,
}

describe('getComposerAction', () => {
  it('offers Stop while a turn runs and the draft is empty', () => {
    expect(getComposerAction({ ...idle, isRunning: true })).toBe('stop')
  })

  it('sends a typed draft while a turn runs, which steers it', () => {
    expect(getComposerAction({ ...idle, draft: 'go', isRunning: true })).toBe(
      'send',
    )
  })

  it('answers a question and denies an approval with feedback first', () => {
    expect(
      getComposerAction({ ...idle, hasQuestion: true, isRunning: true }),
    ).toBe('answer')
    expect(
      getComposerAction({ ...idle, draft: 'no', hasPendingApproval: true }),
    ).toBe('deny')
  })
})
