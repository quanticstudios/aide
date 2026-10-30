// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ManagedSessionToolCall } from '../../../../shared/managed-session'
import type { AideApi } from '../../../../shared/ipc'
import { WorkspaceIdContext } from '../../lib/workspace-id'
import ToolCallBlock from './ToolCallBlock'
import { TOOL_FIXTURES } from './tools/fixtures'
import { parseSearchMatches } from './tools/SearchTool'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function render(tool: ManagedSessionToolCall, expand = true) {
  window.aide = {
    openExternal: vi.fn(async () => undefined),
    openWorkspaceFile: vi.fn(async () => undefined),
  } as unknown as AideApi
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      createElement(
        WorkspaceIdContext,
        { value: 'workspace-1' },
        createElement(ToolCallBlock, { tool }),
      ),
    ),
  )
  const header = container.querySelector('button') as HTMLButtonElement
  if (expand) act(() => header.click())
  return { container, header }
}

describe('ToolCallBlock', () => {
  it.each(
    Object.entries(TOOL_FIXTURES),
  )('draws the %s header without a JSON dump and shows its duration', (_kind, tool) => {
    const { header } = render(tool, false)

    expect(header.textContent).not.toMatch(/[{}]/)
    expect(
      header.querySelector('[data-testid="tool-call-duration"]')?.textContent,
    ).toBe('2m 14s')
  })

  it('shell: shows the command, a red exit code and ANSI colors, cut past 20 lines', () => {
    const { container, header } = render(TOOL_FIXTURES.shell)
    const exitCode = header.querySelector('[data-testid="tool-call-exit-code"]')
    const output = container.querySelector('[data-testid="tool-call-output"]')

    expect(header.textContent).toContain('bun run lint')
    expect(exitCode?.textContent).toBe('exit 1')
    expect(exitCode?.className).toContain('text-accent-red')
    expect(output?.querySelector('.text-accent-red')?.textContent).toBe('error')
    expect(output?.textContent).not.toContain('\u001b')
    expect(output?.textContent?.split('\n')).toHaveLength(20)
    expect(container.textContent).toContain('Show 11 more lines')
  })

  it('shell: ticks while running, in its own leaf', () => {
    vi.useFakeTimers()
    vi.setSystemTime(Date.parse('2026-10-30T12:00:03.000Z'))
    const { header } = render(
      {
        callId: 'running',
        command: 'sleep 9',
        input: { command: 'sleep 9' },
        startedAt: '2026-10-30T12:00:00.000Z',
        status: 'running',
        toolName: 'Bash',
      },
      false,
    )
    const elapsed = () =>
      header.querySelector('[data-testid="tool-call-elapsed"]')?.textContent

    expect(elapsed()).toBe('3s')
    act(() => vi.advanceTimersByTime(2_000))
    expect(elapsed()).toBe('5s')
  })

  it('read: shows a path chip and the line range', () => {
    const { container, header } = render(TOOL_FIXTURES.read)

    expect(header.textContent).toContain('src/main/index.ts · lines 10–59')
    expect(container.querySelector('button[title^="Open"]')?.textContent).toBe(
      'src/main/index.ts:10',
    )
  })

  it('edit: keeps the inline diff and chips the file', () => {
    const { container } = render(TOOL_FIXTURES.edit)

    expect(
      container.querySelector('[data-testid="tool-call-diff"]'),
    ).not.toBeNull()
    expect(container.querySelector('button[title^="Open"]')?.textContent).toBe(
      'README.md',
    )
  })

  it('search: turns matches into file:line chips', () => {
    const { container, header } = render(TOOL_FIXTURES.search)
    const chips = [...container.querySelectorAll('button[title^="Open"]')].map(
      (chip) => chip.textContent,
    )

    expect(header.textContent).toContain('createRoot in src')
    expect(chips).toEqual([
      'src/renderer/src/main.tsx:4',
      'src/renderer/src/App.tsx:12',
    ])
  })

  it('search: reads bare paths and notes from Glob and files-only Grep output', () => {
    expect(parseSearchMatches('Found 2 files\n/repo/a.ts\nsrc/b.ts\n')).toEqual(
      [
        { line: null, path: null, text: 'Found 2 files' },
        { line: null, path: '/repo/a.ts', text: '' },
        { line: null, path: 'src/b.ts', text: '' },
      ],
    )
  })

  it('web fetch: links the URL and shows the prompt', () => {
    const { container, header } = render(TOOL_FIXTURES['web-fetch'])

    expect(header.textContent).toContain('https://example.com/notes')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://example.com/notes',
    )
    expect(container.textContent).toContain('Summarize the release')
  })

  it('web search: lists result titles and drops non-http links', () => {
    const { container } = render(TOOL_FIXTURES['web-search'])
    const links = [
      ...container.querySelectorAll('[data-testid="tool-call-links"] a'),
    ]

    expect(links.map((link) => link.textContent)).toEqual(['Electron releases'])
    expect(links[0]?.getAttribute('href')).toBe(
      'https://releases.electronjs.org/',
    )
  })

  it('todo: reuses the task list', () => {
    const { container, header } = render(TOOL_FIXTURES.todo)

    expect(header.textContent).toContain('1/2 tasks done')
    expect(
      container.querySelector('[data-testid="managed-task-list"]'),
    ).not.toBeNull()
  })

  it('subagent: nests a summary with its own tool count', () => {
    const { container, header } = render(TOOL_FIXTURES.subagent)

    expect(header.textContent).toContain('Explore the repo')
    expect(
      container.querySelector('[data-testid="tool-call-subagent-summary"]')
        ?.textContent,
    ).toBe('Explore · 3 tool calls: Read 2 files, ran 1 search')
  })

  it('mcp: names the server and tool and pretty-prints the arguments', () => {
    const { container, header } = render(TOOL_FIXTURES.mcp)

    expect(header.textContent).toContain('linear · get_issue')
    expect(
      container.querySelector('[data-testid="tool-call-arguments"]')
        ?.textContent,
    ).toBe(JSON.stringify(TOOL_FIXTURES.mcp.input, null, 2))
  })

  it('mcp: reads a Codex server.tool call and its arguments', () => {
    const { container, header } = render({
      ...TOOL_FIXTURES.mcp,
      input: {
        arguments: { id: 'ENG-2' },
        server: 'linear',
        tool: 'get_issue',
      },
      toolName: 'linear.get_issue',
    })

    expect(header.textContent).toContain('linear · get_issue')
    expect(
      container.querySelector('[data-testid="tool-call-arguments"]')
        ?.textContent,
    ).toBe(JSON.stringify({ id: 'ENG-2' }, null, 2))
  })
})
