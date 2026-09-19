import { describe, expect, it } from 'vitest'

import type {
  UpdatePreferencesSnapshot,
  UpdateSnapshot,
} from '../../../shared/update'
import {
  UPDATE_SNOOZE_DURATION_MS,
  createUpdateSnoozeUntil,
  getUpdatePresentationRefreshDelay,
  getRestartPreflightSummary,
  getUpdateProgressAnnouncement,
  resolveUpdatePresentation,
} from './update-presentation'

const NOW = new Date('2026-07-24T12:00:00.000Z')

function snapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    capability: 'supported',
    currentVersion: '1.0.0',
    errorCode: null,
    lastCheckedAt: null,
    phase: 'idle',
    progress: null,
    revision: 1,
    schemaVersion: 2,
    targetVersion: null,
    urgency: null,
    ...overrides,
  }
}

function preferences(
  overrides: Partial<UpdatePreferencesSnapshot> = {},
): UpdatePreferencesSnapshot {
  return {
    automaticDownloads: true,
    healthDisclosureAcknowledged: false,
    healthReportingEnabled: true,
    revision: 1,
    snoozedUntil: null,
    ...overrides,
  }
}

describe('resolveUpdatePresentation', () => {
  it.each([
    ['available', 'Update available'],
    ['downloading', 'Downloading update'],
    ['failed', 'Update failed'],
    ['downloaded', 'Restart ready'],
  ] as const)('shows a top-bar indicator for %s', (phase, label) => {
    const presentation = resolveUpdatePresentation(
      snapshot({ phase, targetVersion: '1.1.0' }),
      preferences(),
      NOW,
    )

    expect(presentation.indicatorVisible).toBe(true)
    expect(presentation.indicatorLabel).toContain(label)
  })

  it('gives critical updates distinct copy and never offers snooze', () => {
    const presentation = resolveUpdatePresentation(
      snapshot({
        phase: 'available',
        targetVersion: '2.0.0',
        urgency: 'critical',
      }),
      preferences({
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      }),
      NOW,
    )

    expect(presentation.indicatorVisible).toBe(true)
    expect(presentation.indicatorLabel).toBe('Critical update available')
    expect(presentation.canSnooze).toBe(false)
    expect(presentation.isSnoozed).toBe(false)
    expect(presentation.tone).toBe('critical')
  })

  it('keeps downloading indicator copy stable while progress changes', () => {
    const atThirtyFour = resolveUpdatePresentation(
      snapshot({
        phase: 'downloading',
        progress: { percent: 34, total: 100, transferred: 34 },
        urgency: 'critical',
      }),
      preferences(),
      NOW,
    )
    const atThirtyNine = resolveUpdatePresentation(
      snapshot({
        phase: 'downloading',
        progress: { percent: 39, total: 100, transferred: 39 },
        urgency: 'critical',
      }),
      preferences(),
      NOW,
    )

    expect(atThirtyFour.indicatorLabel).toBe('Downloading critical update')
    expect(atThirtyNine.indicatorLabel).toBe(atThirtyFour.indicatorLabel)
  })

  it('hides a normal available update while its snooze is active', () => {
    const presentation = resolveUpdatePresentation(
      snapshot({
        phase: 'available',
        targetVersion: '1.1.0',
        urgency: 'normal',
      }),
      preferences({
        snoozedUntil: '2026-07-25T11:59:59.000Z',
      }),
      NOW,
    )

    expect(presentation.indicatorVisible).toBe(false)
    expect(presentation.isSnoozed).toBe(true)
    expect(presentation.canSnooze).toBe(false)
    expect(presentation.description).toContain('23 hours 59 minutes remaining')
  })

  it('prompts for first-run health disclosure only in supported idle state', () => {
    const disclosure = resolveUpdatePresentation(
      snapshot(),
      preferences({
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
      }),
      NOW,
    )
    const disabled = resolveUpdatePresentation(
      snapshot(),
      preferences({
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: false,
      }),
      NOW,
    )
    const development = resolveUpdatePresentation(
      snapshot({ capability: 'development', phase: 'unsupported' }),
      preferences({
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
      }),
      NOW,
    )

    expect(disclosure.indicatorLabel).toBe('Review update privacy')
    expect(disclosure.indicatorVisible).toBe(true)
    expect(disclosure.needsHealthDisclosure).toBe(true)
    expect(disabled.indicatorVisible).toBe(false)
    expect(development.indicatorVisible).toBe(false)
  })

  it('keeps actionable updates above the disclosure prompt', () => {
    const presentation = resolveUpdatePresentation(
      snapshot({ phase: 'available', urgency: 'normal' }),
      preferences({
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
      }),
      NOW,
    )

    expect(presentation.indicatorLabel).toBe('Update available')
    expect(presentation.needsHealthDisclosure).toBe(true)
  })

  it('explains capability limitations instead of offering unavailable actions', () => {
    const development = resolveUpdatePresentation(
      snapshot({ capability: 'development', phase: 'unsupported' }),
      preferences(),
      NOW,
    )
    const manual = resolveUpdatePresentation(
      snapshot({ capability: 'manual-only', phase: 'unsupported' }),
      preferences(),
      NOW,
    )
    const unsupported = resolveUpdatePresentation(
      snapshot({ capability: 'unsupported-platform', phase: 'unsupported' }),
      preferences(),
      NOW,
    )

    expect(development.description).toContain('development')
    expect(development.indicatorLabel).toBe('Development build')
    expect(manual.description).toContain('manually')
    expect(unsupported.description).toContain('not supported')
    expect(development.canCheck).toBe(false)
    expect(manual.canDownload).toBe(false)
  })

  it('derives only the action valid for the current phase', () => {
    expect(
      resolveUpdatePresentation(snapshot(), preferences(), NOW).canCheck,
    ).toBe(true)
    expect(
      resolveUpdatePresentation(
        snapshot({ phase: 'available' }),
        preferences(),
        NOW,
      ).canDownload,
    ).toBe(true)
    expect(
      resolveUpdatePresentation(
        snapshot({ phase: 'failed' }),
        preferences(),
        NOW,
      ).canRetry,
    ).toBe(true)
    expect(
      resolveUpdatePresentation(
        snapshot({ phase: 'downloaded' }),
        preferences(),
        NOW,
      ).canRestart,
    ).toBe(true)
  })
})

