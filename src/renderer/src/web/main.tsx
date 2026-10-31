import React from 'react'
import ReactDOM from 'react-dom/client'
import { version } from '../../../../package.json'
import { initializeFontPreference } from '../lib/font-preference'
import { createDaemonTransport } from '../lib/daemon-transport'
import { setSessionTransport } from '../lib/session-transport'
import { initializeThemePreference } from '../lib/theme-preference'
import { readBootstrap } from './bootstrap'
import PhoneApp from './PhoneApp'
import { sessionHash } from './routes'
import './phone.css'

initializeThemePreference()
initializeFontPreference()

// why: pitwall's CSP blocks the <style> react-aria's usePress inserts unless an element with its id exists; phone.css carries its rule.
const pressableStyle = document.createElement('meta')
pressableStyle.id = 'react-aria-pressable-style'
document.head.append(pressableStyle)

const emptyLibrary = async () => ({
  notificationSoundsEnabled: false,
  notificationsEnabled: false,
  tasks: [],
})

const transport = createDaemonTransport({
  clientVersion: version,
  getEndpoint: () => readBootstrap(),
  // why: a browser has no aide workspaces, so every chat keeps pitwall's own ids.
  getWorkspaces: async () => [],
  openTask: async (sessionId) => {
    window.location.hash = sessionHash(sessionId)
  },
  // why: aide's task library (notifications, attention, read state) lives in Electron main; a browser has none.
  aideTasks: { listSessions: emptyLibrary, updateSession: emptyLibrary },
})
// Shared components (the input panel, tool cards) reach the backend through this.
setSessionTransport(transport)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <PhoneApp transport={transport} />
  </React.StrictMode>,
)
