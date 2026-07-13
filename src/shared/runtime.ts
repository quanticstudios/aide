export interface RuntimeSnapshot {
  appName: string
  appVersion: string
  chromeVersion: string
  electronVersion: string
  nodeVersion: string
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  renderingMode: 'hardware' | 'software'
  renderingModeSource: 'command-line' | 'default' | 'environment'
  workingDirectory: string
}

const PLATFORM_LABELS: Record<NodeJS.Platform, string> = {
  aix: 'AIX',
  android: 'Android',
  darwin: 'macOS',
  freebsd: 'FreeBSD',
  haiku: 'Haiku',
  linux: 'Linux',
  openbsd: 'OpenBSD',
  sunos: 'SunOS',
  win32: 'Windows',
  cygwin: 'Cygwin',
  netbsd: 'NetBSD',
}

const ARCH_LABELS: Partial<Record<NodeJS.Architecture, string>> = {
  arm64: 'ARM64',
  x64: 'x64',
}

export function formatPlatformLabel(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string {
  const platformLabel = PLATFORM_LABELS[platform] ?? platform
  const archLabel = ARCH_LABELS[arch] ?? arch

  return `${platformLabel} (${archLabel})`
}

export function formatRuntimeSummary(snapshot: RuntimeSnapshot): string {
  return `${snapshot.appName} ${snapshot.appVersion} on ${formatPlatformLabel(snapshot.platform, snapshot.arch)} using Electron ${snapshot.electronVersion} with ${snapshot.renderingMode} rendering (${snapshot.renderingModeSource})`
}
