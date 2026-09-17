import { describe, expect, it, vi } from 'vitest'

interface CapturedTool {
  annotations?: { readOnlyHint?: boolean }
  handler: (arguments_: unknown) => Promise<ClaudeToolResult>
  name: string
}

interface ClaudeToolResult {
  content: Array<{ text: string; type: 'text' }>
  isError?: boolean
}

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: ({ tools }: { tools: CapturedTool[] }) => ({ tools }),
  tool: (
    name: string,
    _description: string,
    _schema: unknown,
    handler: CapturedTool['handler'],
    extras: { annotations?: CapturedTool['annotations'] },
  ): CapturedTool => ({ annotations: extras.annotations, handler, name }),
}))

import { createOrchestratorTools } from './orchestrator-tools'

function codexCall(
  tool: string,
  arguments_: unknown,
  namespace: string | null = null,
) {
  return {
    arguments: arguments_,
    callId: 'call',
    namespace,
    threadId: 'thread',
    tool,
    turnId: 'turn',
  }
}

function getClaudeTool(
  tools: ReturnType<typeof createOrchestratorTools>,
  name: string,
): CapturedTool {
  const server = tools.claude as unknown as { tools: CapturedTool[] }
  const found = server.tools.find((entry) => entry.name === name)

  if (!found) {
    throw new Error(`Missing ${name}`)
  }

  return found
}

const fleetPlan = {
  nodes: [
    {
      dependsOn: [],
      detail: 'Inspect the bridge.',
      evidence: '',
      id: 'inspect',
      status: 'planned',
      title: 'Inspect bridge',
    },
  ],
  summary: 'Inspect the orchestrator bridge.',
}

const fleetNodeUpdate = {
  detail: 'The bridge has passed its focused tests.',
  evidence: 'src/main/orchestrator-tools.test.ts',
  nodeId: 'inspect',
  status: 'completed',
}

