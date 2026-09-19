import { Button, Modal } from '@heroui/react'
import { useEffect, useState } from 'react'

import type { DiagnosticsSnapshot } from '../../../shared/diagnostics'
import type { AideApi } from '../../../shared/ipc'

function getAideApi(): AideApi | null {
  return typeof window === 'undefined' ? null : (window.aide ?? null)
}

function formatEventType(type: string): string {
  return type.replaceAll('-', ' ')
}

interface DiagnosticsModalProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
}

export default function DiagnosticsModal({
  isOpen,
  onOpenChange,
}: DiagnosticsModalProps) {
  const [snapshot, setSnapshot] = useState<DiagnosticsSnapshot | null>(null)
  const [isExporting, setIsExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const aide = getAideApi()
    if (!aide) {
      return
    }

    // Subscribe before fetching so a diagnostics event cannot be lost during hydration.
    let isDisposed = false
    const updateSnapshot = (nextSnapshot: DiagnosticsSnapshot) => {
      if (isDisposed) return
      setSnapshot((currentSnapshot) =>
        !currentSnapshot || nextSnapshot.revision >= currentSnapshot.revision
          ? nextSnapshot
          : currentSnapshot,
      )
    }
    const unsubscribe = aide.onDiagnosticsEvent(updateSnapshot)
    void aide
      .getDiagnosticsSnapshot()
      .then(updateSnapshot)
      .catch(() => {
        if (!isDisposed) setExportStatus('Local diagnostics are unavailable.')
      })

    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [isOpen])

  async function exportBundle(): Promise<void> {
    const aide = getAideApi()
    if (!aide) {
      return
    }

    setIsExporting(true)
    setExportStatus(null)
    try {
      const result = await aide.exportSupportBundle()
      setExportStatus(
        result.status === 'exported'
          ? 'Support bundle exported.'
          : 'Support bundle export cancelled.',
      )
    } catch {
      setExportStatus('Support bundle export failed.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="rounded-xl floating-surface">
            <Modal.Header>
              <Modal.Heading>Diagnostics</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <div className="space-y-4 text-sm">
                <p className="text-muted-foreground">
                  Diagnostics stay on this device. Support bundles contain only
                  app versions and crash event types with timestamps.
                </p>
                <p className="rounded-md border border-border bg-surface-tertiary p-3 text-xs text-muted-foreground">
                  Prompts, terminal output, patches, credentials, environment
                  values, and home paths are never included.
                </p>
                {snapshot ? (
                  <>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-border p-3 text-xs">
                      <div>
                        <dt className="text-muted-foreground">aIDE</dt>
                        <dd>{snapshot.runtime.appVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Electron</dt>
                        <dd>{snapshot.runtime.electronVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Chrome</dt>
                        <dd>{snapshot.runtime.chromeVersion}</dd>
                      </div>
                      <div>
                        <dt className="text-muted-foreground">Node</dt>
                        <dd>{snapshot.runtime.nodeVersion}</dd>
                      </div>
                    </dl>
                    <div>
                      <p className="mb-2 text-xs font-semibold text-foreground">
                        Recent diagnostic events
                      </p>
                      {snapshot.recentEvents.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No captured crashes or exceptions in this session.
                        </p>
                      ) : (
                        <ul className="space-y-1 text-xs text-muted-foreground">
                          {snapshot.recentEvents.map((event) => (
                            <li
                              className="flex justify-between gap-3 rounded border border-border px-2 py-1.5"
                              key={`${event.occurredAt}-${event.type}`}
                            >
                              <span className="text-foreground">
                                {formatEventType(event.type)}
                              </span>
                              <time dateTime={event.occurredAt}>
                                {new Intl.DateTimeFormat(undefined, {
                                  dateStyle: 'short',
                                  timeStyle: 'medium',
                                }).format(new Date(event.occurredAt))}
                              </time>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Loading local diagnostics…
                  </p>
                )}
                {exportStatus ? (
                  <p
                    aria-live="polite"
                    className="text-xs text-muted-foreground"
                  >
                    {exportStatus}
                  </p>
                ) : null}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button onPress={() => onOpenChange(false)} variant="ghost">
                Close
              </Button>
              <Button
                isDisabled={isExporting}
                onPress={() => void exportBundle()}
              >
                {isExporting ? 'Exporting…' : 'Export support bundle'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}
