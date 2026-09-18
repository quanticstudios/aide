import {
  Alert,
  Button,
  Description,
  Label,
  Modal,
  ProgressBar,
  Spinner,
  Switch,
} from '@heroui/react'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'
import { useMemo, useState } from 'react'

import {
  getRestartPreflightSummary,
  getUpdateProgressAnnouncement,
  resolveUpdatePresentation,
} from '@/lib/update-presentation'
import type {
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
  UpdateRestartStatus,
  UpdateSnapshot,
} from '../../../shared/update'

interface UpdateModalProps {
  readonly actionError: string | null
  readonly isOpen: boolean
  readonly onCheck: () => Promise<void>
  readonly onClearActionError: () => void
  readonly onConfirmRestart: () => Promise<void>
  readonly onDownload: () => Promise<void>
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onRequestRestart: () => Promise<void>
  readonly onRetry: () => Promise<void>
  readonly onSnooze: () => Promise<void>
  readonly onUpdatePreferences: (input: UpdatePreferencesInput) => Promise<void>
  readonly preferences: UpdatePreferencesSnapshot | null
  readonly presentationNow: Date
  readonly restartStatus: UpdateRestartStatus | null
  readonly snapshot: UpdateSnapshot | null
}

type PendingAction =
  | 'automatic-downloads'
  | 'check'
  | 'disclosure'
  | 'download'
  | 'health-reporting'
  | 'restart'
  | 'retry'
  | 'snooze'

function StatusIcon({
  icon,
}: {
  readonly icon: ReturnType<typeof resolveUpdatePresentation>['icon']
}) {
  const className = 'size-5'

  switch (icon) {
    case 'critical':
      return <ShieldAlert aria-hidden="true" className={className} />
    case 'failed':
      return <AlertTriangle aria-hidden="true" className={className} />
    case 'ready':
      return <CheckCircle2 aria-hidden="true" className={className} />
    case 'available':
      return <Download aria-hidden="true" className={className} />
    case 'privacy':
      return <ShieldCheck aria-hidden="true" className={className} />
    case 'downloading':
      return (
        <LoaderCircle
          aria-hidden="true"
          className={`${className} animate-spin`}
        />
      )
    case 'idle':
      return <RefreshCw aria-hidden="true" className={className} />
  }
}

function SettingSwitch({
  description,
  isDisabled,
  isPending,
  isSelected,
  label,
  onChange,
}: {
  readonly description: string
  readonly isDisabled?: boolean
  readonly isPending: boolean
  readonly isSelected: boolean
  readonly label: string
  readonly onChange: (selected: boolean) => void
}) {
  return (
    <Switch
      isDisabled={isDisabled || isPending}
      isSelected={isSelected}
      onChange={onChange}
    >
      <Switch.Content className="min-h-10 gap-3">
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </Switch.Content>
      <Description className="pl-11 text-xs leading-5 text-muted-foreground">
        {description}
      </Description>
    </Switch>
  )
}

