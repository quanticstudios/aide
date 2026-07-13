/// <reference types="vite/client" />
import type { HTMLAttributes } from 'react'
import type { AideApi } from '../../shared/ipc'

declare global {
  interface Window {
    aide: AideApi
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: HTMLAttributes<HTMLElement> & {
        onDidFailLoad?: (event: Event) => void
        onDidNavigate?: (event: Event) => void
        onDidNavigateInPage?: (event: Event) => void
        onDidStartLoading?: (event: Event) => void
        onDidStopLoading?: (event: Event) => void
        onPageTitleUpdated?: (event: Event) => void
        partition?: string
        src: string
      }
    }
  }
}
