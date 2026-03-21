import { useCallback, useEffect, useMemo, useState } from 'react'

import {
  type RuntimeSnapshot,
  formatPlatformLabel,
  formatRuntimeSummary,
} from '../../shared/runtime'

type LoadState = 'idle' | 'loading' | 'ready' | 'error'

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown renderer error'
}

export default function App() {
  const [snapshot, setSnapshot] = useState<RuntimeSnapshot | null>(null)
  const [state, setState] = useState<LoadState>('idle')
  const [error, setError] = useState<string | null>(null)

  const summary = useMemo(() => {
    if (!snapshot) {
      return 'Waiting for the Electron main process to answer the renderer handshake.'
    }

    return formatRuntimeSummary(snapshot)
  }, [snapshot])

  const refreshSnapshot = useCallback(async (): Promise<void> => {
    setState('loading')

    try {
      const nextSnapshot = await window.aide.getRuntimeSnapshot()
      setSnapshot(nextSnapshot)
      setError(null)
      setState('ready')
    } catch (loadError) {
      setSnapshot(null)
      setError(getErrorMessage(loadError))
      setState('error')
    }
  }, [])

  useEffect(() => {
    void refreshSnapshot()
  }, [refreshSnapshot])

  const platformLabel = snapshot
    ? formatPlatformLabel(snapshot.platform, snapshot.arch)
    : 'Pending'

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Phase 0 / P0-002</p>
        <h1>Electron shell spike</h1>
        <p className="lede">
          This scaffold proves the desktop shell, Bun tooling, React renderer,
          and preload IPC bridge before the pane system lands.
        </p>
        <div className="actions">
          <button onClick={() => void refreshSnapshot()} type="button">
            Refresh IPC round-trip
          </button>
          <span className={`status status-${state}`}>
            {state === 'ready' ? 'IPC connected' : state}
          </span>
        </div>
      </section>

      <section className="grid">
        <article className="panel panel-primary">
          <h2>Handshake summary</h2>
          <p>{summary}</p>
        </article>

        <article className="panel">
          <h2>Desktop shell</h2>
          <dl>
            <div>
              <dt>Platform</dt>
              <dd>{platformLabel}</dd>
            </div>
            <div>
              <dt>Electron</dt>
              <dd>{snapshot?.electronVersion ?? 'Pending'}</dd>
            </div>
            <div>
              <dt>Chrome</dt>
              <dd>{snapshot?.chromeVersion ?? 'Pending'}</dd>
            </div>
            <div>
              <dt>Node</dt>
              <dd>{snapshot?.nodeVersion ?? 'Pending'}</dd>
            </div>
          </dl>
        </article>

        <article className="panel">
          <h2>Working path</h2>
          <p className="mono">
            {snapshot?.workingDirectory ?? 'Waiting for main process data'}
          </p>
        </article>

        <article className="panel">
          <h2>Implementation baseline</h2>
          <ul>
            <li>Electron desktop shell</li>
            <li>React + TypeScript renderer</li>
            <li>Bun package and script runner</li>
            <li>Vite-powered dev and build flow</li>
          </ul>
        </article>
      </section>

      {error ? (
        <section className="panel panel-error">
          <h2>Renderer error</h2>
          <p>{error}</p>
        </section>
      ) : null}
    </main>
  )
}
