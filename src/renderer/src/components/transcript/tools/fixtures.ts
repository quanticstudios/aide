import type { ManagedSessionToolCall } from '../../../../../shared/managed-session'

const finished = {
  endedAt: '2026-10-30T12:02:14.000Z',
  startedAt: '2026-10-30T12:00:00.000Z',
  status: 'completed',
} as const

/** One finished call of each tool kind, as main publishes them. */
export const TOOL_FIXTURES = {
  edit: {
    ...finished,
    callId: 'edit',
    diff: '--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-before\n+after\n',
    files: [{ path: 'README.md', status: 'modified' }],
    input: {
      file_path: 'README.md',
      new_string: 'after',
      old_string: 'before',
    },
    toolName: 'Edit',
  },
  mcp: {
    ...finished,
    callId: 'mcp',
    input: { id: 'ENG-1', includeComments: true },
    output: 'ENG-1: Example issue',
    toolName: 'mcp__linear__get_issue',
  },
  other: {
    ...finished,
    callId: 'other',
    input: { description: 'Switch to plan mode' },
    toolName: 'EnterPlanMode',
  },
  read: {
    ...finished,
    callId: 'read',
    files: [{ path: 'src/main/index.ts', status: 'read' }],
    input: { file_path: 'src/main/index.ts', limit: 50, offset: 10 },
    output: '    10\timport x from "y"',
    toolName: 'Read',
  },
  search: {
    ...finished,
    callId: 'search',
    input: { path: 'src', pattern: 'createRoot' },
    output:
      'src/renderer/src/main.tsx:4:import { createRoot } from "react-dom/client"\nsrc/renderer/src/App.tsx:12:  createRoot(el)',
    toolName: 'Grep',
  },
  shell: {
    ...finished,
    callId: 'shell',
    command: 'bun run lint',
    exitCode: 1,
    input: { command: 'bun run lint' },
    output: `\u001b[31merror\u001b[0m missing semicolon\n${Array.from({ length: 30 }, (_, index) => `line ${index}`).join('\n')}`,
    status: 'failed',
    toolName: 'Bash',
  },
  subagent: {
    ...finished,
    callId: 'subagent',
    input: {
      description: 'Explore the repo',
      prompt: 'Find the entry points',
      subagent_type: 'Explore',
    },
    output: 'The entry point is **src/main/index.ts**.',
    subagentTools: ['Read', 'Read', 'Grep'],
    toolName: 'Task',
  },
  todo: {
    ...finished,
    callId: 'todo',
    input: {},
    tasks: [
      { status: 'completed', subject: 'Read the ticket' },
      { status: 'in_progress', subject: 'Ship the PR' },
    ],
    toolName: 'TodoWrite',
  },
  'web-fetch': {
    ...finished,
    callId: 'web-fetch',
    input: {
      prompt: 'Summarize the release',
      url: 'https://example.com/notes',
    },
    output: 'Version 2 adds tool renderers.',
    toolName: 'WebFetch',
  },
  'web-search': {
    ...finished,
    callId: 'web-search',
    input: { query: 'electron releases' },
    output:
      'Web search results for query: "electron releases"\n\nLinks: [{"title":"Electron releases","url":"https://releases.electronjs.org/"},{"title":"Bad","url":"javascript:alert(1)"}]\n\nSummary text.',
    toolName: 'WebSearch',
  },
} satisfies Record<string, ManagedSessionToolCall>
