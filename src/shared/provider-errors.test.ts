import { describe, expect, it } from 'vitest'

import { classifyProviderError } from './provider-errors'

describe('classifyProviderError', () => {
  it.each([
    ['Configured executable "codex" was not found in PATH.', 'executable'],
    ['spawn codex ENOENT', 'executable'],
    [
      'Claude Code executable not found at /opt/claude. Is options.pathToClaudeCodeExecutable set?',
      'executable',
    ],
    ['Not logged in · Please run /login', 'auth'],
    ['Invalid API key · Please run /login', 'auth'],
    ['unexpected status 401 Unauthorized: Missing bearer token', 'auth'],
    ['API Error: Connection error.', 'network'],
    [
      'request to https://api.anthropic.com failed: getaddrinfo ENOTFOUND',
      'network',
    ],
    [
      'stream disconnected before completion: error sending request for url',
      'network',
    ],
  ])('names %s as %s', (message, kind) => {
    expect(classifyProviderError(message)).toBe(kind)
  })

  it('returns null for errors without a known fix', () => {
    expect(classifyProviderError("You've hit your usage limit.")).toBe(null)
    expect(classifyProviderError('Turn failed')).toBe(null)
    expect(classifyProviderError(null)).toBe(null)
  })
})
