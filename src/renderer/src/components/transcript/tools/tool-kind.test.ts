import { describe, expect, it } from 'vitest'
import { summarizeToolGroup, toolKind } from './tool-kind'

describe('toolKind', () => {
  it.each([
    ['Bash', 'shell'],
    ['Shell', 'shell'],
    ['Read', 'read'],
    ['MultiEdit', 'edit'],
    ['Write', 'edit'],
    ['Grep', 'search'],
    ['Glob', 'search'],
    ['WebFetch', 'web-fetch'],
    ['Web search', 'web-search'],
    ['TodoWrite', 'todo'],
    ['Task', 'subagent'],
    ['mcp__linear__get_issue', 'mcp'],
    ['linear.get_issue', 'mcp'],
    ['ExitPlanMode', 'other'],
  ])('reads %s as %s', (name, kind) => {
    expect(toolKind(name)).toBe(kind)
  })
})

describe('summarizeToolGroup', () => {
  it('counts each kind in order of first use', () => {
    expect(
      summarizeToolGroup(['Read', 'Bash', 'Read', 'Edit', 'Shell', 'Read']),
    ).toBe('Read 3 files, ran 2 commands, edited 1 file')
  })

  it('names every other kind in plain words', () => {
    expect(
      summarizeToolGroup([
        'Grep',
        'Glob',
        'WebFetch',
        'WebSearch',
        'TodoWrite',
        'Task',
        'mcp__linear__get_issue',
        'ExitPlanMode',
      ]),
    ).toBe(
      'Ran 2 searches, fetched 1 web page, ran 1 web search, updated the task list, ran 1 subagent, called 1 MCP tool, used 1 other tool',
    )
  })
})
