import { describe, expect, it, vi } from 'vitest'
import { MAX_UPDATE_HEALTH_BATCH_BYTES } from '../../../src/shared/update-health'
import worker, { purgeExpiredEvents } from './index'

const event = {
  arch: 'x64',
  attemptId: 'attempt-1',
  cohort: 7,
  createdAt: '2026-07-24T12:00:00.000Z',
  currentVersion: '0.1.0',
  durationMs: null,
  errorCode: null,
  lifecycle: 'check-started',
  platform: 'linux',
  targetVersion: null,
}

function env(overrides: Record<string, unknown> = {}) {
  const run = vi.fn(async () => ({ success: true }))
  const bind = vi.fn(() => ({ run }))
  return {
    DB: { prepare: vi.fn(() => ({ bind })) },
    HEALTH_ATTEMPT_RATE: { limit: vi.fn(async () => ({ success: true })) },
    bind,
    ...overrides,
  }
}

describe('OTA health worker', () => {
  it('accepts only the exact POST contract and persists no request metadata', async () => {
    const runtime = env()
    const response = await worker.fetch(
      new Request('https://health.example.test/v1/ota-health/events', {
        body: JSON.stringify({ events: [event], schemaVersion: 1 }),
        headers: {
          'cf-connecting-ip': '192.0.2.99',
          'content-type': 'application/json',
          'user-agent': 'private-agent',
        },
        method: 'POST',
      }),
      runtime as never,
      {} as never,
    )
    expect(response.status).toBe(202)
    expect(runtime.HEALTH_ATTEMPT_RATE.limit).toHaveBeenCalledWith({
      key: 'attempt-1',
    })
    expect(runtime.DB.prepare.mock.calls[0]?.[0]).not.toContain('ip')
    expect(runtime.DB.prepare.mock.calls[0]?.[0]).not.toContain('header')
    expect(runtime.DB.prepare.mock.calls[0]?.[0]).not.toContain('user_agent')
    expect(runtime.bind.mock.calls[0]?.[10]).toMatch(/T\d{2}:\d{2}:00\.000Z$/)
  })

  it('rejects unknown input and rate-limited batches without writing', async () => {
    const runtime = env({
      HEALTH_ATTEMPT_RATE: { limit: vi.fn(async () => ({ success: false })) },
    })
    const response = await worker.fetch(
      new Request('https://health.example.test/v1/ota-health/events', {
        body: JSON.stringify({
          events: [{ ...event, path: '/secret' }],
          schemaVersion: 1,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      runtime as never,
      {} as never,
    )
    expect(response.status).toBe(400)
    expect(runtime.DB.prepare).not.toHaveBeenCalled()

    const limited = await worker.fetch(
      new Request('https://health.example.test/v1/ota-health/events', {
        body: JSON.stringify({ events: [event], schemaVersion: 1 }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      runtime as never,
      {} as never,
    )
    expect(limited.status).toBe(429)
    expect(runtime.DB.prepare).not.toHaveBeenCalled()
  })

  it('rate limits each opaque attempt once per batch', async () => {
    const runtime = env()
    const response = await worker.fetch(
      new Request('https://health.example.test/v1/ota-health/events', {
        body: JSON.stringify({
          events: Array.from({ length: 8 }, (_, index) => ({
            ...event,
            lifecycle: index % 2 === 0 ? 'check-started' : 'download-started',
          })),
          schemaVersion: 1,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      }),
      runtime as never,
      {} as never,
    )

    expect(response.status).toBe(202)
    expect(runtime.HEALTH_ATTEMPT_RATE.limit).toHaveBeenCalledTimes(1)
  })

  it('cancels a headerless streamed body as soon as it exceeds the bound', async () => {
    const runtime = env()
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({
      cancel,
      start(controller) {
        controller.enqueue(new Uint8Array(MAX_UPDATE_HEALTH_BATCH_BYTES))
        controller.enqueue(new Uint8Array([1]))
      },
    })
    const request = new Request(
      'https://health.example.test/v1/ota-health/events',
      {
        body,
        duplex: 'half',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      } as RequestInit & { duplex: 'half' },
    )

    const response = await worker.fetch(request, runtime as never, {} as never)

    expect(response.status).toBe(413)
    expect(cancel).toHaveBeenCalledOnce()
    expect(runtime.DB.prepare).not.toHaveBeenCalled()
  })

  it('purges raw records older than thirty days', async () => {
    const runtime = env()
    await purgeExpiredEvents(
      runtime as never,
      new Date('2026-07-31T00:00:00.000Z'),
    )
    expect(runtime.DB.prepare.mock.calls[0]?.[0]).toContain(
      'DELETE FROM ota_health_events',
    )
    expect(runtime.bind.mock.calls[0]?.[0]).toBe('2026-07-01T00:00:00.000Z')
  })
})
