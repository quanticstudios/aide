import type { DiffFileHighlighter, SyntaxLine } from '@git-diff-view/react'
import type { Element, Root, RootContent } from 'hast'
import type { HighlighterCore, LanguageInput, ThemedToken } from 'shiki/core'

const THEME = 'aide'

const PRELOADED_GRAMMARS = {
  diff: () => import('shiki/langs/diff.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
}

// invariant: only grammars listed here are bundled; any other language renders plain.
const GRAMMARS: Record<string, LanguageInput> = {
  ...PRELOADED_GRAMMARS,
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  docker: () => import('shiki/langs/docker.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
}

const ALIASES: Record<string, string> = {
  bash: 'shellscript',
  'c#': 'csharp',
  'c++': 'cpp',
  cc: 'cpp',
  cjs: 'javascript',
  cs: 'csharp',
  cts: 'typescript',
  dockerfile: 'docker',
  golang: 'go',
  h: 'c',
  hpp: 'cpp',
  htm: 'html',
  js: 'javascript',
  kt: 'kotlin',
  kts: 'kotlin',
  makefile: 'make',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  patch: 'diff',
  ps1: 'powershell',
  py: 'python',
  rs: 'rust',
  sh: 'shellscript',
  shell: 'shellscript',
  ts: 'typescript',
  yml: 'yaml',
  zsh: 'shellscript',
}

let highlighter: HighlighterCore | null = null
let highlighterLoad: Promise<HighlighterCore> | null = null
const languageLoads = new Map<string, Promise<void>>()

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterLoad ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/javascript'),
  ]).then(
    async ([
      { createCssVariablesTheme, createHighlighterCore },
      { createJavaScriptRegexEngine },
    ]) => {
      highlighter = await createHighlighterCore({
        engine: createJavaScriptRegexEngine({ forgiving: true }),
        langs: Object.values(PRELOADED_GRAMMARS),
        // why: token colors are --shiki-* variables from styles.css, so a palette can restyle them.
        themes: [createCssVariablesTheme({ name: THEME })],
      })
      return highlighter
    },
  )
  return highlighterLoad
}

/** Maps a fence language or file extension to a bundled grammar name, or null when none covers it. */
export function resolveLanguage(name: string | undefined): string | null {
  if (!name) return null
  const key = name.toLowerCase()
  const lang = ALIASES[key] ?? key
  return Object.hasOwn(GRAMMARS, lang) ? lang : null
}

/** True once `tokenize` can highlight a resolved language. */
export function isLanguageLoaded(lang: string): boolean {
  return highlighter?.getLoadedLanguages().includes(lang) ?? false
}

/** Loads the shared highlighter and the grammar for a resolved language. */
export function loadLanguage(lang: string): Promise<void> {
  let load = languageLoads.get(lang)
  if (!load) {
    load = loadHighlighter().then(async (core) => {
      if (!isLanguageLoaded(lang)) await core.loadLanguage(GRAMMARS[lang])
    })
    languageLoads.set(lang, load)
  }
  return load
}

/** Tokenizes code, or returns null until the language's grammar is loaded. */
export function tokenize(code: string, lang: string): ThemedToken[][] | null {
  if (!highlighter || !isLanguageLoaded(lang)) return null
  return highlighter.codeToTokensBase(code, { lang, theme: THEME })
}

type SyntaxNode = SyntaxLine['nodeList'][number]['node']

function toWrapper(element: Element, lineNumber: number): SyntaxNode {
  return {
    endIndex: 0,
    lineNumber,
    properties: element.properties,
    startIndex: 0,
    type: 'element',
    value: '',
  }
}

// see: @git-diff-view/shiki 0.1.6 processAST — the per-line node shape the diff view renders.
function processAST(ast: Root) {
  let lineNumber = 1
  const syntaxFileObject: Record<number, SyntaxLine> = {}
  const push = (value: string, wrapper: SyntaxNode | undefined) => {
    syntaxFileObject[lineNumber] ??= {
      lineNumber,
      nodeList: [],
      value: '',
      valueLength: 0,
    }
    const line = syntaxFileObject[lineNumber]
    const node: SyntaxNode = {
      endIndex: line.valueLength + value.length - 1,
      lineNumber,
      startIndex: line.valueLength,
      type: 'text',
      value,
    }
    line.value += value
    line.valueLength += value.length
    line.nodeList.push({ node, wrapper })
  }
  const walk = (nodes: RootContent[], wrapper?: SyntaxNode) => {
    for (const node of nodes) {
      if (node.type === 'text') {
        const parts = node.value.split('\n')
        parts.forEach((part, index) => {
          if (index > 0) lineNumber += 1
          push(index < parts.length - 1 ? `${part}\n` : part, wrapper)
        })
      } else if (node.type === 'element') {
        walk(node.children, toWrapper(node, lineNumber))
      }
    }
  }
  walk(ast.children)
  return { syntaxFileLineNumber: lineNumber, syntaxFileObject }
}

/** The diff view's highlighter, backed by the same Shiki instance as markdown code blocks. */
export const diffHighlighter: DiffFileHighlighter = {
  getAST: (raw, _fileName, lang) => {
    if (!highlighter || !lang || !isLanguageLoaded(lang)) {
      // warn: the diff view treats an undefined AST as plain text, but its type omits undefined.
      return undefined as unknown as Root
    }
    return highlighter.codeToHast(raw, {
      lang,
      mergeWhitespaces: false,
      theme: THEME,
    })
  },
  hasRegisteredCurrentLang: isLanguageLoaded,
  ignoreSyntaxHighlightList: [],
  maxLineToIgnoreSyntax: 2000,
  name: 'aide-shiki',
  processAST,
  setIgnoreSyntaxHighlightList(list) {
    this.ignoreSyntaxHighlightList = list
  },
  setMaxLineToIgnoreSyntax(lines) {
    this.maxLineToIgnoreSyntax = lines
  },
  type: 'class',
}
