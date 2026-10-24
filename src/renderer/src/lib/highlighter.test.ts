import { describe, expect, it, vi } from 'vitest'

import {
  cachedTokens,
  diffHighlighter,
  highlight,
  isLanguageLoaded,
  loadLanguage,
  resolveLanguage,
} from './highlighter'

const grammarImport = vi.hoisted(() => ({ failures: 0 }))

vi.mock('shiki/langs/lua.mjs', async (importOriginal) => {
  if (grammarImport.failures > 0) {
    grammarImport.failures -= 1
    throw new Error('Failed to fetch dynamically imported module')
  }
  return importOriginal()
})

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

describe('highlight', () => {
  it('tokenizes asynchronously, colors tokens from theme variables, and caches the block', async () => {
    const code = 'fn main() {\n  let x = 1;\n}'
    const pending = highlight(code, 'rust')
    expect(cachedTokens(code, 'rust')).toBeNull()

    const lines = await pending

    expect(lines).toHaveLength(3)
    const fn = lines?.[0]?.find((token) => token.content === 'fn')
    expect(fn?.color).toBe('var(--shiki-token-keyword)')
    expect(cachedTokens(code, 'rust')).toBe(lines)
    expect(cachedTokens(code, 'go')).toBeNull()
  })

  it('highlights a block without another grammar load once its grammar is loaded', async () => {
    await loadLanguage('go')
    const startedAt = performance.now()
    const lines = await highlight('package main\n\nfunc main() {\n}\n', 'go')

    const func = lines?.flat().find((token) => token.content === 'func')
    expect(func?.color).toBe('var(--shiki-token-keyword)')
    // why: shared CI runners stall for 100 ms at random, so only a gross regression such as a grammar reload may fail this.
    expect(performance.now() - startedAt).toBeLessThan(1000)
  })

  it('skips blocks over the line cap', async () => {
    expect(await highlight('x\n'.repeat(2001), 'go')).toBeNull()
  })

  it('preloads the common grammars with the highlighter', async () => {
    await loadLanguage('rust')
    expect(isLanguageLoaded('go')).toBe(true)
    expect(isLanguageLoaded('typescript')).toBe(true)
    expect(isLanguageLoaded('cpp')).toBe(false)
  })

  it('retries a grammar whose chunk failed to load', async () => {
    grammarImport.failures = 1

    await expect(loadLanguage('lua')).rejects.toThrow()
    await expect(highlight('local x = 1', 'lua')).resolves.toHaveLength(1)
    expect(isLanguageLoaded('lua')).toBe(true)
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
