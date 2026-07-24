import type {
  UpdatePreferencesSnapshot,
  UpdateRestartStatus,
  UpdateSnapshot,
} from '../../../shared/update'

export const UPDATE_SNOOZE_DURATION_MS = 24 * 60 * 60 * 1000

export type UpdatePresentationTone =
  | 'critical'
  | 'danger'
  | 'info'
  | 'neutral'
  | 'success'
  | 'warning'

export type UpdatePresentationIcon =
  | 'available'
  | 'critical'
  | 'downloading'
  | 'failed'
  | 'idle'
  | 'privacy'
  | 'ready'

export interface UpdatePresentation {
  readonly canCheck: boolean
  readonly canDownload: boolean
  readonly canRestart: boolean
  readonly canRetry: boolean
  readonly canSnooze: boolean
  readonly capabilityExplanation: string | null
  readonly description: string
  readonly heading: string
  readonly icon: UpdatePresentationIcon
  readonly indicatorLabel: string
  readonly indicatorVisible: boolean
  readonly isCritical: boolean
  readonly isSnoozed: boolean
  readonly needsHealthDisclosure: boolean
  readonly tone: UpdatePresentationTone
}

const CAPABILITY_EXPLANATIONS: Record<
  Exclude<UpdateSnapshot['capability'], 'supported'>,
  string
> = {
  development:
    'Automatic updates are disabled in development builds. Use a packaged release to test the signed update flow.',
  'manual-only':
    'This installation must be updated manually. Download and install the latest signed Aide release.',
  'unsupported-platform':
    'Automatic updates are not supported on this platform. Install a supported Aide build to receive them.',
}

function clampedPercent(snapshot: UpdateSnapshot): number {
  const percent = snapshot.progress?.percent ?? 0
  if (!Number.isFinite(percent)) return 0
  return Math.min(100, Math.max(0, percent))
}

function isSnoozed(
  snapshot: UpdateSnapshot,
  preferences: UpdatePreferencesSnapshot | null,
  now: Date,
): boolean {
  if (
    snapshot.urgency === 'critical' ||
    !preferences?.snoozedUntil ||
    snapshot.phase !== 'available'
  ) {
    return false
  }

  const snoozedUntil = Date.parse(preferences.snoozedUntil)
  return Number.isFinite(snoozedUntil) && snoozedUntil > now.getTime()
}

