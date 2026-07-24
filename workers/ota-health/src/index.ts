import type { UpdateHealthBatch } from '../../../src/shared/update-health'
import {
  coarsenUpdateHealthTimestamp,
  MAX_UPDATE_HEALTH_BATCH_BYTES,
  parseUpdateHealthBatch,
} from '../../../src/shared/update-health'

interface D1Statement {
  bind: (...values: unknown[]) => D1Statement
  run: () => Promise<unknown>
}

interface D1Database {
  prepare: (query: string) => D1Statement
}

interface RateLimiter {
  limit: (input: { key: string }) => Promise<{ success: boolean }>
}

export interface OtaHealthEnvironment {
  DB: D1Database
  HEALTH_ATTEMPT_RATE: RateLimiter
}

const INGEST_PATH = '/v1/ota-health/events'
const RAW_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000

function response(status: number): Response {
  return new Response(null, { status })
}

async function digestEvent(event: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(event))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)]
    .map((part) => part.toString(16).padStart(2, '0'))
    .join('')
}

async function readBoundedBody(request: Request): Promise<Uint8Array | null> {
  if (!request.body) return new Uint8Array()
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_UPDATE_HEALTH_BATCH_BYTES) {
        await reader.cancel().catch(() => undefined)
        return null
      }
      chunks.push(value)
    }
  } catch {
    return new Uint8Array()
  }

  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

export async function purgeExpiredEvents(
  env: OtaHealthEnvironment,
  now = new Date(),
): Promise<void> {
  const cutoff = new Date(now.getTime() - RAW_RETENTION_MS).toISOString()
  await env.DB.prepare('DELETE FROM ota_health_events WHERE received_at < ?')
    .bind(cutoff)
    .run()
}

async function ingest(
  request: Request,
  env: OtaHealthEnvironment,
): Promise<Response> {
  if (request.headers.get('content-type') !== 'application/json') {
    return response(415)
  }
  const contentLength = request.headers.get('content-length')
  if (
    contentLength &&
    (!/^\d+$/.test(contentLength) ||
      Number(contentLength) > MAX_UPDATE_HEALTH_BATCH_BYTES)
  ) {
    return response(413)
  }
  const bytes = await readBoundedBody(request)
  if (bytes === null) return response(413)

  let batch: UpdateHealthBatch
  try {
    batch = parseUpdateHealthBatch(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)),
    )
  } catch {
    return response(400)
  }
  for (const attemptId of new Set(
    batch.events.map((event) => event.attemptId),
  )) {
    if (!(await env.HEALTH_ATTEMPT_RATE.limit({ key: attemptId })).success) {
      return response(429)
    }
  }
  const receivedAt = coarsenUpdateHealthTimestamp(new Date().toISOString())
  try {
    for (const event of batch.events) {
      await env.DB.prepare(
        `
            INSERT OR IGNORE INTO ota_health_events (
              event_key, attempt_id, current_version, target_version, platform,
              arch, cohort, lifecycle, error_code, occurred_at, received_at,
              duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
      )
        .bind(
          await digestEvent(event),
          event.attemptId,
          event.currentVersion,
          event.targetVersion,
          event.platform,
          event.arch,
          event.cohort,
          event.lifecycle,
          event.errorCode,
          event.createdAt,
          receivedAt,
          event.durationMs,
        )
        .run()
    }
    await purgeExpiredEvents(env, new Date(receivedAt))
  } catch {
    return response(503)
  }
  return response(202)
}

export default {
  async fetch(request: Request, env: OtaHealthEnvironment): Promise<Response> {
    const url = new URL(request.url)
    if (
      request.method !== 'POST' ||
      url.pathname !== INGEST_PATH ||
      url.search
    ) {
      return response(404)
    }
    return ingest(request, env)
  },
  async scheduled(
    _controller: unknown,
    env: OtaHealthEnvironment,
  ): Promise<void> {
    await purgeExpiredEvents(env)
  },
}
