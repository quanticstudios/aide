import { describe, expect, it } from 'vitest'

import {
  createSupportBundleFiles,
  sanitizeDiagnosticsSnapshot,
} from './diagnostics'

describe('sanitizeDiagnosticsSnapshot', () => {
  it('keeps only the explicit diagnostics contract', () => {
    const snapshot = sanitizeDiagnosticsSnapshot({
      generatedAt: '2026-07-13T12:00:00.000Z',
      recentEvents: [
        {
          occurredAt: '2026-07-13T11:59:00.000Z',
          type: 'main-uncaught-exception',
        },
      ],
      revision: 4,
      runtime: {
        appName: 'aide',
        appVersion: '0.1.0',
        arch: 'x64',
        chromeVersion: '138.0.0.0',
        electronVersion: '43.0.0',
        nodeVersion: '24.17.0',
        platform: 'linux',
      },
      version: 1,
    })

    expect(snapshot).toEqual({
      generatedAt: '2026-07-13T12:00:00.000Z',
      recentEvents: [
        {
          occurredAt: '2026-07-13T11:59:00.000Z',
          type: 'main-uncaught-exception',
        },
      ],
      revision: 4,
      runtime: {
        appName: 'aide',
        appVersion: '0.1.0',
        arch: 'x64',
        chromeVersion: '138.0.0.0',
        electronVersion: '43.0.0',
        nodeVersion: '24.17.0',
        platform: 'linux',
      },
      version: 1,
    })
  })

  it('rejects secrets, paths, prompts, terminal text, patches, and arbitrary renderer payloads', () => {
    const unsafeText = [
      'token=super-secret',
      '/home/alice/private-project',
      'OPENAI_API_KEY=sk-secret',
      'user prompt: repair the private database',
      'terminal output: deploy production',
      'diff --git a/secret b/secret',
    ].join('\n')
    const files = createSupportBundleFiles({
      generatedAt: '2026-07-13T12:00:00.000Z',
      prompt: unsafeText,
      recentEvents: [
        {
          occurredAt: '2026-07-13T11:59:00.000Z',
          payload: unsafeText,
          type: 'main-uncaught-exception',
        },
      ],
      revision: 2,
      runtime: {
        appName: 'aide',
        appVersion: '0.1.0',
        arch: 'x64',
        chromeVersion: '138.0.0.0',
        electronVersion: '43.0.0',
        environment: unsafeText,
        nodeVersion: '24.17.0',
        platform: 'linux',
        workingDirectory: '/home/alice/private-project',
      },
      terminalOutput: unsafeText,
      workspaceSetup: {
        command: 'SETUP_COMMAND_MUST_NEVER_EXPORT',
        output: 'SETUP_OUTPUT_MUST_NEVER_EXPORT',
      },
      version: 1,
    })
    const bundleText = files.map((file) => file.contents).join('\n')

    expect(bundleText).not.toContain('super-secret')
    expect(bundleText).not.toContain('/home/alice')
    expect(bundleText).not.toContain('OPENAI_API_KEY')
    expect(bundleText).not.toContain('user prompt')
    expect(bundleText).not.toContain('terminal output')
    expect(bundleText).not.toContain('diff --git')
    expect(bundleText).not.toContain('SETUP_COMMAND_MUST_NEVER_EXPORT')
    expect(bundleText).not.toContain('SETUP_OUTPUT_MUST_NEVER_EXPORT')
    expect(bundleText).toContain('main-uncaught-exception')
    expect(bundleText).toContain('electronVersion')
    expect(
      files.find((file) => file.name === 'events.jsonl')?.contents,
    ).toMatch(/\n$/)
  })
})
