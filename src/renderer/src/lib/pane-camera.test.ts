import { describe, expect, it } from 'vitest'

import { getPaneSlideWidth, getPaneTrackStyle } from './pane-camera'

describe('pane camera helpers', () => {
  it('builds the correct track width and translate formula', () => {
    expect(getPaneTrackStyle(5, 3)).toEqual({
      transform: 'translateX(calc(-3 * (100% / 5)))',
      width: '500%',
    })
  })

  it('clamps out-of-range pane indexes safely', () => {
    expect(getPaneTrackStyle(3, 99)).toEqual({
      transform: 'translateX(calc(-2 * (100% / 3)))',
      width: '300%',
    })
  })

  it('returns a full-width slide size for each pane', () => {
    expect(getPaneSlideWidth(4)).toBe('25%')
    expect(getPaneSlideWidth(0)).toBe('100%')
  })
})
