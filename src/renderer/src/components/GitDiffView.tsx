import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { getDiffViewHighlighter } from '@git-diff-view/shiki'
import { useEffect, useMemo, useState } from 'react'

type DiffHighlighter = Awaited<ReturnType<typeof getDiffViewHighlighter>>

/** Which way a diff is laid out: one column of changes or two. */
export type DiffLayout = 'line-by-line' | 'side-by-side'

const HIGHLIGHTER_LANGS = [
  'typescript',
  'tsx',
  'javascript',
  'jsx',
  'json',
  'css',
  'html',
  'markdown',
  'bash',
  'python',
  'go',
  'sql',
  'yaml',
  'xml',
] as const

let highlighterPromise: Promise<DiffHighlighter> | null = null

function loadHighlighter(): Promise<DiffHighlighter> {
  highlighterPromise ??= getDiffViewHighlighter([...HIGHLIGHTER_LANGS])
  return highlighterPromise
}

function inferFileLang(filePath: string): string {
  const lower = filePath.toLowerCase()
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.') + 1) : ''
  switch (ext) {
    case 'ts':
      return 'typescript'
    case 'tsx':
      return 'tsx'
    case 'js':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'jsx':
      return 'jsx'
    case 'json':
      return 'json'
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'css':
      return 'css'
    case 'scss':
    case 'sass':
      return 'sass'
    case 'html':
    case 'htm':
      return 'html'
    case 'xml':
      return 'xml'
    case 'sh':
    case 'bash':
    case 'zsh':
      return 'bash'
    case 'py':
      return 'python'
    case 'go':
      return 'go'
    case 'sql':
      return 'sql'
    case 'yaml':
    case 'yml':
      return 'yaml'
    default:
      return 'txt'
  }
}

/** Renders one file's patch with syntax highlighting. */
export function GitDiffView({
  filePath,
  outputFormat,
  patch,
}: {
  readonly filePath: string
  readonly outputFormat: DiffLayout
  readonly patch: string
}) {
  const [highlighter, setHighlighter] = useState<DiffHighlighter | null>(null)

  useEffect(() => {
    let cancelled = false
    void loadHighlighter().then((h) => {
      if (!cancelled) {
        setHighlighter(h)
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  const lang = useMemo(() => inferFileLang(filePath), [filePath])

  const diffFile = useMemo(() => {
    const file = DiffFile.createInstance({
      hunks: [patch],
      newFile: { fileLang: lang, fileName: filePath },
      oldFile: { fileLang: lang, fileName: filePath },
    })
    file.initTheme('dark')
    file.init()
    if (outputFormat === 'side-by-side') {
      file.buildSplitDiffLines()
    } else {
      file.buildUnifiedDiffLines()
    }
    return file
  }, [filePath, lang, outputFormat, patch])

  return (
    <DiffView
      diffFile={diffFile}
      diffViewFontSize={12}
      diffViewHighlight={highlighter !== null}
      diffViewMode={
        outputFormat === 'side-by-side'
          ? DiffModeEnum.Split
          : DiffModeEnum.Unified
      }
      diffViewTheme="dark"
      diffViewWrap={false}
      registerHighlighter={highlighter ?? undefined}
    />
  )
}
