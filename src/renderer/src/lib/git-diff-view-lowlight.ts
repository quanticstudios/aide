// why: @git-diff-view/core imports @git-diff-view/lowlight as its fallback, which bundles all 184 highlight.js grammars; the renderer aliases it here.
export { diffHighlighter as highlighter } from './highlighter'
