import { describe, expect, it } from 'vitest'

import { isEqualValue } from './deep-equal'

describe('isEqualValue', () => {
  it('compares plain objects and arrays structurally', () => {
    expect(isEqualValue({ a: [1, { b: 'c' }] }, { a: [1, { b: 'c' }] })).toBe(
      true,
    )
    expect(isEqualValue({ a: [1] }, { a: [2] })).toBe(false)
    expect(isEqualValue({ a: 1 }, { a: 1, b: undefined })).toBe(false)
  })

  it('compares class instances by identity', () => {
    expect(isEqualValue(new Date(0), new Date(1))).toBe(false)
    expect(isEqualValue(new Date(0), new Date(0))).toBe(false)
    const date = new Date(0)
    expect(isEqualValue({ at: date }, { at: date })).toBe(true)
  })
})
