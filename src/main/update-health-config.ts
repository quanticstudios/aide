declare const __AIDE_UPDATE_HEALTH_ENDPOINT__: string | undefined

/**
 * Replaced by electron-vite at package build time. A packaged desktop app does
 * not rely on a user's shell environment for a privacy-sensitive destination.
 */
export function configuredUpdateHealthEndpoint(): string | null {
  return typeof __AIDE_UPDATE_HEALTH_ENDPOINT__ === 'string' &&
    __AIDE_UPDATE_HEALTH_ENDPOINT__.length > 0
    ? __AIDE_UPDATE_HEALTH_ENDPOINT__
    : null
}
