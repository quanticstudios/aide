import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useSyncExternalStore } from 'react'
import type { DaemonTransport } from '../lib/daemon-transport'

interface DaemonConnectionBannerProps {
  readonly transport: Pick<
    DaemonTransport,
    'getConnection' | 'subscribeConnection'
  >
}

/** Says when aide is not connected to pitwall's daemon, and so read-only, or cannot talk to this pitwall at all. */
export default function DaemonConnectionBanner({
  transport,
}: DaemonConnectionBannerProps) {
  const connection = useSyncExternalStore(
    transport.subscribeConnection,
    transport.getConnection,
    transport.getConnection,
  )
  if (connection.status === 'connected') return null

  const incompatible = connection.status === 'incompatible'
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-2 z-50 mx-auto flex w-fit max-w-[90vw] items-center gap-2 rounded-lg border px-3 py-1.5 text-sm text-foreground ${
        incompatible
          ? 'border-accent-red bg-accent-red-soft'
          : 'border-accent-yellow/50 bg-accent-yellow-soft'
      }`}
      data-testid="daemon-connection-banner"
      role={incompatible ? 'alert' : 'status'}
    >
      {incompatible ? (
        <AlertTriangle className="size-4 shrink-0 text-accent-red" />
      ) : (
        <RefreshCw className="size-4 shrink-0 animate-spin text-accent-yellow motion-reduce:animate-none" />
      )}
      <span>
        {incompatible
          ? connection.message
          : `${connection.status === 'connecting' ? 'Connecting' : 'Reconnecting'} to pitwall... Read-only until it is back.`}
      </span>
    </div>
  )
}
