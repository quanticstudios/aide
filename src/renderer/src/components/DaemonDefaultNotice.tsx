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
    <section
      aria-label="Sessions now run on pitwall"
      className="order-first flex shrink-0 items-start gap-3 border-b border-border bg-surface-1 px-4 py-2.5"
      data-testid="daemon-default-notice"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-accent-blue" />
      <div className="min-w-0 flex-1 text-[13px] leading-5">
        <p className="font-semibold text-foreground">
          Sessions now run on pitwall
        </p>
        <p className="text-muted-foreground">
          New sessions run in pitwall's daemon, so they keep going when you
          close aide or restart, and resume where they left off. Your earlier
          sessions move into pitwall too, and stay in task history.
        </p>
      </div>
      <Button className="shrink-0" onPress={close} size="sm" variant="primary">
        Got it
      </Button>
    </section>
  )
}