describe('update progress presentation', () => {
  it('announces progress in bounded ten-percent steps', () => {
    expect(
      getUpdateProgressAnnouncement(
        snapshot({
          phase: 'downloading',
          progress: { percent: 34.8, total: 100, transferred: 35 },
        }),
      ),
    ).toBe('Update download 30 percent complete.')
    expect(
      getUpdateProgressAnnouncement(
        snapshot({
          phase: 'downloading',
          progress: { percent: 39.9, total: 100, transferred: 40 },
        }),
      ),
    ).toBe('Update download 30 percent complete.')
    expect(
      getUpdateProgressAnnouncement(
        snapshot({
          phase: 'downloaded',
          progress: { percent: 100, total: 100, transferred: 100 },
        }),
      ),
    ).toBe('Update download complete.')
  })

  it('does not announce non-download states', () => {
    expect(getUpdateProgressAnnouncement(snapshot())).toBeNull()
  })
})

describe('update helper values', () => {
  it('creates an exact 24-hour snooze timestamp', () => {
    const value = createUpdateSnoozeUntil(NOW)

    expect(Date.parse(value) - NOW.getTime()).toBe(UPDATE_SNOOZE_DURATION_MS)
  })

  it('refreshes snooze copy by the minute and exactly at expiry', () => {
    const snoozed = preferences({
      snoozedUntil: '2026-07-24T12:01:30.000Z',
    })
    const available = snapshot({
      phase: 'available',
      urgency: 'normal',
    })

    expect(getUpdatePresentationRefreshDelay(available, snoozed, NOW)).toBe(
      60_000,
    )
    expect(
      getUpdatePresentationRefreshDelay(
        available,
        snoozed,
        new Date('2026-07-24T12:01:15.000Z'),
      ),
    ).toBe(15_000)
    expect(
      getUpdatePresentationRefreshDelay(
        available,
        snoozed,
        new Date('2026-07-24T12:01:30.000Z'),
      ),
    ).toBeNull()
  })

  it('summarizes every active process before restart', () => {
    expect(
      getRestartPreflightSummary({
        activeManagedSessions: 2,
        activeTerminalSessions: 1,
        activeWorkspaceSetups: 3,
        confirmationRequired: true,
        restarting: false,
      }),
    ).toEqual({
      activeCount: 6,
      detail:
        '2 managed sessions, 1 terminal session, and 3 workspace setup tasks are active.',
    })
  })
})
