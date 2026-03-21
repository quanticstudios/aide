import type { AideApi } from '../../shared/ipc'

declare global {
  interface Window {
    aide: AideApi
  }
}
