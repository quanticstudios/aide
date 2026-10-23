export interface MarkdownBlock {
  readonly start: number
  readonly text: string
}

const FENCE = /^ {0,3}(`{3,}|~{3,})/
// why: these lines continue the block above a blank line (lists, indented code, quotes, tables, HTML), so a split there would change the parse.
const CONTINUATION_START = /^(\s|[-*+>|<]|\d+[.)])/
// why: link and footnote definitions resolve across the whole document, and raw HTML blocks may span blank lines.
const WHOLE_DOCUMENT_MARKDOWN =
  /^ {0,3}\[[^\]]+\]:|<(!--|pre|script|style|textarea)/im

/**
 * Splits Markdown at top-level blank lines where the next line starts a fresh block, so each block parses on its own to the same output.
 * @remarks A streaming reply only grows at its end, so every block but the last keeps its text and its memoized render.
 */
export function splitMarkdownBlocks(text: string): MarkdownBlock[] {
  if (WHOLE_DOCUMENT_MARKDOWN.test(text)) return [{ start: 0, text }]
  const blocks: MarkdownBlock[] = []
  let blockStart = 0
  let lineStart = 0
  let fence: string | null = null
  let previousLineBlank = false
  for (const line of text.split('\n')) {
    const marker = FENCE.exec(line)?.[1]
    if (fence) {
      if (
        marker?.[0] === fence[0] &&
        marker.length >= fence.length &&
        !line.trim().slice(marker.length)
      ) {
        fence = null
      }
    } else {
      if (
        previousLineBlank &&
        line.trim() &&
        !CONTINUATION_START.test(line) &&
        lineStart > blockStart
      ) {
        blocks.push({
          start: blockStart,
          text: text.slice(blockStart, lineStart),
        })
        blockStart = lineStart
      }
      if (marker) fence = marker
    }
    previousLineBlank = !fence && !line.trim()
    lineStart += line.length + 1
  }
  blocks.push({ start: blockStart, text: text.slice(blockStart) })
  return blocks
}
