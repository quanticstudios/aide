import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ContextPreparation } from './context-preparation'
import { retrieveContext, validateContextRevisions } from './context-retrieval'
import { JEV_MODEL, JevClient, JevClientError } from './jev-client'
import type { ManagedSessionPreparationInput } from './managed-session-manager'

vi.mock('./context-retrieval', () => ({
  retrieveContext: vi.fn(),
  validateContextRevisions: vi.fn(),
}))

const excerpt = (id: string) => ({
  content: `original ${id}`,
  contentRevision: `revision-${id}`,
  endLine: 1,
  id,
  path: `${id}.ts`,
  startLine: 1,
})

function input(): ManagedSessionPreparationInput {
  return {
    config: {
      cwd: '/workspace',
      mode: 'claude',
      paneId: 'agent',
      sessionId: 'conversation',
      workspaceId: 'workspace',
    },
    history: [
      {
        role: 'assistant',
        provider: 'codex',
        text: 'Earlier fact: the timeout is 30 seconds.',
      },
    ],
    reportUsage: vi.fn(),
    shouldDeliverHistory: true,
    signal: new AbortController().signal,
    text: 'Check the timeout.',
  }
}

beforeEach(() => {
  vi.mocked(retrieveContext).mockResolvedValue({
    candidates: Array.from({ length: 8 }, (_, index) =>
      excerpt(`candidate-${index}`),
    ),
    mandatory: [excerpt('instructions')],
    omitted: [],
  })
  vi.mocked(validateContextRevisions).mockResolvedValue(undefined)
  vi.spyOn(JevClient.prototype, 'evaluateCandidates').mockImplementation(
    async ({ candidates }) => ({
      answers: candidates.map((candidate, index) => ({
        candidateId: candidate.id,
        contentRevision: candidate.contentRevision,
        path: candidate.path,
        noul: index / 10,
        type: 'noul',
      })),
      estimatedCost: { amountUsd: 0.000042, currency: 'USD', kind: 'estimate' },
      model: JEV_MODEL,
      usage: { inputTokens: 1000, outputTokens: 20 },
    }),
  )
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

it('preserves mandatory evidence, baseline excerpts, quoted history and original prompt while recording each charged call once', async () => {
  const service = new ContextPreparation({ requireApiKey: () => 'test-key' })
  const request = input()
  const prepared = await service.prepare(request)
  expect(prepared.text.startsWith(request.text)).toBe(true)
  expect(prepared.text).toContain('original instructions')
  expect(prepared.text).toContain('original candidate-0')
  expect(prepared.text).toContain('original candidate-7')
  expect(prepared.text).not.toContain('original candidate-2')
  expect(prepared.text).toContain('Earlier fact: the timeout is 30 seconds.')
  expect(request.reportUsage).toHaveBeenCalledWith(
    expect.objectContaining({ provider: 'jev', estimatedCostUsd: 0.000042 }),
  )
  await service.prepare(request)
  expect(JevClient.prototype.evaluateCandidates).toHaveBeenCalledTimes(1)
  expect(request.reportUsage).toHaveBeenCalledTimes(1)
  expect(validateContextRevisions).toHaveBeenCalledTimes(2)
})

it('evaluates conversation evidence when there are no optional workspace excerpts', async () => {
  vi.mocked(retrieveContext).mockResolvedValue({
    candidates: [],
    mandatory: [],
    omitted: [],
  })
  const service = new ContextPreparation({ requireApiKey: () => 'test-key' })
  await service.prepare(input())
  expect(JevClient.prototype.evaluateCandidates).toHaveBeenCalledWith(
    expect.objectContaining({
      candidates: [expect.objectContaining({ id: 'current-request' })],
    }),
    expect.any(AbortSignal),
  )
})

it('pauses on unavailable Jev and honors Retry-After without returning a provider prompt', async () => {
  vi.mocked(JevClient.prototype.evaluateCandidates).mockRejectedValue(
    new JevClientError(
      'rate-limited',
      'TypeSafe rate limited the request.',
      60_000,
    ),
  )
  const service = new ContextPreparation({ requireApiKey: () => 'test-key' })
  const request = input()
  await expect(service.prepare(request)).rejects.toThrow(
    'Jev paused this request',
  )
  await expect(service.prepare(request)).rejects.toThrow('Retry in')
  expect(JevClient.prototype.evaluateCandidates).toHaveBeenCalledTimes(1)
  expect(request.reportUsage).not.toHaveBeenCalled()
})

it('keeps incurred usage when files change or cancellation happens before dispatch', async () => {
  vi.mocked(validateContextRevisions).mockRejectedValueOnce(
    new Error('Evidence changed after retrieval'),
  )
  const service = new ContextPreparation({ requireApiKey: () => 'test-key' })
  const request = input()
  await expect(service.prepare(request)).rejects.toThrow(
    'changed after retrieval',
  )
  expect(request.reportUsage).toHaveBeenCalledTimes(1)
  const controller = new AbortController()
  controller.abort()
  await expect(
    service.prepare({ ...input(), signal: controller.signal }),
  ).rejects.toThrow()
  expect(JevClient.prototype.evaluateCandidates).toHaveBeenCalledTimes(1)
})

it('rechecks workspace permission after Jev returns', async () => {
  const permission = vi
    .fn()
    .mockReturnValueOnce('test-key')
    .mockImplementationOnce(() => {
      throw new Error('Permission withdrawn')
    })
  const request = input()
  await expect(
    new ContextPreparation({ requireApiKey: permission }).prepare(request),
  ).rejects.toThrow('Permission withdrawn')
  expect(request.reportUsage).toHaveBeenCalledTimes(1)
})
