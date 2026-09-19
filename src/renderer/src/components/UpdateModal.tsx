import {
  Alert,
  Button,
  Description,
  Label,
  Modal,
  ProgressBar,
  Switch,
} from '@heroui/react'
import { useMemo, useState } from 'react'

import {
  getRestartPreflightSummary,
  getUpdateProgressAnnouncement,
  resolveUpdatePresentation,
} from '@/lib/update-presentation'
import type { UpdatePresentationTone } from '@/lib/update-presentation'
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

// why: the theme flattens --accent, so a variant="primary" button needs the Action Blue tokens to read as the filled action.
const PRIMARY_ACTION_CLASS = 'min-h-10 bg-primary text-primary-foreground'

const STATUS_PILL_CLASSES: Record<UpdatePresentationTone, string> = {
  critical: 'bg-accent-red-soft text-accent-red',
  danger: 'bg-accent-red-soft text-accent-red',
  info: 'bg-accent-blue-soft text-accent-blue',
  neutral: 'bg-foreground/10 text-muted-foreground',
  success: 'bg-accent-green-soft text-accent-green',
  warning: 'bg-accent-yellow-soft text-accent-yellow',
}

function SettingSwitch({
  className,
  description,
  isDisabled,
  isPending,
  isSelected,
  label,
  onChange,
}: {
  readonly className?: string
  readonly description: string
  readonly isDisabled?: boolean
  readonly isPending: boolean
  readonly isSelected: boolean
  readonly label: string
  readonly onChange: (selected: boolean) => void
}) {
  return (
    <Switch
      className={className}
      isDisabled={isDisabled || isPending}
      isSelected={isSelected}
      onChange={onChange}
    >
      <Switch.Content className="min-h-10 gap-3">
        <Switch.Control className="ring-1 ring-border ring-inset">
          <Switch.Thumb />
        </Switch.Control>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </Switch.Content>
      <Description className="pl-13 text-xs leading-5 text-muted-foreground">
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
  const isAlarming =
    presentation.tone === 'critical' || presentation.tone === 'danger'
  const isHealthAcknowledged =
    preferences?.healthDisclosureAcknowledged ?? false
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
              <div className="flex flex-wrap items-center gap-2">
                <Modal.Heading>Updates</Modal.Heading>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_PILL_CLASSES[presentation.tone]}`}
                >
                  {presentation.indicatorLabel}
                </span>
              </div>
            </Modal.Header>

            <Modal.Body className="space-y-5 overflow-y-auto">
              {isAlarming ? (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title id="software-update-description">
                      {presentation.description}
                    </Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : (
                <p
                  className="text-sm leading-6 text-muted-foreground"
                  id="software-update-description"
                >
                  {presentation.description}
                </p>
              )}

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
                    <Alert.Title>{actionError}</Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : null}

              {restartStatus?.confirmationRequired ? (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Title>
                      {restartSummary.detail} Restarting Aide will stop them.
                    </Alert.Title>
                  </Alert.Content>
                </Alert>
              ) : null}

              {restartStatus?.restarting ? (
                <p className="text-sm leading-6 text-muted-foreground">
                  Restart requested. Aide is restarting to install the verified
                  update.
                </p>
              ) : null}

              <section
                aria-labelledby="update-settings-heading"
                className="space-y-4"
              >
                <h3
                  className="text-sm font-semibold text-foreground"
                  id="update-settings-heading"
                >
                  Settings
                </h3>

                <SettingSwitch
                  description={
                    snapshot?.capability === 'supported'
                      ? 'Signed updates download in the background. Aide never restarts on its own.'
                      : 'Available only in packaged builds with automatic updates.'
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

                <div className="flex items-start justify-between gap-3">
                  <SettingSwitch
                    className="min-w-0 flex-1"
                    description="Version, platform, update timing, and failure codes. Never code or prompts."
                    isDisabled={!isHealthAcknowledged}
                    isPending={pendingAction === 'health-reporting'}
                    isSelected={
                      (isHealthAcknowledged &&
                        preferences?.healthReportingEnabled) ??
                      false
                    }
                    label="Share privacy-bounded update health reports"
                    onChange={(selected) =>
                      void runAction('health-reporting', () =>
                        onUpdatePreferences({
                          healthReportingEnabled: selected,
                        }),
                      )
                    }
                  />
                  <Button
                    aria-label={
                      isHealthAcknowledged
                        ? 'Withdraw health report approval'
                        : 'Acknowledge health report disclosure'
                    }
                    className="min-h-10 shrink-0"
                    isDisabled={!preferences}
                    isPending={pendingAction === 'disclosure'}
                    onPress={() =>
                      void runAction('disclosure', () =>
                        isHealthAcknowledged
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
                    variant={isHealthAcknowledged ? 'ghost' : 'secondary'}
                  >
                    {isHealthAcknowledged ? 'Withdraw' : 'Acknowledge'}
                  </Button>
                </div>
              </section>
            </Modal.Body>

            <Modal.Footer className="flex-wrap">
              <Button
                className="min-h-10"
                isDisabled={isBusy}
                onPress={() => onOpenChange(false)}
                variant="ghost"
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
                  className={PRIMARY_ACTION_CLASS}
                  isDisabled={isBusy}
                  isPending={pendingAction === 'check'}
                  onPress={() => void runAction('check', onCheck)}
                >
                  Check for updates
                </Button>
              ) : null}

              {presentation.canDownload ? (
                <Button
                  className={
                    presentation.isCritical ? 'min-h-10' : PRIMARY_ACTION_CLASS
                  }
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
                  className={PRIMARY_ACTION_CLASS}
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
                  className={
                    presentation.isCritical ? 'min-h-10' : PRIMARY_ACTION_CLASS
                  }
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
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
