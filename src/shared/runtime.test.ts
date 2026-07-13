import { describe, expect, it } from 'vitest'

import {
  type RuntimeSnapshot,
  formatPlatformLabel,
  formatRuntimeSummary,
} from './runtime'

const snapshot: RuntimeSnapshot = {
  appName: 'aide',
  appVersion: '0.1.0',
  chromeVersion: '134.0.0.0',
  electronVersion: '35.0.0',
  nodeVersion: '22.0.0',
  platform: 'darwin',
  arch: 'arm64',
  renderingMode: 'hardware',
  renderingModeSource: 'default',
  workingDirectory: '/workspace/aide',
}

describe('formatPlatformLabel', () => {
  it('maps platform and architecture into a readable label', () => {
    expect(formatPlatformLabel('darwin', 'arm64')).toBe('macOS (ARM64)')
  })

  it('falls back to raw values for unmapped architecture labels', () => {
    expect(formatPlatformLabel('linux', 'ppc64')).toBe('Linux (ppc64)')
  })
})

describe('formatRuntimeSummary', () => {
  it('builds a user-facing runtime summary', () => {
    expect(formatRuntimeSummary(snapshot)).toBe(
      'aide 0.1.0 on macOS (ARM64) using Electron 35.0.0 with hardware rendering (default)',
    )
  })
})
