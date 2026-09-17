import { z } from 'zod'
import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'

const tokenCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const tokenBreakdown = z
  .object({
    inputTokens: tokenCount,
    outputTokens: tokenCount,
    cachedInputTokens: tokenCount,
    cacheWriteInputTokens: tokenCount.optional(),
    totalTokens: tokenCount,
  })
  .refine(
    (usage) =>
      usage.cachedInputTokens + (usage.cacheWriteInputTokens ?? 0) <=
      usage.inputTokens,
  )
const usageNotification = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  tokenUsage: z.object({
    total: tokenBreakdown,
    last: tokenBreakdown,
    modelContextWindow: tokenCount.nullish(),
  }),
})

/** Parses Codex query totals separately from its latest context measurement. */
export function parseCodexUsage(
  input: unknown,
  model: string | null,
  createdAt: string,
): Extract<
  ManagedProviderRuntimeEvent,
  { type: 'session.usage.updated' }
> | null {
  const parsed = usageNotification.safeParse(input)
  if (!parsed.success) return null
  const { threadId, turnId, tokenUsage } = parsed.data
  const { total, last, modelContextWindow } = tokenUsage
  return {
    type: 'session.usage.updated',
    provider: 'codex',
    createdAt,
    inputTokens: total.inputTokens,
    outputTokens: total.outputTokens,
    cachedInputTokens: total.cachedInputTokens,
    contextTokens: last.totalTokens,
    ...(modelContextWindow ? { maxTokens: modelContextWindow } : {}),
    report: {
      id: turnId,
      turnId,
      scopeId: threadId,
      provider: 'codex',
      createdAt,
      estimatedCostUsd: null,
      models: [
        {
          model,
          inputTokens:
            total.inputTokens -
            total.cachedInputTokens -
            (total.cacheWriteInputTokens ?? 0),
          outputTokens: total.outputTokens,
          cachedInputTokens: total.cachedInputTokens,
          cacheCreationInputTokens: total.cacheWriteInputTokens ?? null,
          estimatedCostUsd: null,
        },
      ],
    },
  }
}
