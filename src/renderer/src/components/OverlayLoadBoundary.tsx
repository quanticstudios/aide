import { Button } from '@heroui/react'
import { Component, Suspense, type ReactNode } from 'react'

interface OverlayLoadBoundaryProps {
  readonly children: ReactNode
  readonly fallback: ReactNode
  readonly name: string
  readonly onClose: () => void
  readonly onRetry: () => void
}

interface OverlayErrorBoundaryState {
  readonly hasError: boolean
}

export function OverlayLoadError({
  name,
  onClose,
  onRetry,
}: Pick<OverlayLoadBoundaryProps, 'name' | 'onClose' | 'onRetry'>) {
  return (
    <section
      aria-label={`${name} load error`}
      aria-modal="true"
      className="fixed inset-0 z-50 grid place-items-center bg-surface-1 p-6 text-foreground"
      role="dialog"
    >
      <div className="max-w-sm rounded-xl border border-border bg-surface p-5 text-center shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
        <h1 className="text-base font-semibold">{name} could not open</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Return to the app and try again. Reload the app window if the problem
          continues.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <Button autoFocus onPress={onClose} variant="secondary">
            Back to app
          </Button>
          <Button onPress={onRetry} variant="primary">
            Reload app
          </Button>
        </div>
      </div>
    </section>
  )
}

class OverlayErrorBoundary extends Component<
  Omit<OverlayLoadBoundaryProps, 'fallback'>,
  OverlayErrorBoundaryState
> {
  state: OverlayErrorBoundaryState = { hasError: false }

  static getDerivedStateFromError(): OverlayErrorBoundaryState {
    return { hasError: true }
  }

  render() {
    const { children, name, onClose, onRetry } = this.props

    return this.state.hasError ? (
      <OverlayLoadError name={name} onClose={onClose} onRetry={onRetry} />
    ) : (
      children
    )
  }
}

export default function OverlayLoadBoundary({
  children,
  fallback,
  name,
  onClose,
  onRetry,
}: OverlayLoadBoundaryProps) {
  return (
    <OverlayErrorBoundary name={name} onClose={onClose} onRetry={onRetry}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </OverlayErrorBoundary>
  )
}
