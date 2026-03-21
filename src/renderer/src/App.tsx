import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { EDITOR_SAMPLE_FILES, type ProjectTextFile } from '../../shared/editor'
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
  const [selectedFile, setSelectedFile] = useState(
    EDITOR_SAMPLE_FILES[0]?.relativePath ?? '',
  )
  const [editorDocument, setEditorDocument] = useState<ProjectTextFile | null>(
    null,
  )
  const [editorState, setEditorState] = useState<LoadState>('idle')
  const [editorError, setEditorError] = useState<string | null>(null)

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

  const loadProjectFile = useCallback(
    async (relativePath: string): Promise<void> => {
      setEditorState('loading')

      try {
        const nextDocument = await window.aide.readProjectFile(relativePath)
        setEditorDocument(nextDocument)
        setEditorError(null)
        setEditorState('ready')
      } catch (loadError) {
        setEditorDocument(null)
        setEditorError(getErrorMessage(loadError))
        setEditorState('error')
      }
    },
    [],
  )

  useEffect(() => {
    if (!selectedFile) {
      return
    }

    void loadProjectFile(selectedFile)
  }, [loadProjectFile, selectedFile])

  const platformLabel = snapshot
    ? formatPlatformLabel(snapshot.platform, snapshot.arch)
    : 'Pending'

  return (
    <main className="shell">
      <section className="hero">
        <p className="eyebrow">Phase 0 / P0-003</p>
        <h1>Electron + Monaco spike</h1>
        <p className="lede">
          The renderer now hosts Monaco with syntax highlighting and opens real
          project files through a safe main-process file bridge.
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

      <section className="panel editor-shell">
        <div className="editor-toolbar">
          <div>
            <p className="eyebrow">Editor spike</p>
            <h2>Monaco file preview</h2>
          </div>
          <div className="editor-controls">
            <label htmlFor="editor-file">Open file</label>
            <select
              id="editor-file"
              onChange={(event) => setSelectedFile(event.target.value)}
              value={selectedFile}
            >
              {EDITOR_SAMPLE_FILES.map((file) => (
                <option key={file.relativePath} value={file.relativePath}>
                  {file.label}
                </option>
              ))}
            </select>
            <span className={`status status-${editorState}`}>
              {editorState === 'ready' ? 'File loaded' : editorState}
            </span>
          </div>
        </div>

        <p className="editor-path mono">
          {editorDocument?.absolutePath ??
            'Waiting for the selected file to load'}
        </p>

        <div className="editor-frame">
          <Editor
            height="520px"
            loading="Booting Monaco..."
            options={{
              automaticLayout: true,
              fontFamily: 'IBM Plex Mono',
              fontSize: 13,
              minimap: { enabled: false },
              readOnly: true,
              scrollBeyondLastLine: false,
              wordWrap: 'on',
            }}
            path={editorDocument?.relativePath ?? selectedFile}
            theme="vs-dark"
            value={editorDocument?.content ?? ''}
          />
        </div>

        {editorError ? <p className="error-copy">{editorError}</p> : null}
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
