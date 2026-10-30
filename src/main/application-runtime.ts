export interface ApplicationRuntimeDependencies {
  closeDatabase: () => void
  createMainWindow: () => void
  hasWindows: () => boolean
  initializeServices: () => boolean
  quiescePersistenceWrites: () => Promise<void>
  reapStoppedManagedSessions: () => void
  registerIpcHandlers: () => void
  registerRecoveryIpcHandlers: () => void
  refreshKnownGoodBackup: () => void
  shutdownServices: () => Promise<void>
  startReaper: (
    callback: () => void,
    interval: number,
  ) => { unref?: () => void }
}

export class ApplicationRuntime {
  private reaperStarted = false
  private shutdownComplete = false
  private shutdownPromise: Promise<void> | undefined

  constructor(private readonly dependencies: ApplicationRuntimeDependencies) {}

  start(): void {
    const servicesInitialized = this.dependencies.initializeServices()
    this.dependencies.registerRecoveryIpcHandlers()
    if (servicesInitialized) {
      this.startReaper()
      this.dependencies.registerIpcHandlers()
    }
    this.dependencies.createMainWindow()
  }

  resume(): boolean {
    const servicesInitialized = this.dependencies.initializeServices()
    if (!servicesInitialized) {
      return false
    }

    this.dependencies.registerIpcHandlers()
    this.startReaper()
    return true
  }

  private startReaper(): void {
    if (this.reaperStarted) {
      return
    }

    this.reaperStarted = true
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
    this.shutdownPromise ??= (async () => {
      try {
        await this.dependencies.quiescePersistenceWrites()
        await this.dependencies.shutdownServices()
        this.dependencies.refreshKnownGoodBackup()
      } finally {
        try {
          this.dependencies.closeDatabase()
        } finally {
          this.shutdownComplete = true
        }
      }
    })()
    return this.shutdownPromise
  }

  isShutdownComplete(): boolean {
    return this.shutdownComplete
  }
}
