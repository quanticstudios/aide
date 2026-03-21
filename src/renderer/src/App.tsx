import Editor from '@monaco-editor/react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { EDITOR_SAMPLE_FILES, type ProjectTextFile } from '../../shared/editor'
import type { PersistenceSnapshot } from '../../shared/persistence'
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
  const [storageSnapshot, setStorageSnapshot] =
    useState<PersistenceSnapshot | null>(null)
  const [storageState, setStorageState] = useState<LoadState>('idle')
  const [storageError, setStorageError] = useState<string | null>(null)

  const summary = useMemo(() => {
    if (!snapshot) {
      return 'Waiting for the Electron main process to answer the renderer handshake.'
    }

    return formatRuntimeSummary(snapshot)
  }, [snapshot])

  const workspaceCount = storageSnapshot?.workspaces.length ?? 0
  const projectCount = storageSnapshot?.projects.length ?? 0

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

  const refreshStorage = useCallback(async (): Promise<void> => {
    setStorageState('loading')

    try {
      const nextSnapshot = await window.aide.getStorageSnapshot()
      setStorageSnapshot(nextSnapshot)
      setStorageError(null)
      setStorageState('ready')
    } catch (loadError) {
      setStorageSnapshot(null)
      setStorageError(getErrorMessage(loadError))
      setStorageState('error')
    }
  }, [])

  useEffect(() => {
    if (!selectedFile) {
      return
    }

    void loadProjectFile(selectedFile)
  }, [loadProjectFile, selectedFile])

  useEffect(() => {
    void refreshStorage()
  }, [refreshStorage])

  const createProject = useCallback(async (): Promise<void> => {
    setStorageState('loading')

    try {
      const projectNumber = (storageSnapshot?.projects.length ?? 0) + 1
      const nextSnapshot = await window.aide.createProject({
        defaultBranch: 'main',
        name: `Navigation Project ${projectNumber}`,
        remoteUrl: null,
        repoRoot: `${snapshot?.workingDirectory ?? '/workspace/aide'}/project-${projectNumber}`,
      })
      setStorageSnapshot(nextSnapshot)
      setStorageError(null)
      setStorageState('ready')
    } catch (createError) {
      setStorageError(getErrorMessage(createError))
      setStorageState('error')
    }
  }, [snapshot?.workingDirectory, storageSnapshot?.projects.length])

  const createWorkspace = useCallback(async (): Promise<void> => {
    const latestProject = storageSnapshot?.projects.at(-1)

    if (!latestProject) {
      setStorageError('Create a project before adding a workspace.')
      setStorageState('error')
      return
    }

    setStorageState('loading')

    try {
      const workspaceNumber = (storageSnapshot?.workspaces.length ?? 0) + 1
      const nextSnapshot = await window.aide.createWorkspace({
        branchName: `navigation-${workspaceNumber}`,
        name: `Workspace ${workspaceNumber}`,
        projectId: latestProject.id,
        windowId: null,
        worktreePath: `${latestProject.repoRoot}/.worktrees/navigation-${workspaceNumber}`,
      })
      setStorageSnapshot(nextSnapshot)
      setStorageError(null)
      setStorageState('ready')
    } catch (createError) {
      setStorageError(getErrorMessage(createError))
      setStorageState('error')
    }
  }, [storageSnapshot])

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
          <button onClick={() => void refreshStorage()} type="button">
            Reload persisted workspace registry
          </button>
          <span className={`status status-${state}`}>
            {state === 'ready' ? 'IPC connected' : state}
          </span>
          <span className={`status status-${storageState}`}>
            {storageState === 'ready' ? 'SQLite ready' : storageState}
          </span>
        </div>
      </section>

      <section className="workspace-stage">
        <section className="panel navigation-shell">
          <div className="editor-toolbar">
            <div>
              <p className="eyebrow">Navigation first</p>
              <h2>Persisted workspace registry</h2>
            </div>
            <div className="actions compact-actions">
              <button onClick={() => void createProject()} type="button">
                Create project
              </button>
              <button onClick={() => void createWorkspace()} type="button">
                Create workspace
              </button>
            </div>
          </div>

          <p className="lede small-copy">
            This spike proves that projects and workspaces can be stored in
            SQLite, reloaded on startup, and surfaced as navigation data before
            deeper pane work.
          </p>

          <div className="grid storage-grid">
            <article className="panel nested-panel">
              <h3>Schema</h3>
              <p>
                {storageSnapshot?.migrationStrategy ??
                  'Waiting for database metadata'}
              </p>
              <p className="mono">
                {storageSnapshot?.databasePath ?? 'Pending database path'}
              </p>
              <p>Schema version: {storageSnapshot?.schemaVersion ?? 0}</p>
            </article>

            <article className="panel nested-panel">
              <h3>Projects ({projectCount})</h3>
              <ul className="record-list">
                {storageSnapshot?.projects.map((project) => (
                  <li key={project.id}>
                    <strong>{project.name}</strong>
                    <span>{project.defaultBranch}</span>
                    <span className="mono">{project.repoRoot}</span>
                  </li>
                )) ?? <li>No projects stored yet.</li>}
              </ul>
            </article>

            <article className="panel nested-panel">
              <h3>Workspaces ({workspaceCount})</h3>
              <ul className="record-list">
                {storageSnapshot?.workspaces.map((workspace) => (
                  <li key={workspace.id}>
                    <strong>{workspace.name}</strong>
                    <span>{workspace.branchName}</span>
                    <span className="mono">{workspace.worktreePath}</span>
                  </li>
                )) ?? <li>No workspaces stored yet.</li>}
              </ul>
            </article>
          </div>

          {storageError ? <p className="error-copy">{storageError}</p> : null}
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
              height="100%"
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

        <section className="grid details-grid">
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
