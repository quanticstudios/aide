import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { initializeAnimationPreference } from './lib/animation-preference'
import './styles.css'

document.documentElement.classList.add('dark')
document.documentElement.dataset.theme = 'dark'
initializeAnimationPreference()

function reportRendererFault(
  type: 'renderer-exception' | 'renderer-unhandled-rejection',
): void {
  void window.aide?.reportRendererFault(type).catch(() => undefined)
}

window.addEventListener('error', () =>
  reportRendererFault('renderer-exception'),
)
window.addEventListener('unhandledrejection', () =>
  reportRendererFault('renderer-unhandled-rejection'),
)

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
