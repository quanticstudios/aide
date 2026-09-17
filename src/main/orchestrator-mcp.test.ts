import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { expect, it, vi } from 'vitest'
import { createOrchestratorTools } from './orchestrator-tools'

it('advertises and validates fleet plans through the real Claude MCP transport', async () => {
  const setFleetPlan = vi.fn(async () => 'Saved')
  const tools = createOrchestratorTools(
    {
      askAgent: async () => 'Opinion',
      findRelevantContext: async () => 'Context',
      setFleetPlan,
    },
    () => new AbortController().signal,
  )
  const client = new Client({ name: 'aide-fleet-test', version: '1.0.0' })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await tools.claude.instance.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    const advertised = await client.listTools()
    expect(
      advertised.tools.find((tool) => tool.name === 'set_fleet_plan')
        ?.inputSchema.properties,
    ).toHaveProperty('nodes')
    const node = {
      id: 'work',
      title: 'Work',
      detail: '',
      dependsOn: [],
      status: 'planned',
      evidence: '',
    }
    const valid = await client.callTool({
      name: 'set_fleet_plan',
      arguments: { summary: 'Plan', nodes: [node] },
    })
    expect(valid.isError).not.toBe(true)
    expect(setFleetPlan).toHaveBeenCalledOnce()
    const invalid = await client.callTool({
      name: 'set_fleet_plan',
      arguments: {
        summary: 'Cycle',
        nodes: [{ ...node, dependsOn: ['work'] }],
      },
    })
    expect(invalid.isError).toBe(true)
    expect(setFleetPlan).toHaveBeenCalledOnce()
  } finally {
    await client.close()
    await tools.claude.instance.close()
  }
})
