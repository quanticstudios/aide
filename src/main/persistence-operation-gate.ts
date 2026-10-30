const SHUTDOWN_ERROR =
  'Aide is shutting down, so this operation cannot be started.'

/**
 * Admits operations which must finish before sessions are stopped and the
 * database is closed. Operations admitted before quiescing are drained;
 * operations arriving afterwards are rejected.
 */
export class PersistenceOperationGate {
  private drainPromise: Promise<void> | null = null
  private inFlight = 0
  private quiescing = false
  private resolveDrain: (() => void) | null = null

  public quiesce(): Promise<void> {
    this.quiescing = true
    if (this.inFlight === 0) {
      return Promise.resolve()
    }

    this.drainPromise ??= new Promise<void>((resolve) => {
      this.resolveDrain = resolve
    })
    return this.drainPromise
  }

  public resume(): void {
    this.quiescing = false
  }

  public run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.quiescing) {
      return Promise.reject(new Error(SHUTDOWN_ERROR))
    }

    this.inFlight += 1
    try {
      return Promise.resolve(operation()).finally(() => this.finish())
    } catch (error) {
      this.finish()
      return Promise.reject(error)
    }
  }

  private finish(): void {
    this.inFlight -= 1
    if (!this.quiescing || this.inFlight !== 0) {
      return
    }

    this.resolveDrain?.()
    this.resolveDrain = null
    this.drainPromise = null
  }
}
