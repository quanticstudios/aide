import { describe, expect, it } from 'vitest'

import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from './workspace-camera'

describe('workspace camera helpers', () => {
  it('builds the correct track height and translate formula', () => {
    expect(getWorkspaceTrackStyle(4, 2)).toEqual({
      height: '400%',
      transform: 'translateY(calc(-2 * (100% / 4)))',
    })
  })

  it('clamps out-of-range workspace indexes safely', () => {
    expect(getWorkspaceTrackStyle(3, 99)).toEqual({
      height: '300%',
      transform: 'translateY(calc(-2 * (100% / 3)))',
    })
  })

  it('returns a full-height slide size for each workspace', () => {
    expect(getWorkspaceSlideHeight(2)).toBe('50%')
    expect(getWorkspaceSlideHeight(0)).toBe('100%')
  })
})
