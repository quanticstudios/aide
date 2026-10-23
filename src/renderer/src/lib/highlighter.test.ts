import { describe, expect, it } from 'vitest'

import {
  diffHighlighter,
  isLanguageLoaded,
  loadLanguage,
  resolveLanguage,
  tokenize,
} from './highlighter'

describe('resolveLanguage', () => {
  it('maps fence names and file extensions to bundled grammars', () => {
    expect(resolveLanguage('ts')).toBe('typescript')
    expect(resolveLanguage('TSX')).toBe('tsx')
    expect(resolveLanguage('go')).toBe('go')
    expect(resolveLanguage('sh')).toBe('shellscript')
    expect(resolveLanguage('yml')).toBe('yaml')
    expect(resolveLanguage('Makefile')).toBe('make')
    expect(resolveLanguage('rs')).toBe('rust')
  })

  it('returns null for languages without a bundled grammar', () => {
    expect(resolveLanguage(undefined)).toBeNull()
    expect(resolveLanguage('')).toBeNull()
    expect(resolveLanguage('brainfuck')).toBeNull()
    expect(resolveLanguage('emacs-lisp')).toBeNull()
    expect(resolveLanguage('toString')).toBeNull()
  })
})

describe('tokenize', () => {
  it('returns null until the grammar loads, then colors tokens from theme variables', async () => {
    expect(tokenize('fn main() {}', 'rust')).toBeNull()

    await loadLanguage('rust')
    const startedAt = performance.now()
    const lines = tokenize('fn main() {\n  let x = 1;\n}', 'rust')
    const elapsedMs = performance.now() - startedAt

    expect(elapsedMs).toBeLessThan(100)
    expect(lines).toHaveLength(3)
    const fn = lines?.[0]?.find((token) => token.content === 'fn')
    expect(fn?.color).toBe('var(--shiki-token-keyword)')
  })

  it('preloads the common grammars with the highlighter', async () => {
    await loadLanguage('rust')
    expect(isLanguageLoaded('go')).toBe(true)
    expect(isLanguageLoaded('typescript')).toBe(true)
    expect(isLanguageLoaded('cpp')).toBe(false)
  })
})

describe('diffHighlighter', () => {
  it('splits highlighted source into numbered lines for the diff view', async () => {
    await loadLanguage('typescript')
    const source = 'const a = 1\nconst b = "x"\n'

    const { syntaxFileObject, syntaxFileLineNumber } =
      diffHighlighter.processAST(
        diffHighlighter.getAST(source, 'a.ts', 'typescript'),
      )

    expect(syntaxFileLineNumber).toBe(3)
    expect(syntaxFileObject[1]?.value).toBe('const a = 1\n')
    expect(syntaxFileObject[2]?.value).toBe('const b = "x"\n')
    const keyword = syntaxFileObject[1]?.nodeList.find(
      ({ node }) => node.value === 'const',
    )
    expect(keyword?.wrapper?.properties?.style).toContain('--shiki-token')
  })

  it('reports unloaded languages as unregistered so they render plain', () => {
    expect(diffHighlighter.hasRegisteredCurrentLang('txt')).toBe(false)
    expect(diffHighlighter.getAST('x', 'a.txt', 'txt')).toBeUndefined()
  })
})
