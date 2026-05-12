import { describe, expect, it } from 'vitest'

import { getPaneFrameClassName } from './pane-frame'

describe('getPaneFrameClassName', () => {
  it('returns the active pane selection styling', () => {
    expect(getPaneFrameClassName(true)).toContain(
      'border-[var(--border-strong)]',
    )
    expect(getPaneFrameClassName(true)).toContain('bg-surface')
  })

  it('returns the inactive pane styling', () => {
    expect(getPaneFrameClassName(false)).toContain('border-border')
    expect(getPaneFrameClassName(false)).toContain('bg-surface')
    expect(getPaneFrameClassName(false)).not.toContain(
      'border-[var(--border-strong)]',
    )
  })

  it('drops border + radius + padding for a sole pane', () => {
    const className = getPaneFrameClassName(true, true)
    expect(className).not.toContain('rounded-lg')
    expect(className).not.toContain('border-')
    expect(className).not.toContain('p-4')
    expect(className).toContain('bg-surface')
  })
})
