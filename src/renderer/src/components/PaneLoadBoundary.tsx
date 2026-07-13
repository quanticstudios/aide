import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react'

interface PaneLoadBoundaryProps {
  readonly children: ReactNode
  readonly paneId: string
  readonly paneName: string
}

interface PaneLoadErrorBoundaryProps {
  readonly children: ReactNode
  readonly paneId: string
  readonly paneName: string
}

interface PaneLoadErrorBoundaryState {
  readonly error: Error | null
}

export function PaneLoadFallback({
  paneId,
  paneName,
}: Omit<PaneLoadBoundaryProps, 'children'>) {
  return (
    <section
      aria-live="polite"
      className="flex h-full min-h-0 w-full items-center justify-center p-6"
      data-testid={`pane-loading-${paneId}`}
    >
      <div className="max-w-sm text-center">
        <p className="text-sm font-medium text-foreground">
          Loading {paneName}…
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Preparing this pane without blocking workspace navigation.
        </p>
      </div>
    </section>
  )
}

export function PaneLoadError({
  error,
  paneId,
  paneName,
}: {
  readonly error: Error
  readonly paneId: string
  readonly paneName: string
}) {
  return (
    <section
      aria-live="assertive"
      className="flex h-full min-h-0 w-full items-center justify-center p-6"
      data-testid={`pane-load-error-${paneId}`}
    >
      <div className="max-w-sm rounded-lg border border-accent-red bg-accent-red-soft p-5 text-center">
        <p className="text-sm font-medium text-accent-red">
          {paneName} could not load
        </p>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Reload the app window and try again.
        </p>
      </div>
    </section>
  )
}

class PaneLoadErrorBoundary extends Component<
  PaneLoadErrorBoundaryProps,
  PaneLoadErrorBoundaryState
> {
  state: PaneLoadErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): PaneLoadErrorBoundaryState {
    return { error }
  }

  componentDidCatch(_error: Error, _errorInfo: ErrorInfo): void {
    // The fallback keeps the shell interactive when a deferred pane chunk fails.
  }

  render() {
    const { children, paneId, paneName } = this.props

    if (this.state.error) {
      return (
        <PaneLoadError
          error={this.state.error}
          paneId={paneId}
          paneName={paneName}
        />
      )
    }

    return children
  }
}

export function PaneLoadBoundary({
  children,
  paneId,
  paneName,
}: PaneLoadBoundaryProps) {
  return (
    <PaneLoadErrorBoundary paneId={paneId} paneName={paneName}>
      <Suspense
        fallback={<PaneLoadFallback paneId={paneId} paneName={paneName} />}
      >
        {children}
      </Suspense>
    </PaneLoadErrorBoundary>
  )
}
