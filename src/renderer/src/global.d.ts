/// <reference types="vite/client" />
import type { HTMLAttributes } from 'react'
import type { AideApi } from '../../shared/ipc'
import type { SessionTransport } from './lib/session-transport'

declare global {
  interface Window {
    aide: AideApi
    /** The active session transport, built-in or pitwall; e2e reads sessions through it. */
    readonly aideSessions: SessionTransport
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
