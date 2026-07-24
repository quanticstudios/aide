import type { UpdatePreferencesInput } from '../shared/update'

const UPDATE_PREFERENCE_KEYS = new Set([
  'automaticDownloads',
  'healthDisclosureAcknowledged',
  'healthReportingEnabled',
  'snoozedUntil',
])

/**
 * Validates the narrow renderer-to-main preferences mutation. Date semantics
 * (including critical-update snoozes) remain owned by UpdateManager, which has
 * the current signed release state.
 */
export function requireUpdatePreferencesInput(
  value: unknown,
): UpdatePreferencesInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid update preferences.')
  }

  const input = value as Record<string, unknown>
  const entries = Object.entries(input)
  if (
    entries.length === 0 ||
    entries.some(([key, preference]) => {
      if (!UPDATE_PREFERENCE_KEYS.has(key)) return true
      if (
        key === 'automaticDownloads' ||
        key === 'healthDisclosureAcknowledged' ||
        key === 'healthReportingEnabled'
      ) {
        return typeof preference !== 'boolean'
      }
      return preference !== null && typeof preference !== 'string'
    })
  ) {
    throw new Error('Invalid update preferences.')
  }

  return input as UpdatePreferencesInput
}
