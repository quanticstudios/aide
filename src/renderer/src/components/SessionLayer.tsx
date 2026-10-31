import { Fragment, type ReactNode } from 'react'
import { useSessionBackend } from '../lib/session-backend'

/** Remounts its children when the session backend switches, so they subscribe through the new transport. */
export default function SessionLayer({
  children,
}: {
  readonly children: ReactNode
}) {
  return <Fragment key={useSessionBackend()}>{children}</Fragment>
}