describe('createOrchestratorTools', () => {
  it('returns matching callback answers through Claude and Codex', async () => {
    const askAgent = vi.fn(
      async (alias: string, prompt: string) => `agent:${alias}:${prompt}`,
    )
    const findRelevantContext = vi.fn(
      async (query: string) => `context:${query}`,
    )
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext },
      () => new AbortController().signal,
    )

    const claudeAgent = await getClaudeTool(tools, 'ask_agent').handler({
      alias: 'reviewer',
      prompt: 'inspect this',
    })
    const codexAgent = await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'reviewer', prompt: 'inspect this' }),
    )
    const claudeContext = await getClaudeTool(
      tools,
      'find_relevant_context',
    ).handler({ query: 'session ownership' })
    tools.beginTurn()
    const codexContext = await tools.codex.handleCall(
      codexCall('find_relevant_context', { query: 'session ownership' }),
    )

    expect(claudeAgent.content[0]).toEqual({
      text: 'agent:reviewer:inspect this',
      type: 'text',
    })
    expect(codexAgent).toEqual({
      contentItems: [
        { text: 'agent:reviewer:inspect this', type: 'inputText' },
      ],
      success: true,
    })
    expect(claudeContext.content[0]?.text).toBe('context:session ownership')
    expect(codexContext.contentItems[0]?.text).toBe('context:session ownership')
    expect(askAgent).toHaveBeenCalledTimes(2)
    expect(findRelevantContext).toHaveBeenCalledTimes(2)
  })

  it('leaves alias authorization to the callback and hides callback errors', async () => {
    const askAgent = vi.fn(async (alias: string) => {
      if (alias === 'unknown') {
        throw new Error('Unknown agent alias: unknown')
      }

      return 'answer'
    })
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext: async () => 'context' },
      () => new AbortController().signal,
    )

    const response = await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'unknown', prompt: 'question' }),
    )

    expect(askAgent).toHaveBeenCalledWith(
      'unknown',
      'question',
      expect.any(AbortSignal),
    )
    expect(response).toEqual({
      contentItems: [{ text: 'Agent consultation failed.', type: 'inputText' }],
      success: false,
    })
  })

  it('rejects unknown tools, namespaced calls, and invalid arguments', async () => {
    const askAgent = vi.fn(async () => 'answer')
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext: async () => 'context' },
      () => new AbortController().signal,
    )

    await expect(
      tools.codex.handleCall(codexCall('other_tool', {})),
    ).resolves.toMatchObject({ success: false })
    await expect(
      tools.codex.handleCall(
        codexCall('ask_agent', { alias: 'a', prompt: 'p' }, 'other'),
      ),
    ).resolves.toMatchObject({ success: false })
    await expect(
      tools.codex.handleCall(
        codexCall('ask_agent', { alias: 'a', extra: true, prompt: 'p' }),
      ),
    ).resolves.toEqual({
      contentItems: [{ text: 'Invalid tool arguments.', type: 'inputText' }],
      success: false,
    })
    await expect(
      getClaudeTool(tools, 'ask_agent').handler({
        alias: 'a',
        extra: true,
        prompt: 'p',
      }),
    ).resolves.toEqual({
      content: [{ text: 'Invalid tool arguments.', type: 'text' }],
      isError: true,
    })
    await expect(
      tools.codex.handleCall(
        codexCall('find_relevant_context', { query: 'x'.repeat(4_001) }),
      ),
    ).resolves.toMatchObject({ success: false })
    expect(askAgent).not.toHaveBeenCalled()
  })

  it('limits calls per turn and resets the limits for the next turn', async () => {
    const askAgent = vi.fn(async () => 'answer')
    const findRelevantContext = vi.fn(async () => 'context')
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext },
      () => new AbortController().signal,
    )

    await tools.codex.handleCall(
      codexCall('find_relevant_context', { query: 'one' }),
    )
    const limitedContext = await tools.codex.handleCall(
      codexCall('find_relevant_context', { query: 'two' }),
    )
    await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'a', prompt: 'one' }),
    )
    await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'b', prompt: 'two' }),
    )
    const limitedAgent = await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'c', prompt: 'three' }),
    )

    expect(limitedContext.success).toBe(false)
    expect(limitedAgent.success).toBe(false)
    tools.beginTurn()
    await tools.codex.handleCall(
      codexCall('find_relevant_context', { query: 'new turn' }),
    )
    await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'a', prompt: 'new turn' }),
    )
    expect(findRelevantContext).toHaveBeenCalledTimes(2)
    expect(askAgent).toHaveBeenCalledTimes(3)
  })

  it('allows only one active request per agent and cancels it on interrupt', async () => {
    let rejectAgent: ((reason?: unknown) => void) | undefined
    const askAgent = vi.fn(
      async (_alias: string, _prompt: string, signal: AbortSignal) =>
        await new Promise<string>((_resolve, reject) => {
          rejectAgent = reject
          signal.addEventListener(
            'abort',
            () => reject(new Error('cancelled')),
            {
              once: true,
            },
          )
        }),
    )
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext: async () => 'context' },
      () => new AbortController().signal,
    )

    const first = tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'reviewer', prompt: 'first' }),
    )
    const duplicate = await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'reviewer', prompt: 'second' }),
    )
    tools.interrupt()
    const cancelled = await first

    expect(rejectAgent).toBeDefined()
    expect(askAgent).toHaveBeenCalledTimes(1)
    expect(duplicate).toEqual({
      contentItems: [
        { text: 'That agent is already being consulted.', type: 'inputText' },
      ],
      success: false,
    })
    expect(cancelled).toEqual({
      contentItems: [
        { text: 'Orchestrator turn cancelled.', type: 'inputText' },
      ],
      success: false,
    })
  })

  it('reports valid fleet plans and node updates through Claude and Codex', async () => {
    const setFleetPlan = vi.fn(async () => 'plan recorded')
    const updateFleetNode = vi.fn(async () => 'node recorded')
    const tools = createOrchestratorTools(
      {
        askAgent: async () => 'answer',
        findRelevantContext: async () => 'context',
        setFleetPlan,
        updateFleetNode,
      },
      () => new AbortController().signal,
    )

    await expect(
      getClaudeTool(tools, 'set_fleet_plan').handler(fleetPlan),
    ).resolves.toMatchObject({ content: [{ text: 'plan recorded' }] })
    await expect(
      tools.codex.handleCall(codexCall('update_fleet_node', fleetNodeUpdate)),
    ).resolves.toMatchObject({
      contentItems: [{ text: 'node recorded' }],
      success: true,
    })
    expect(setFleetPlan).toHaveBeenCalledWith(fleetPlan)
    expect(updateFleetNode).toHaveBeenCalledWith(fleetNodeUpdate)
  })

  it('rejects invalid fleet graphs before calling the manager callback', async () => {
    const setFleetPlan = vi.fn(async () => 'plan recorded')
    const tools = createOrchestratorTools(
      {
        askAgent: async () => 'answer',
        findRelevantContext: async () => 'context',
        setFleetPlan,
      },
      () => new AbortController().signal,
    )
    const invalidPlan = {
      nodes: [
        { ...fleetPlan.nodes[0], dependsOn: ['second'] },
        {
          ...fleetPlan.nodes[0],
          dependsOn: ['inspect'],
          id: 'second',
          title: 'Second node',
        },
      ],
      summary: fleetPlan.summary,
    }

    await expect(
      tools.codex.handleCall(codexCall('set_fleet_plan', invalidPlan)),
    ).resolves.toEqual({
      contentItems: [{ text: 'Invalid tool arguments.', type: 'inputText' }],
      success: false,
    })
    expect(setFleetPlan).not.toHaveBeenCalled()
  })

  it('reports manager rejection when a fleet node is unknown', async () => {
    const updateFleetNode = vi.fn(async () => {
      throw new Error('Unknown fleet node.')
    })
    const tools = createOrchestratorTools(
      {
        askAgent: async () => 'answer',
        findRelevantContext: async () => 'context',
        updateFleetNode,
      },
      () => new AbortController().signal,
    )

    await expect(
      tools.codex.handleCall(codexCall('update_fleet_node', fleetNodeUpdate)),
    ).resolves.toEqual({
      contentItems: [{ text: 'Fleet node update failed.', type: 'inputText' }],
      success: false,
    })
    expect(updateFleetNode).toHaveBeenCalledWith(fleetNodeUpdate)
  })

  it('cancels a fleet plan update when the turn is interrupted', async () => {
    let rejectFleetPlan: ((reason?: unknown) => void) | undefined
    const tools = createOrchestratorTools(
      {
        askAgent: async () => 'answer',
        findRelevantContext: async () => 'context',
        setFleetPlan: async () =>
          await new Promise<string>((_resolve, reject) => {
            rejectFleetPlan = reject
          }),
      },
      () => new AbortController().signal,
    )
    const update = tools.codex.handleCall(
      codexCall('set_fleet_plan', fleetPlan),
    )

    tools.interrupt()
    rejectFleetPlan?.(new Error('cancelled'))

    await expect(update).resolves.toEqual({
      contentItems: [
        { text: 'Orchestrator turn cancelled.', type: 'inputText' },
      ],
      success: false,
    })
  })

  it('limits fleet plan updates per turn and resets for the next turn', async () => {
    const setFleetPlan = vi.fn(async () => 'plan recorded')
    const updateFleetNode = vi.fn(async () => 'node recorded')
    const tools = createOrchestratorTools(
      {
        askAgent: async () => 'answer',
        findRelevantContext: async () => 'context',
        setFleetPlan,
        updateFleetNode,
      },
      () => new AbortController().signal,
    )

    for (let call = 0; call < 19; call += 1) {
      await tools.codex.handleCall(codexCall('set_fleet_plan', fleetPlan))
    }
    await tools.codex.handleCall(
      codexCall('update_fleet_node', fleetNodeUpdate),
    )
    await expect(
      tools.codex.handleCall(codexCall('set_fleet_plan', fleetPlan)),
    ).resolves.toMatchObject({ success: false })
    tools.beginTurn()
    await tools.codex.handleCall(codexCall('set_fleet_plan', fleetPlan))
    expect(setFleetPlan).toHaveBeenCalledTimes(20)
    expect(updateFleetNode).toHaveBeenCalledTimes(1)
  })

  it('passes optional agent routing metadata without changing old callback calls', async () => {
    const askAgent = vi.fn(async () => 'answer')
    const tools = createOrchestratorTools(
      { askAgent, findRelevantContext: async () => 'context' },
      () => new AbortController().signal,
    )

    await tools.codex.handleCall(
      codexCall('ask_agent', {
        alias: 'reviewer',
        failure: 'wrong-hypothesis',
        nodeId: 'inspect',
        prompt: 'Check the dependency graph.',
        reason: 'The plan needs an independent graph check.',
        risk: 'high',
      }),
    )
    await tools.codex.handleCall(
      codexCall('ask_agent', { alias: 'writer', prompt: 'Review the plan.' }),
    )

    expect(askAgent).toHaveBeenNthCalledWith(
      1,
      'reviewer',
      'Check the dependency graph.',
      expect.any(AbortSignal),
      {
        failure: 'wrong-hypothesis',
        nodeId: 'inspect',
        reason: 'The plan needs an independent graph check.',
        risk: 'high',
      },
    )
    expect(askAgent).toHaveBeenNthCalledWith(
      2,
      'writer',
      'Review the plan.',
      expect.any(AbortSignal),
    )
  })

  it('marks Claude tools read-only and rejects malformed callback results', async () => {
    const tools = createOrchestratorTools(
      {
        askAgent: async () => ({ answer: 'wrong type' }) as unknown as string,
        findRelevantContext: async () =>
          ({ context: 'wrong type' }) as unknown as string,
      },
      () => new AbortController().signal,
    )

    expect(getClaudeTool(tools, 'ask_agent').annotations).toEqual({
      readOnlyHint: true,
    })
    expect(getClaudeTool(tools, 'find_relevant_context').annotations).toEqual({
      readOnlyHint: true,
    })
    expect(getClaudeTool(tools, 'set_fleet_plan').annotations).toEqual({
      readOnlyHint: false,
    })
    expect(getClaudeTool(tools, 'update_fleet_node').annotations).toEqual({
      readOnlyHint: false,
    })
    expect(
      tools.codex.tools.find((tool) => tool.name === 'set_fleet_plan'),
    ).toMatchObject({
      description:
        'Report the complete fleet plan. Evidence is an orchestrator report; user acceptance is separate.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          nodes: { maxItems: 60 },
          summary: { maxLength: 4_000 },
        },
      },
    })
    expect(
      tools.codex.tools.find((tool) => tool.name === 'update_fleet_node'),
    ).toMatchObject({
      description:
        'Report a fleet node status and evidence. Evidence is an orchestrator report; user acceptance is separate.',
      inputSchema: {
        additionalProperties: false,
        properties: {
          detail: { maxLength: 2_000 },
          evidence: { maxLength: 2_000 },
          nodeId: { maxLength: 64 },
        },
      },
    })
    await expect(
      tools.codex.handleCall(
        codexCall('ask_agent', { alias: 'reviewer', prompt: 'question' }),
      ),
    ).resolves.toMatchObject({ success: false })
    await expect(
      tools.codex.handleCall(
        codexCall('find_relevant_context', { query: 'question' }),
      ),
    ).resolves.toMatchObject({ success: false })
  })
})
