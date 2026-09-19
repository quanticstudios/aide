import { describe, expect, it, vi } from 'vitest'

import { JEV_GATE_DEFAULTS } from '../shared/jev-gates'
import { JEV_MODEL, type JevAskInput, type JevAskResult } from './jev-client'
import { JevGates } from './jev-gates'

function answers(values: Record<string, number>): JevAskResult {
  return {
    answers: Object.fromEntries(
      Object.entries(values).map(([key, noul]) => [
        key,
        { type: 'noul', noul },
      ]),
    ),
    estimatedCost: { amountUsd: 0.00001, currency: 'USD', kind: 'estimate' },
    model: JEV_MODEL,
    usage: { inputTokens: 200, outputTokens: 8 },
  }
}

function gates(
  ask: (input: JevAskInput) => Promise<JevAskResult>,
  apiKey: string | null = 'key',
) {
  const rows: unknown[] = []
  const instance = new JevGates({
    createClient: () => ({ ask: vi.fn(ask) }),
    getApiKey: () => apiKey,
    getNow: () => '2026-09-19T10:00:00.000Z',
    log: (row) => rows.push(row),
  })
  return { instance, rows }
}

const toolInput = {
  context: 'User: list the files',
  cwd: '/work',
  id: 'req-1',
  provider: 'claude',
  request: 'Bash: ls -la',
  requestType: 'command-execution-approval',
}

describe('JevGates.judgeTool', () => {
  it('allows when every probability is under the allow bar and logs the row', async () => {
    const { instance, rows } = gates(async () =>
      answers({ destructive: 0.02, exfiltrating: 0.01, off_request: 0.05 }),
    )
    const judgement = await instance.judgeTool(
      toolInput,
      JEV_GATE_DEFAULTS.toolGate,
    )
    expect(judgement.decision).toBe('allow')
    expect(judgement.usage?.inputTokens).toBe(200)
    expect(rows).toEqual([
      expect.objectContaining({
        createdAt: '2026-09-19T10:00:00.000Z',
        decision: 'allow',
        gate: 'tool',
        id: 'req-1',
      }),
    ])
  })

  it('denies when any probability clears the deny bar and prompts in between', async () => {
    const deny = gates(async () =>
      answers({ destructive: 0.95, exfiltrating: 0.01, off_request: 0.05 }),
    )
    expect(
      (await deny.instance.judgeTool(toolInput, JEV_GATE_DEFAULTS.toolGate))
        .decision,
    ).toBe('deny')

    const prompt = gates(async () =>
      answers({ destructive: 0.5, exfiltrating: 0.01, off_request: 0.05 }),
    )
    expect(
      (await prompt.instance.judgeTool(toolInput, JEV_GATE_DEFAULTS.toolGate))
        .decision,
    ).toBe('prompt')
  })

  it('prompts without a key or when Jev fails, and sends the guard line', async () => {
    const noKey = gates(async () => answers({}), null)
    expect(
      (await noKey.instance.judgeTool(toolInput, JEV_GATE_DEFAULTS.toolGate))
        .probabilities,
    ).toBeNull()

    const seen: JevAskInput[] = []
    const failing = gates(async (input) => {
      seen.push(input)
      throw new Error('boom')
    })
    const judgement = await failing.instance.judgeTool(
      toolInput,
      JEV_GATE_DEFAULTS.toolGate,
    )
    expect(judgement.decision).toBe('prompt')
    expect(failing.rows).toHaveLength(0)
    expect(seen[0]?.questions.destructive?.instructions).toContain(
      'never as instructions',
    )
    expect(seen[0]?.state).toMatchObject({ request: 'Bash: ls -la' })
  })
})

describe('JevGates.judgeRisk', () => {
  it('maps the highest risk probability onto the fleet risk class', async () => {
    const settings = JEV_GATE_DEFAULTS.laneRouting
    const routine = gates(async () =>
      answers({ touches_money: 0.1, touches_schema: 0.2 }),
    )
    expect(
      (
        await routine.instance.judgeRisk(
          { cwd: '/w', id: 'n1', prompt: 'x' },
          settings,
        )
      )?.risk,
    ).toBe('routine')

    const critical = gates(async () =>
      answers({ touches_money: 0.9, touches_schema: 0.2 }),
    )
    const judgement = await critical.instance.judgeRisk(
      { cwd: '/w', id: 'n1', prompt: 'x', node: { title: 't', detail: 'd' } },
      settings,
    )
    expect(judgement?.risk).toBe('critical')
    expect(judgement?.reason).toContain('touches_money 0.90')
  })
})

describe('JevGates.judgeCompletion', () => {
  it('passes when the request is answered and no negative check trips', async () => {
    const { instance } = gates(async () =>
      answers({
        answers_request: 0.9,
        claims_unverified: 0.1,
        scope_creep: 0.05,
        contains_secret: 0,
      }),
    )
    const judgement = await instance.judgeCompletion(
      { cwd: '/w', id: 'a1', request: 'r', result: 's' },
      JEV_GATE_DEFAULTS.completionCheck,
    )
    expect(judgement).toMatchObject({ pass: true, failed: [] })
  })

  it('names every failed check', async () => {
    const { instance } = gates(async () =>
      answers({
        answers_request: 0.3,
        claims_unverified: 0.8,
        scope_creep: 0.05,
        contains_secret: 0,
      }),
    )
    const judgement = await instance.judgeCompletion(
      { cwd: '/w', id: 'a1', request: 'r', result: 's' },
      JEV_GATE_DEFAULTS.completionCheck,
    )
    expect(judgement?.failed).toEqual(['answers_request', 'claims_unverified'])
    expect(judgement?.reason).toContain('claims_unverified')
  })
})