function formatSnoozeRemaining(snoozedUntil: string, now: Date): string {
  const remainingMs = Math.max(0, Date.parse(snoozedUntil) - now.getTime())
  const totalMinutes = Math.floor(remainingMs / 60_000)
  if (totalMinutes < 1) return 'less than a minute remaining'

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours === 0) {
    return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} remaining`
  }

  return `${hours} ${hours === 1 ? 'hour' : 'hours'} ${minutes} ${
    minutes === 1 ? 'minute' : 'minutes'
  } remaining`
}

export function getUpdatePresentationRefreshDelay(
  snapshot: UpdateSnapshot | null,
  preferences: UpdatePreferencesSnapshot | null,
  now = new Date(),
): number | null {
  if (
    snapshot?.phase !== 'available' ||
    snapshot.urgency === 'critical' ||
    !preferences?.snoozedUntil
  ) {
    return null
  }

  const remaining = Date.parse(preferences.snoozedUntil) - now.getTime()
  if (!Number.isFinite(remaining) || remaining <= 0) return null
  return Math.min(60_000, remaining)
}

export function resolveUpdatePresentation(
  snapshot: UpdateSnapshot | null,
  preferences: UpdatePreferencesSnapshot | null,
  now = new Date(),
): UpdatePresentation {
  if (!snapshot) {
    return {
      canCheck: false,
      canDownload: false,
      canRestart: false,
      canRetry: false,
      canSnooze: false,
      capabilityExplanation: null,
      description: 'Loading the latest update status and preferences.',
      heading: 'Software update',
      icon: 'idle',
      indicatorLabel: 'Loading update status',
      indicatorVisible: false,
      isCritical: false,
      isSnoozed: false,
      needsHealthDisclosure: false,
      tone: 'neutral',
    }
  }

  const isCritical = snapshot.urgency === 'critical'
  const snoozed = isSnoozed(snapshot, preferences, now)
  const needsHealthDisclosure =
    snapshot.capability === 'supported' &&
    preferences?.healthReportingEnabled === true &&
    preferences.healthDisclosureAcknowledged === false
  const target = snapshot.targetVersion
    ? ` Aide ${snapshot.targetVersion}`
    : ' The update'
  const capabilityExplanation =
    snapshot.capability === 'supported'
      ? null
      : CAPABILITY_EXPLANATIONS[snapshot.capability]

  if (snapshot.capability !== 'supported') {
    return {
      canCheck: false,
      canDownload: false,
      canRestart: false,
      canRetry: false,
      canSnooze: false,
      capabilityExplanation,
      description:
        capabilityExplanation ?? 'Automatic updates are unavailable.',
      heading: 'Manual update required',
      icon: 'idle',
      indicatorLabel: 'Automatic updates unavailable',
      indicatorVisible: false,
      isCritical: false,
      isSnoozed: false,
      needsHealthDisclosure: false,
      tone: 'neutral',
    }
  }

  switch (snapshot.phase) {
    case 'checking':
      return {
        canCheck: false,
        canDownload: false,
        canRestart: false,
        canRetry: false,
        canSnooze: false,
        capabilityExplanation,
        description: 'Aide is securely checking the signed release channel.',
        heading: 'Checking for updates',
        icon: 'downloading',
        indicatorLabel: 'Checking for updates',
        indicatorVisible: true,
        isCritical,
        isSnoozed: false,
        needsHealthDisclosure,
        tone: 'info',
      }
    case 'available':
      return {
        canCheck: false,
        canDownload: true,
        canRestart: false,
        canRetry: false,
        canSnooze: !isCritical && !snoozed,
        capabilityExplanation,
        description: isCritical
          ? `${target} contains a critical security or reliability fix. Downloading it never forces Aide to restart.`
          : snoozed
            ? `${target} is snoozed with ${formatSnoozeRemaining(
                preferences?.snoozedUntil ?? now.toISOString(),
                now,
              )}. You can still download it now.`
            : `${target} is ready to download in the background.`,
        heading: isCritical ? 'Critical update available' : 'Update available',
        icon: isCritical ? 'critical' : 'available',
        indicatorLabel: isCritical
          ? 'Critical update available'
          : 'Update available',
        indicatorVisible: !snoozed,
        isCritical,
        isSnoozed: snoozed,
        needsHealthDisclosure,
        tone: isCritical ? 'critical' : 'info',
      }
    case 'downloading': {
      return {
        canCheck: false,
        canDownload: false,
        canRestart: false,
        canRetry: false,
        canSnooze: false,
        capabilityExplanation,
        description: `${target} is downloading in the background. You can keep working.`,
        heading: isCritical
          ? 'Downloading critical update'
          : 'Downloading update',
        icon: isCritical ? 'critical' : 'downloading',
        indicatorLabel: isCritical
          ? 'Downloading critical update'
          : 'Downloading update',
        indicatorVisible: true,
        isCritical,
        isSnoozed: false,
        needsHealthDisclosure,
        tone: isCritical ? 'critical' : 'info',
      }
    }
    case 'downloaded':
      return {
        canCheck: false,
        canDownload: false,
        canRestart: true,
        canRetry: false,
        canSnooze: false,
        capabilityExplanation,
        description: `${target} is verified and ready. Aide restarts only after you explicitly confirm.`,
        heading: isCritical ? 'Critical update ready' : 'Restart ready',
        icon: isCritical ? 'critical' : 'ready',
        indicatorLabel: isCritical ? 'Critical update ready' : 'Restart ready',
        indicatorVisible: true,
        isCritical,
        isSnoozed: false,
        needsHealthDisclosure,
        tone: isCritical ? 'critical' : 'success',
      }
    case 'failed':
      return {
        canCheck: false,
        canDownload: false,
        canRestart: false,
        canRetry: true,
        canSnooze: false,
        capabilityExplanation,
        description:
          'Aide could not complete the update. Your current installation is unchanged and safe to use.',
        heading: 'Update failed',
        icon: 'failed',
        indicatorLabel: 'Update failed',
        indicatorVisible: true,
        isCritical,
        isSnoozed: false,
        needsHealthDisclosure,
        tone: 'danger',
      }
    case 'idle':
    case 'unsupported':
      return {
        canCheck: snapshot.phase === 'idle',
        canDownload: false,
        canRestart: false,
        canRetry: false,
        canSnooze: false,
        capabilityExplanation,
        description: needsHealthDisclosure
          ? 'Review the privacy-bounded update health disclosure before any reports can be shared.'
          : 'Check the signed release channel for a newer version.',
        heading: needsHealthDisclosure
          ? 'Review update privacy'
          : 'Aide is up to date',
        icon: needsHealthDisclosure ? 'privacy' : 'idle',
        indicatorLabel: needsHealthDisclosure
          ? 'Review update privacy'
          : 'Aide is up to date',
        indicatorVisible: needsHealthDisclosure,
        isCritical,
        isSnoozed: false,
        needsHealthDisclosure,
        tone: needsHealthDisclosure ? 'warning' : 'neutral',
      }
  }
}

export function getUpdateProgressAnnouncement(
  snapshot: UpdateSnapshot | null,
): string | null {
  if (!snapshot) return null
  if (snapshot.phase === 'downloaded') return 'Update download complete.'
  if (snapshot.phase !== 'downloading' || !snapshot.progress) return null

  const percent = clampedPercent(snapshot)
  if (percent >= 100) return 'Update download complete.'

  const bucket = Math.floor(percent / 10) * 10
  return `Update download ${bucket} percent complete.`
}

export function createUpdateSnoozeUntil(now = new Date()): string {
  return new Date(now.getTime() + UPDATE_SNOOZE_DURATION_MS).toISOString()
}

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`
}

export function getRestartPreflightSummary(
  status: UpdateRestartStatus | null,
): { activeCount: number; detail: string } {
  if (!status) {
    return { activeCount: 0, detail: 'No active work was reported.' }
  }

  const entries = [
    countLabel(status.activeManagedSessions, 'managed session'),
    countLabel(status.activeTerminalSessions, 'terminal session'),
    countLabel(
      status.activeWorkspaceSetups,
      'workspace setup task',
      'workspace setup tasks',
    ),
  ]
  const activeCount =
    status.activeManagedSessions +
    status.activeTerminalSessions +
    status.activeWorkspaceSetups

  return {
    activeCount,
    detail: `${entries[0]}, ${entries[1]}, and ${entries[2]} are active.`,
  }
}
