// why: @git-diff-view/core imports @git-diff-view/lowlight, every highlight.js grammar, as its fallback; the renderer aliases it here.
export { diffHighlighter as highlighter } from './highlighter'