export default function UpdateModal({
  actionError,
  isOpen,
  onCheck,
  onClearActionError,
  onConfirmRestart,
  onDownload,
  onOpenChange,
  onRequestRestart,
  onRetry,
  onSnooze,
  onUpdatePreferences,
  preferences,
  presentationNow,
  restartStatus,
  snapshot,
}: UpdateModalProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const presentation = useMemo(
    () => resolveUpdatePresentation(snapshot, preferences, presentationNow),
    [preferences, presentationNow, snapshot],
  )
  const progressAnnouncement = getUpdateProgressAnnouncement(snapshot)
  const restartSummary = getRestartPreflightSummary(restartStatus)

  const runAction = async (
    action: PendingAction,
    operation: () => Promise<void>,
  ) => {
    setPendingAction(action)
    onClearActionError()
    try {
      await operation()
    } catch {
      // App owns the durable action error so palette and modal actions share it.
    } finally {
      setPendingAction(null)
    }
  }

  const isBusy = pendingAction !== null
  const progressValue = Math.min(
    100,
    Math.max(0, snapshot?.progress?.percent ?? 0),
  )

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isBusy}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog
            aria-describedby="software-update-description"
            className="max-h-[min(760px,calc(100vh-2rem))]"
            data-testid="update-modal"
          >
            <Modal.Header>
              <Modal.Icon
                className={
                  presentation.isCritical
                    ? 'bg-accent-red-soft text-accent-red'
                    : presentation.tone === 'danger'
                      ? 'bg-accent-red-soft text-accent-red'
                      : 'bg-accent-blue-soft text-accent-blue'
                }
              >
                <StatusIcon icon={presentation.icon} />
              </Modal.Icon>
              <Modal.Heading>{presentation.heading}</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="gap-5 overflow-y-auto">
              <p
                className="text-sm leading-6 text-muted-foreground"
                id="software-update-description"
              >
                {presentation.description}
              </p>

              {presentation.capabilityExplanation ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Automatic updates unavailable</Alert.Title>
                    <Alert.Description>
                      {presentation.capabilityExplanation}
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              {snapshot?.phase === 'downloading' ? (
                <ProgressBar
                  aria-label="Update download progress"
                  color={presentation.isCritical ? 'danger' : 'accent'}
                  value={progressValue}
                >
                  <Label>Download progress</Label>
                  <ProgressBar.Output />
                  <ProgressBar.Track>
                    <ProgressBar.Fill />
                  </ProgressBar.Track>
                </ProgressBar>
              ) : null}

              <div
                aria-atomic="true"
                aria-live="polite"
                className="sr-only"
                role="status"
              >
                {progressAnnouncement}
              </div>

              {actionError ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Action could not be completed</Alert.Title>
                    <Alert.Description>{actionError}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              {restartStatus?.confirmationRequired ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>
                      Confirm before interrupting active work
                    </Alert.Title>
                    <Alert.Description>
                      {restartSummary.detail} Restarting Aide will stop them.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              {restartStatus?.restarting ? (
                <Alert status="success">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>Restart requested</Alert.Title>
                    <Alert.Description>
                      Aide is restarting to install the verified update.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : null}

              <section
                aria-labelledby="update-settings-heading"
                className="space-y-4 rounded-lg border border-border bg-surface-secondary p-4"
              >
                <div>
                  <h3
                    className="text-sm font-semibold text-foreground"
                    id="update-settings-heading"
                  >
                    Update settings
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Preferences are stored on this device and apply immediately.
                  </p>
                </div>

                <SettingSwitch
                  description={
                    snapshot?.capability === 'supported'
                      ? 'Download signed updates in the background. Aide never restarts without confirmation.'
                      : 'Available only in packaged builds that support automatic updates.'
                  }
                  isDisabled={
                    !preferences || snapshot?.capability !== 'supported'
                  }
                  isPending={pendingAction === 'automatic-downloads'}
                  isSelected={preferences?.automaticDownloads ?? false}
                  label="Download updates automatically"
                  onChange={(selected) =>
                    void runAction('automatic-downloads', () =>
                      onUpdatePreferences({ automaticDownloads: selected }),
                    )
                  }
                />

                <SettingSwitch
                  description={
                    preferences?.healthDisclosureAcknowledged
                      ? 'Share version, platform, update timing, and coarse failure codes. Reports never include projects, paths, prompts, or source code.'
                      : 'Acknowledge the disclosure below before health reporting can be enabled.'
                  }
                  isDisabled={!preferences?.healthDisclosureAcknowledged}
                  isPending={pendingAction === 'health-reporting'}
                  isSelected={
                    (preferences?.healthDisclosureAcknowledged &&
                      preferences.healthReportingEnabled) ??
                    false
                  }
                  label="Share privacy-bounded update health reports"
                  onChange={(selected) =>
                    void runAction('health-reporting', () =>
                      onUpdatePreferences({ healthReportingEnabled: selected }),
                    )
                  }
                />

                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs leading-5 text-muted-foreground">
                    Health reports are sent only after you acknowledge this
                    disclosure. You can withdraw that acknowledgement at any
                    time.
                  </p>
                  <Button
                    className="mt-3 min-h-10"
                    isDisabled={!preferences}
                    isPending={pendingAction === 'disclosure'}
                    onPress={() =>
                      void runAction('disclosure', () =>
                        preferences?.healthDisclosureAcknowledged
                          ? onUpdatePreferences({
                              healthDisclosureAcknowledged: false,
                              healthReportingEnabled: false,
                            })
                          : onUpdatePreferences({
                              healthDisclosureAcknowledged: true,
                              healthReportingEnabled: true,
                            }),
                      )
                    }
                    size="sm"
                    variant="secondary"
                  >
                    {preferences?.healthDisclosureAcknowledged
                      ? 'Withdraw approval and disable health reporting'
                      : 'Acknowledge and enable health reporting'}
                  </Button>
                </div>
              </section>
            </Modal.Body>

            <Modal.Footer className="flex-wrap">
              <Button
                className="min-h-10"
                isDisabled={isBusy}
                onPress={() => onOpenChange(false)}
                variant="secondary"
              >
                Close
              </Button>

              {presentation.canSnooze ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'snooze'}
                  onPress={() => void runAction('snooze', onSnooze)}
                  variant="tertiary"
                >
                  Snooze for 24 hours
                </Button>
              ) : null}

              {presentation.canCheck ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'check'}
                  onPress={() => void runAction('check', onCheck)}
                >
                  Check for updates
                </Button>
              ) : null}

              {presentation.canDownload ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'download'}
                  onPress={() => void runAction('download', onDownload)}
                  variant={presentation.isCritical ? 'danger' : 'primary'}
                >
                  Download update
                </Button>
              ) : null}

              {presentation.canRetry ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'retry'}
                  onPress={() => void runAction('retry', onRetry)}
                >
                  Retry update
                </Button>
              ) : null}

              {presentation.canRestart &&
              !restartStatus?.confirmationRequired &&
              !restartStatus?.restarting ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'restart'}
                  onPress={() => void runAction('restart', onRequestRestart)}
                  variant={presentation.isCritical ? 'danger' : 'primary'}
                >
                  Restart to update
                </Button>
              ) : null}

              {presentation.canRestart &&
              restartStatus?.confirmationRequired &&
              !restartStatus.restarting ? (
                <Button
                  className="min-h-10"
                  isDisabled={isBusy}
                  isPending={pendingAction === 'restart'}
                  onPress={() => void runAction('restart', onConfirmRestart)}
                  variant="danger"
                >
                  Restart and stop {restartSummary.activeCount} active{' '}
                  {restartSummary.activeCount === 1 ? 'task' : 'tasks'}
                </Button>
              ) : null}

              {isBusy ? (
                <span className="inline-flex min-h-10 items-center gap-2 text-xs text-muted-foreground">
                  <Spinner color="current" size="sm" />
                  Updating…
                </span>
              ) : null}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
