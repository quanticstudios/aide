export interface ApplicationRuntimeDependencies {
  createMainWindow: () => void
  hasWindows: () => boolean
  initializeServices: () => void
  reapStoppedManagedSessions: () => void
  registerIpcHandlers: () => void
  shutdownServices: () => Promise<void>
  startReaper: (
    callback: () => void,
    interval: number,
  ) => { unref?: () => void }
}

export class ApplicationRuntime {
  private shutdownComplete = false
  private shutdownPromise: Promise<void> | undefined

  constructor(private readonly dependencies: ApplicationRuntimeDependencies) {}

  start(): void {
    this.dependencies.initializeServices()
    this.dependencies.registerIpcHandlers()
    this.dependencies.createMainWindow()

    this.dependencies
      .startReaper(
        () => this.dependencies.reapStoppedManagedSessions(),
        5 * 60_000,
      )
      .unref?.()
  }

  ensureMainWindow(): void {
    if (!this.dependencies.hasWindows()) {
      this.dependencies.createMainWindow()
    }
  }

  shutdown(): Promise<void> {
    this.shutdownPromise ??= this.dependencies
      .shutdownServices()
      .finally(() => {
        this.shutdownComplete = true
      })
    return this.shutdownPromise
  }

  isShutdownComplete(): boolean {
    return this.shutdownComplete
  }
}
