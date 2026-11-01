import { Button } from '@heroui/react'
import { Info } from 'lucide-react'
import { useState } from 'react'
import {
  dismissDaemonDefaultNotice,
  isDaemonDefaultNoticeDue,
} from '../lib/session-backend'

/** Tells an upgraded install, once, that sessions now run on pitwall's daemon. */
export default function DaemonDefaultNotice() {
  const [isOpen, setIsOpen] = useState(isDaemonDefaultNoticeDue)
  if (!isOpen) return null

  const close = () => {
    dismissDaemonDefaultNotice()
    setIsOpen(false)
  }
  return (
    <div
      aria-label="Sessions now run on pitwall"
      className="fixed bottom-4 left-4 z-50 w-[calc(100vw-2rem)] max-w-sm rounded-lg border border-border bg-surface px-4 py-3 shadow-lg"
      data-testid="daemon-default-notice"
      role="dialog"
    >
      <div className="flex items-start gap-3">
        <Info className="mt-0.5 size-4 shrink-0 text-accent-blue" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            Sessions now run on pitwall
          </p>
          <p className="mt-1 text-sm text-foreground">
            New sessions run in pitwall's daemon, so they keep going when you
            close aide or restart, and resume where they left off. Your earlier
            sessions move into pitwall too, and stay in task history.
          </p>
          <div className="mt-3">
            <Button onPress={close} size="sm" variant="primary">
              Got it
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
