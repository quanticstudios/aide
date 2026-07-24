import { describe, expect, it, vi } from 'vitest'

import { UpdateHealthReporter } from './update-health-reporter'

const event = {
  arch: 'x64' as const,
  attemptId: 'attempt-1',
  cohort: 7,
  createdAt: '2026-07-24T12:00:00.000Z',
  currentVersion: '0.1.0',
  durationMs: null,
  errorCode: null,
  lifecycle: 'check-started' as const,
  platform: 'linux' as const,
  targetVersion: null,
}

function store(overrides: Record<string, unknown> = {}) {
  return {
    acknowledgeUpdateHealthEvents: vi.fn(),
    getUpdateState: () => ({
      automaticDownloads: true,
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: true,
      installationId: 'never-sent',
      lastCheckedAt: null,
      pendingAttemptId: null,
      pendingTargetVersion: null,
      snoozedUntil: null,
    }),
    listQueuedUpdateHealthEvents: vi.fn(() => [{ event, id: 42 }]),
    ...overrides,
  }
}

describe('UpdateHealthReporter', () => {
  it('fails closed without a valid configured endpoint or consent', async () => {
    const fetch = vi.fn()
    const disabled = new UpdateHealthReporter({
      endpoint: null,
      fetch: fetch as never,
      isPackaged: true,
      store: store(),
    })
    await disabled.flush()
    expect(fetch).not.toHaveBeenCalled()

    for (const endpoint of [
      'https://workers.dev/v1/ota-health/events',
      'https://aide-health.workers.dev/v1/ota-health/events',
      'https://r2.dev/v1/ota-health/events',
      'https://aide-health.r2.dev/v1/ota-health/events',
      'https://aide-health.workers.dev./v1/ota-health/events',
      'https://aide-health.r2.dev./v1/ota-health/events',
    ]) {
      const providerDefault = new UpdateHealthReporter({
        endpoint,
        fetch: fetch as never,
        isPackaged: true,
        store: store(),
      })
      await providerDefault.flush()
    }
    expect(fetch).not.toHaveBeenCalled()

    const noConsent = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: fetch as never,
      isPackaged: true,
      store: store({
        getUpdateState: () => ({
          automaticDownloads: true,
          healthDisclosureAcknowledged: false,
          healthReportingEnabled: true,
          installationId: 'never-sent',
          lastCheckedAt: null,
          pendingAttemptId: null,
          pendingTargetVersion: null,
          snoozedUntil: null,
        }),
      }),
    })
    await noConsent.flush()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('posts only the fixed batch and acknowledges exact rows after 202', async () => {
    const state = store()
    const fetch = vi.fn(async () => new Response(null, { status: 202 }))
    const reporter = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: fetch as never,
      isPackaged: true,
      now: () => new Date('2026-07-24T12:01:00.000Z'),
      store: state,
    })

    await reporter.flush()

    const call = fetch.mock.calls.at(0) as unknown as [string, RequestInit]
    expect(call[0]).toBe('https://health.example.test/v1/ota-health/events')
    expect(call[1]).toEqual(
      expect.objectContaining({ method: 'POST', redirect: 'error' }),
    )
    const body = JSON.parse(call[1].body as string)
    expect(body).toEqual({ events: [event], schemaVersion: 1 })
    expect(JSON.stringify(body)).not.toContain('never-sent')
    expect(state.acknowledgeUpdateHealthEvents).toHaveBeenCalledWith([42])
  })

  it('deduplicates concurrent flush scheduling into one upload', async () => {
    let resolve: ((response: Response) => void) | undefined
    const fetch = vi.fn(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        }),
    )
    const reporter = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: fetch as never,
      isPackaged: true,
      store: store(),
    })

    const first = reporter.flush()
    const second = reporter.flush()
    expect(first).toBe(second)
    await Promise.resolve()
    expect(fetch).toHaveBeenCalledTimes(1)
    resolve?.(new Response(null, { status: 202 }))
    await first
  })

  it('retains the queued rows for retry after rejection or transport failure', async () => {
    const state = store()
    const reporter = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: vi.fn(async () => new Response(null, { status: 429 })) as never,
      isPackaged: true,
      store: state,
    })
    await reporter.flush()
    expect(state.acknowledgeUpdateHealthEvents).not.toHaveBeenCalled()
  })

  it('aborts an in-flight request when consent is withdrawn', async () => {
    let consent = true
    const state = store({
      getUpdateState: () => ({
        automaticDownloads: true,
        healthDisclosureAcknowledged: consent,
        healthReportingEnabled: true,
        installationId: 'never-sent',
        lastCheckedAt: null,
        pendingAttemptId: null,
        pendingTargetVersion: null,
        snoozedUntil: null,
      }),
    })
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error()))
        }),
    )
    const reporter = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: fetch as never,
      isPackaged: true,
      store: state,
    })
    const pending = reporter.flush()
    await Promise.resolve()
    consent = false
    reporter.handlePreferencesChanged()
    await pending
    expect(state.acknowledgeUpdateHealthEvents).not.toHaveBeenCalled()
  })

  it('stops an in-flight upload even when no interval was created', async () => {
    const state = store()
    let resolve: ((response: Response) => void) | undefined
    const reporter = new UpdateHealthReporter({
      endpoint: 'https://health.example.test/v1/ota-health/events',
      fetch: vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done
          }),
      ) as never,
      isPackaged: true,
      store: state,
    })

    const pending = reporter.flush()
    await Promise.resolve()
    reporter.stop()
    resolve?.(new Response(null, { status: 202 }))
    await pending

    expect(state.acknowledgeUpdateHealthEvents).not.toHaveBeenCalled()
    await reporter.flush()
    expect(state.listQueuedUpdateHealthEvents).toHaveBeenCalledTimes(1)
  })
})
