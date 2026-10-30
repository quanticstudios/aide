import { DiffFile, DiffModeEnum, DiffView } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view-pure.css'
import { useEffect, useMemo, useState } from 'react'

import { useFontPreference } from '../lib/font-preference'
import {
  diffHighlighter,
  isLanguageLoaded,
  loadLanguage,
  resolveLanguage,
} from '../lib/highlighter'
import { useColorScheme } from '../lib/theme-preference'

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
  const colorScheme = useColorScheme()
  const { codeSize } = useFontPreference()
  const highlight =
    lang !== null && (lang === loadedLang || isLanguageLoaded(lang))

  useEffect(() => {
    if (!lang || highlight) return
    let cancelled = false
    loadLanguage(lang).then(
      () => {
        if (!cancelled) {
          setLoadedLang(lang)
        }
      },
      // why: a failed grammar load leaves the diff plain; the next mount retries.
      () => undefined,
    )
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
      diffViewFontSize={codeSize ?? 12}
      diffViewHighlight={highlight}
      diffViewMode={
        outputFormat === 'side-by-side'
          ? DiffModeEnum.Split
          : DiffModeEnum.Unified
      }
      diffViewTheme={colorScheme}
      diffViewWrap={false}
      registerHighlighter={diffHighlighter}
    />
  )
}
