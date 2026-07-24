import type { UpdateHealthEvent, UpdateState } from '../shared/update'
import {
  MAX_UPDATE_HEALTH_BATCH_BYTES,
  MAX_UPDATE_HEALTH_BATCH_EVENTS,
  UPDATE_HEALTH_BATCH_SCHEMA_VERSION,
} from '../shared/update-health'
import { validateUpdateHealthEndpoint } from '../shared/update-health-endpoint.mjs'

export interface UpdateHealthQueueStore {
  acknowledgeUpdateHealthEvents: (ids: readonly number[]) => void
  getUpdateState: () => UpdateState
  listQueuedUpdateHealthEvents: (
    limit: number,
    now: string,
  ) => ReadonlyArray<{ event: UpdateHealthEvent; id: number }>
}

export interface UpdateHealthReporterOptions {
  endpoint: string | null
  fetch?: typeof globalThis.fetch
  isPackaged: boolean
  now?: () => Date
  setInterval?: typeof globalThis.setInterval
  clearInterval?: typeof globalThis.clearInterval
  store: UpdateHealthQueueStore
}

const RETRY_INTERVAL_MS = 15 * 60 * 1_000
const REQUEST_TIMEOUT_MS = 10_000
export class UpdateHealthReporter {
  private flushPromise: Promise<void> | null = null
  private interval: ReturnType<typeof setInterval> | null = null
  private activeController: AbortController | null = null
  private stopped = false
  private readonly endpoint: string | null

  public constructor(private readonly options: UpdateHealthReporterOptions) {
    this.endpoint = validateUpdateHealthEndpoint(options.endpoint)
  }

  public start(): void {
    if (!this.endpoint || !this.options.isPackaged || this.interval) return
    this.stopped = false
    const setInterval = this.options.setInterval ?? globalThis.setInterval
    this.interval = setInterval(() => void this.flush(), RETRY_INTERVAL_MS)
    void this.flush()
  }

  public stop(): void {
    this.stopped = true
    this.activeController?.abort()
    if (this.interval !== null) {
      const clearInterval =
        this.options.clearInterval ?? globalThis.clearInterval
      clearInterval(this.interval)
      this.interval = null
    }
  }

  public flush(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    if (this.flushPromise) return this.flushPromise
    this.flushPromise = this.upload().finally(() => {
      this.flushPromise = null
    })
    return this.flushPromise
  }

  /** Preference changes can revoke consent while an upload is in flight. */
  public handlePreferencesChanged(): void {
    if (!this.hasConsent()) {
      this.activeController?.abort()
      return
    }
    void this.flush()
  }

  private async upload(): Promise<void> {
    if (
      this.stopped ||
      !this.endpoint ||
      !this.options.isPackaged ||
      !this.hasConsent()
    ) {
      return
    }
    const now = (this.options.now?.() ?? new Date()).toISOString()
    const queued = this.options.store.listQueuedUpdateHealthEvents(
      MAX_UPDATE_HEALTH_BATCH_EVENTS,
      now,
    )
    if (this.stopped || queued.length === 0 || !this.hasConsent()) return
    const body = JSON.stringify({
      events: queued.map(({ event }) => event),
      schemaVersion: UPDATE_HEALTH_BATCH_SCHEMA_VERSION,
    })
    if (Buffer.byteLength(body, 'utf8') > MAX_UPDATE_HEALTH_BATCH_BYTES) return

    const controller = new AbortController()
    this.activeController = controller
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await (this.options.fetch ?? globalThis.fetch)(
        this.endpoint,
        {
          body,
          headers: { 'content-type': 'application/json' },
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
        },
      )
      if (response.status === 202 && !this.stopped && this.hasConsent()) {
        this.options.store.acknowledgeUpdateHealthEvents(
          queued.map(({ id }) => id),
        )
      }
    } catch {
      // A bounded local queue deliberately retries without retaining transport detail.
    } finally {
      clearTimeout(timer)
      if (this.activeController === controller) this.activeController = null
    }
  }

  private hasConsent(): boolean {
    const state = this.options.store.getUpdateState()
    return state.healthDisclosureAcknowledged && state.healthReportingEnabled
  }
}
