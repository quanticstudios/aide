export type RenderingMode = 'hardware' | 'software'

export interface RenderingConfiguration {
  mode: RenderingMode
  source: 'command-line' | 'default' | 'environment'
}

interface RenderingConfigurationInput {
  argv: readonly string[]
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
}

interface ElectronRenderingRuntime {
  commandLine: {
    appendSwitch(name: string, value?: string): void
  }
  disableHardwareAcceleration(): void
}

export function resolveRenderingConfiguration({
  argv,
  env,
  platform,
}: RenderingConfigurationInput): RenderingConfiguration {
  if (platform !== 'linux') {
    return { mode: 'hardware', source: 'default' }
  }

  if (argv.includes('--aide-software-rendering')) {
    return { mode: 'software', source: 'command-line' }
  }

  if (env.AIDE_SOFTWARE_RENDERING === '1') {
    return { mode: 'software', source: 'environment' }
  }

  return { mode: 'hardware', source: 'default' }
}

export function applyRenderingConfiguration(
  app: ElectronRenderingRuntime,
  configuration: RenderingConfiguration,
  env: Record<string, string | undefined>,
): void {
  if (configuration.mode !== 'software') {
    return
  }

  env.LIBGL_ALWAYS_SOFTWARE ??= '1'
  env.MESA_LOADER_DRIVER_OVERRIDE ??= 'llvmpipe'
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
}
