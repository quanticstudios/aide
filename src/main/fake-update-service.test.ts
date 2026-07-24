import { describe, expect, it, vi } from 'vitest'

import type {
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
  UpdateState,
} from '../shared/update'
import type { UpdateStateStore } from './update-manager'
import {
  FakeUpdateService,
  isFakeUpdateServiceEnabled,
} from './fake-update-service'

function createStore(): UpdateStateStore {
  let preferences: UpdatePreferencesSnapshot = {
    automaticDownloads: true,
    healthDisclosureAcknowledged: false,
    healthReportingEnabled: true,
    revision: 0,
    snoozedUntil: null,
  }
  const state: UpdateState = {
    automaticDownloads: true,
    healthDisclosureAcknowledged: false,
    healthReportingEnabled: true,
    installationId: 'fake-installation',
    lastCheckedAt: null,
    pendingAttemptId: null,
    pendingTargetVersion: null,
    snoozedUntil: null,
  }

  return {
    getUpdatePreferences: () => ({ ...preferences }),
    getUpdateState: () => ({ ...state }),
    updateUpdatePreferences: (input: UpdatePreferencesInput) => {
      preferences = {
        ...preferences,
        ...input,
        revision: preferences.revision + 1,
      }
      return { ...preferences }
    },
    updateUpdateState: () => ({ ...state }),
  }
}

describe('isFakeUpdateServiceEnabled', () => {
  it('is impossible to enable in a packaged app', () => {
    expect(isFakeUpdateServiceEnabled(false, '1')).toBe(true)
    expect(isFakeUpdateServiceEnabled(true, '1')).toBe(false)
    expect(isFakeUpdateServiceEnabled(false, undefined)).toBe(false)
  })
})

describe('FakeUpdateService', () => {
  it('supports an initial critical update and recoverable snapshot failures', () => {
    const service = new FakeUpdateService({
      currentVersion: '1.0.0',
      initialUpdateAvailable: true,
      onUpdate: vi.fn(),
      snapshotFailures: 1,
      store: createStore(),
      targetVersion: '2.0.0',
      urgency: 'critical',
    })

    expect(() => service.getSnapshot()).toThrow(
      'Injected update snapshot failure.',
    )
    expect(service.getSnapshot()).toMatchObject({
      phase: 'available',
      targetVersion: '2.0.0',
      urgency: 'critical',
    })
  })

  it('supports command failure, recovery, progress, and retry states', async () => {
    const events = vi.fn()
    const service = new FakeUpdateService({
      checkFailures: 1,
      currentVersion: '1.0.0',
      downloadFailures: 1,
      onUpdate: events,
      store: createStore(),
      wait: async () => {},
    })

    await expect(service.checkForUpdates()).rejects.toThrow(
      'Injected update check failure.',
    )
    expect((await service.checkForUpdates()).phase).toBe('available')
    expect((await service.downloadUpdate()).phase).toBe('failed')
    expect((await service.checkForUpdates()).phase).toBe('available')
    expect((await service.downloadUpdate()).phase).toBe('downloaded')
    expect(events).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot: expect.objectContaining({
          phase: 'downloading',
          progress: expect.objectContaining({ percent: 50 }),
        }),
      }),
    )
  })

  it('persists preferences and broadcasts their committed revision', () => {
    const preferencesEvent = vi.fn()
    const service = new FakeUpdateService({
      currentVersion: '1.0.0',
      onUpdate: vi.fn(),
      store: createStore(),
      wait: async () => {},
    })
    service.subscribePreferences(preferencesEvent)

    const snapshot = service.updatePreferences({
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: false,
    })

    expect(snapshot).toMatchObject({
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: false,
      revision: 1,
    })
    expect(service.getPreferences()).toEqual(snapshot)
    expect(preferencesEvent).toHaveBeenCalledWith({
      revision: 1,
      snapshot,
    })
  })

  it('requires confirmation when configured active work is present', async () => {
    const service = new FakeUpdateService({
      activeManagedSessions: 2,
      activeTerminalSessions: 1,
      activeWorkspaceSetups: 1,
      currentVersion: '1.0.0',
      onUpdate: vi.fn(),
      store: createStore(),
      wait: async () => {},
    })

    await expect(service.requestRestart(false)).resolves.toMatchObject({
      activeManagedSessions: 2,
      activeTerminalSessions: 1,
      activeWorkspaceSetups: 1,
      confirmationRequired: true,
      restarting: false,
    })
    await expect(service.requestRestart(true)).resolves.toMatchObject({
      confirmationRequired: false,
      restarting: true,
    })
  })
})
