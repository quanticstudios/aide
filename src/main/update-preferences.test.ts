import { describe, expect, it } from 'vitest'

import { requireUpdatePreferencesInput } from './update-preferences'

describe('requireUpdatePreferencesInput', () => {
  it('accepts only the explicit, typed renderer preference fields', () => {
    expect(
      requireUpdatePreferencesInput({
        automaticDownloads: false,
        healthDisclosureAcknowledged: true,
        healthReportingEnabled: false,
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      }),
    ).toEqual({
      automaticDownloads: false,
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: false,
      snoozedUntil: '2026-07-25T12:00:00.000Z',
    })
    expect(requireUpdatePreferencesInput({ snoozedUntil: null })).toEqual({
      snoozedUntil: null,
    })
  })

  it.each([
    null,
    [],
    {},
    { automaticDownloads: 'false' },
    { healthDisclosureAcknowledged: 1 },
    { healthReportingEnabled: null },
    { snoozedUntil: false },
    { automaticDownloads: undefined },
    { unexpected: true },
  ])('rejects malformed preference input %#', (input) => {
    expect(() => requireUpdatePreferencesInput(input)).toThrow(
      'Invalid update preferences.',
    )
  })
})
