import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { useEffect, useMemo, useState } from 'react'

import {
  diffHighlighter,
  isLanguageLoaded,
  loadLanguage,
  resolveLanguage,
} from '../lib/highlighter'

/** Which way a diff is laid out: one column of changes or two. */
export type DiffLayout = 'line-by-line' | 'side-by-side'

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
  const lang = useMemo(() => {
    const name = filePath.slice(filePath.lastIndexOf('/') + 1)
    return resolveLanguage(name.slice(name.lastIndexOf('.') + 1))
  }, [filePath])
  const [loadedLang, setLoadedLang] = useState<string | null>(null)
  const highlight =
    lang !== null && (lang === loadedLang || isLanguageLoaded(lang))

  useEffect(() => {
    if (!lang || highlight) return
    let cancelled = false
    void loadLanguage(lang).then(() => {
      if (!cancelled) {
        setLoadedLang(lang)
      }
    })
    return () => {
      cancelled = true
    }
  }, [highlight, lang])

  const diffFile = useMemo(() => {
    const file = DiffFile.createInstance({
      hunks: [patch],
      newFile: { fileLang: lang ?? 'txt', fileName: filePath },
      oldFile: { fileLang: lang ?? 'txt', fileName: filePath },
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
      diffViewHighlight={highlight}
      diffViewMode={
        outputFormat === 'side-by-side'
          ? DiffModeEnum.Split
          : DiffModeEnum.Unified
      }
      diffViewTheme="dark"
      diffViewWrap={false}
      registerHighlighter={diffHighlighter}
    />
  )
}
