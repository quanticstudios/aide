import { pathToFileURL } from 'node:url'

export interface TrustedRendererLocation {
  loadRendererUrl?: string
  rendererHtmlPath: string
}

export function isTrustedRendererUrl(
  candidate: string,
  location: TrustedRendererLocation,
): boolean {
  try {
    const candidateUrl = new URL(candidate)
    if (candidateUrl.username || candidateUrl.password) {
      return false
    }

    if (location.loadRendererUrl) {
      const developmentUrl = new URL(location.loadRendererUrl)
      return (
        candidateUrl.origin === developmentUrl.origin &&
        candidateUrl.pathname === developmentUrl.pathname
      )
    }

    const packagedUrl = new URL(pathToFileURL(location.rendererHtmlPath).href)
    return (
      candidateUrl.protocol === 'file:' &&
      candidateUrl.host === packagedUrl.host &&
      candidateUrl.pathname === packagedUrl.pathname
    )
  } catch {
    return false
  }
}
