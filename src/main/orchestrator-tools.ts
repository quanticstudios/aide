import {
  createSdkMcpServer,
  type McpSdkServerConfigWithInstance,
  tool,
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'

const MAX_ALIAS_LENGTH = 64
const MAX_PROMPT_LENGTH = 8_000
const MAX_QUERY_LENGTH = 4_000
const MAX_AGENT_CALLS_PER_TURN = 2
const MAX_CONTEXT_CALLS_PER_TURN = 1

export const ORCHESTRATOR_TOOL_NAMES = [
  'ask_agent',
  'find_relevant_context',
] as const

type OrchestratorToolName = (typeof ORCHESTRATOR_TOOL_NAMES)[number]

export interface OrchestratorToolCallbacks {
  askAgent(alias: string, prompt: string, signal: AbortSignal): Promise<string>
  findRelevantContext(query: string, signal: AbortSignal): Promise<string>
}

export interface CodexDynamicToolSpec {
  type: 'function'
  name: OrchestratorToolName
  description: string
  inputSchema: Record<string, unknown>
  deferLoading?: boolean
}

export interface CodexDynamicToolCallParams {
  threadId: string
  turnId: string
  callId: string
  namespace: string | null
  tool: string
  arguments: unknown
}

export interface CodexDynamicToolCallResponse {
  contentItems: Array<{ type: 'inputText'; text: string }>
  success: boolean
}

export interface OrchestratorTools {
  claude: McpSdkServerConfigWithInstance
  codex: {
    handleCall(
      params: CodexDynamicToolCallParams,
    ): Promise<CodexDynamicToolCallResponse>
    tools: CodexDynamicToolSpec[]
  }
  beginTurn(): void
  interrupt(): void
}

const askAgentInputSchema = {
  alias: z.string().trim().min(1).max(MAX_ALIAS_LENGTH),
  prompt: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
}
const askAgentSchema = z.object(askAgentInputSchema).strict()

const findRelevantContextInputSchema = {
  query: z.string().trim().min(1).max(MAX_QUERY_LENGTH),
}
const findRelevantContextSchema = z
  .object(findRelevantContextInputSchema)
  .strict()

type InvocationResult =
  | { success: true; text: string }
  | { success: false; text: string }

function isKnownToolName(value: string): value is OrchestratorToolName {
  return ORCHESTRATOR_TOOL_NAMES.includes(value as OrchestratorToolName)
}

function toolError(text: string): InvocationResult {
  return { success: false, text }
}

function asClaudeResult(result: InvocationResult) {
  return {
    content: [{ type: 'text' as const, text: result.text }],
    ...(result.success ? {} : { isError: true }),
  }
}

function asCodexResult(result: InvocationResult): CodexDynamicToolCallResponse {
  return {
    contentItems: [{ type: 'inputText', text: result.text }],
    success: result.success,
  }
}

export function createOrchestratorTools(
  callbacks: OrchestratorToolCallbacks,
  getTurnSignal: () => AbortSignal,
): OrchestratorTools {
  let agentCalls = 0
  let contextCalls = 0
  let turnAbortController = new AbortController()
  const activeAgents = new Set<string>()

  const currentSignal = (): AbortSignal =>
    AbortSignal.any([getTurnSignal(), turnAbortController.signal])

  const invoke = async (
    name: string,
    arguments_: unknown,
  ): Promise<InvocationResult> => {
    if (!isKnownToolName(name)) {
      return toolError('Unsupported orchestrator tool.')
    }

    const signal = currentSignal()

    if (signal.aborted) {
      return toolError('Orchestrator turn cancelled.')
    }

    if (name === 'ask_agent') {
      const parsed = askAgentSchema.safeParse(arguments_)

      if (!parsed.success) {
        return toolError('Invalid tool arguments.')
      }

      if (activeAgents.has(parsed.data.alias)) {
        return toolError('That agent is already being consulted.')
      }

      if (agentCalls >= MAX_AGENT_CALLS_PER_TURN) {
        return toolError('Agent consultation limit reached for this turn.')
      }

      agentCalls += 1
      activeAgents.add(parsed.data.alias)

      try {
        const text = await callbacks.askAgent(
          parsed.data.alias,
          parsed.data.prompt,
          signal,
        )

        return typeof text === 'string'
          ? { success: true, text }
          : toolError('Agent consultation returned an invalid response.')
      } catch {
        return toolError(
          signal.aborted
            ? 'Orchestrator turn cancelled.'
            : 'Agent consultation failed.',
        )
      } finally {
        activeAgents.delete(parsed.data.alias)
      }
    }

    const parsed = findRelevantContextSchema.safeParse(arguments_)

    if (!parsed.success) {
      return toolError('Invalid tool arguments.')
    }

    if (contextCalls >= MAX_CONTEXT_CALLS_PER_TURN) {
      return toolError('Context lookup limit reached for this turn.')
    }

    contextCalls += 1

    try {
      const text = await callbacks.findRelevantContext(
        parsed.data.query,
        signal,
      )

      return typeof text === 'string'
        ? { success: true, text }
        : toolError('Context lookup returned an invalid response.')
    } catch {
      return toolError(
        signal.aborted
          ? 'Orchestrator turn cancelled.'
          : 'Context lookup failed.',
      )
    }
  }

  const claude = createSdkMcpServer({
    alwaysLoad: true,
    name: 'aide-orchestrator',
    tools: [
      tool(
        'ask_agent',
        'Ask one configured agent a focused question and return its attributed answer.',
        askAgentSchema as unknown as typeof askAgentInputSchema,
        async (arguments_) =>
          asClaudeResult(await invoke('ask_agent', arguments_)),
        { annotations: { readOnlyHint: true } },
      ),
      tool(
        'find_relevant_context',
        'Retrieve relevant authorized workspace context for the current task.',
        findRelevantContextSchema as unknown as typeof findRelevantContextInputSchema,
        async (arguments_) =>
          asClaudeResult(await invoke('find_relevant_context', arguments_)),
        { annotations: { readOnlyHint: true } },
      ),
    ],
  })

  return {
    beginTurn: () => {
      turnAbortController.abort()
      turnAbortController = new AbortController()
      agentCalls = 0
      contextCalls = 0
      activeAgents.clear()
    },
    claude,
    codex: {
      handleCall: async (params) => {
        if (params.namespace !== null) {
          return asCodexResult(toolError('Unsupported orchestrator tool.'))
        }

        return asCodexResult(await invoke(params.tool, params.arguments))
      },
      tools: [
        {
          description:
            'Ask one configured agent a focused question and return its attributed answer.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              alias: {
                maxLength: MAX_ALIAS_LENGTH,
                minLength: 1,
                type: 'string',
              },
              prompt: {
                maxLength: MAX_PROMPT_LENGTH,
                minLength: 1,
                type: 'string',
              },
            },
            required: ['alias', 'prompt'],
            type: 'object',
          },
          name: 'ask_agent',
          type: 'function',
        },
        {
          description:
            'Retrieve relevant authorized workspace context for the current task.',
          inputSchema: {
            additionalProperties: false,
            properties: {
              query: {
                maxLength: MAX_QUERY_LENGTH,
                minLength: 1,
                type: 'string',
              },
            },
            required: ['query'],
            type: 'object',
          },
          name: 'find_relevant_context',
          type: 'function',
        },
      ],
    },
    interrupt: () => turnAbortController.abort(),
  }
}
