import type { Nodes, Root } from 'mdast'

export interface WorkspaceFilePath {
  readonly path: string
  readonly line: number | null
}

// why: a directory segment and an extension keep `window.aide` and `and/or` out.
const FILE_PATH =
  /^(?:\.\/)?((?:[\w@.+-]+\/)+[\w@.+-]*\.[A-Za-z0-9]+)(?::(\d+)(?::\d+)?|#L(\d+))?$/

/** Reads `src/foo.ts`, `./src/foo.ts:42`, `src/foo.ts:42:7` or `src/foo.ts#L42` as a workspace-relative file. */
export function parseWorkspaceFilePath(text: string): WorkspaceFilePath | null {
  const match = FILE_PATH.exec(text)
  if (!match?.[1] || match[1].split('/').includes('..')) return null
  const line = Number(match[2] ?? match[3] ?? 0)
  return { path: match[1], line: line > 0 ? line : null }
}

/** Turns inline code that is a workspace file path into a link, so the link renderer can draw it as a chip. */
export function remarkWorkspaceFileLinks() {
  const visit = (node: Nodes) => {
    if (
      !('children' in node) ||
      node.type === 'link' ||
      node.type === 'linkReference'
    )
      return
    node.children = node.children.map((child) =>
      child.type === 'inlineCode' && parseWorkspaceFilePath(child.value)
        ? {
            type: 'link',
            url: child.value,
            children: [{ type: 'text', value: child.value }],
          }
        : child,
    ) as typeof node.children
    for (const child of node.children) visit(child)
  }
  return (tree: Root) => visit(tree)
}
