import { describe, expect, it } from 'vitest'

import { getPaneFrameClassName } from './pane-frame'

describe('getPaneFrameClassName', () => {
  it('returns the active pane selection styling', () => {
    expect(getPaneFrameClassName(true)).toContain('border-primary/45')
    expect(getPaneFrameClassName(true)).toContain('bg-surface')
    expect(getPaneFrameClassName(true)).toContain(
      'shadow-[var(--surface-shadow)]',
    )
  })

  it('returns the inactive pane styling', () => {
    expect(getPaneFrameClassName(false)).toContain('border-border/70')
    expect(getPaneFrameClassName(false)).toContain('bg-surface/70')
    expect(getPaneFrameClassName(false)).not.toContain(
      'shadow-[var(--surface-shadow)]',
    )
  })
})
