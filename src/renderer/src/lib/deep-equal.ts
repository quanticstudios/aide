/** Compares two JSON-like values structurally; functions and other objects compare by identity. */
export function isEqualValue(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (
    typeof left !== 'object' ||
    typeof right !== 'object' ||
    left === null ||
    right === null
  ) {
    return false
  }
  if (Array.isArray(left)) {
    return (
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => isEqualValue(value, right[index]))
    )
  }
  if (Array.isArray(right)) return false
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const keys = Object.keys(leftRecord)
  return (
    keys.length === Object.keys(rightRecord).length &&
    keys.every(
      (key) =>
        Object.hasOwn(rightRecord, key) &&
        isEqualValue(leftRecord[key], rightRecord[key]),
    )
  )
}
