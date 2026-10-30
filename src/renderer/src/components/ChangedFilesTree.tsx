import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import type { TurnCheckpointDiffFile } from '../../../shared/checkpoints'
import { cn } from '../lib/utils'

const ROW_HEIGHT = 24

/** One visible line of the tree: a folder (with its totals) or a changed file. */
export interface ChangedFileRow {
  additions: number
  deletions: number
  depth: number
  isFolder: boolean
  isOpen: boolean
  name: string
  path: string
}

interface FolderNode {
  additions: number
  deletions: number
  files: TurnCheckpointDiffFile[]
  folders: Map<string, FolderNode>
}

function createFolder(): FolderNode {
  return { additions: 0, deletions: 0, files: [], folders: new Map() }
}

/** Flattens changed files into the rows a reader sees; a folder whose only child is a folder shares its row. */
export function buildChangedFileRows(
  files: readonly TurnCheckpointDiffFile[],
  isFolderOpen: (path: string) => boolean,
): ChangedFileRow[] {
  const root = createFolder()
  for (const file of files) {
    let node = root
    for (const segment of file.path.split('/').slice(0, -1)) {
      let child = node.folders.get(segment)
      if (!child) {
        child = createFolder()
        node.folders.set(segment, child)
      }
      child.additions += file.additions
      child.deletions += file.deletions
      node = child
    }
    node.files.push(file)
  }

  const rows: ChangedFileRow[] = []
  const visit = (node: FolderNode, prefix: string, depth: number) => {
    for (const [segment, child] of [...node.folders].sort(([left], [right]) =>
      left.localeCompare(right),
    )) {
      let folder = child
      let name = segment
      while (folder.files.length === 0 && folder.folders.size === 1) {
        const [[childName, grandchild]] = folder.folders
        name = `${name}/${childName}`
        folder = grandchild
      }
      const path = `${prefix}${name}`
      const isOpen = isFolderOpen(path)
      rows.push({
        additions: folder.additions,
        deletions: folder.deletions,
        depth,
        isFolder: true,
        isOpen,
        name,
        path,
      })
      if (isOpen) visit(folder, `${path}/`, depth + 1)
    }
    for (const file of [...node.files].sort((left, right) =>
      left.path.localeCompare(right.path),
    )) {
      rows.push({
        additions: file.additions,
        deletions: file.deletions,
        depth,
        isFolder: false,
        isOpen: false,
        name: file.path.slice(prefix.length),
        path: file.path,
      })
    }
  }
  visit(root, '', 0)
  return rows
}

/** A virtualized folder tree of changed files with +/- counts; clicking a file calls `onSelect`. */
export default function ChangedFilesTree({
  className,
  defaultExpanded,
  files,
  onSelect,
  selectedPath,
}: {
  readonly className?: string
  readonly defaultExpanded: boolean
  readonly files: readonly TurnCheckpointDiffFile[]
  readonly onSelect: (path: string) => void
  readonly selectedPath?: string
}) {
  const [toggledFolders, setToggledFolders] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const rows = useMemo(
    () =>
      buildChangedFileRows(
        files,
        (path) => defaultExpanded !== toggledFolders.has(path),
      ),
    [defaultExpanded, files, toggledFolders],
  )
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    estimateSize: () => ROW_HEIGHT,
    getItemKey: (index) => rows[index]?.path ?? index,
    getScrollElement: () => scrollRef.current,
    initialRect: { height: 12 * ROW_HEIGHT, width: 0 },
    overscan: 8,
  })

  const toggleFolder = (path: string) =>
    setToggledFolders((current) => {
      const next = new Set(current)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <div
      className={cn('max-h-72 overflow-y-auto py-1', className)}
      data-testid="changed-files-tree"
      ref={scrollRef}
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const row = rows[item.index]
          if (!row) return null
          return (
            <button
              aria-current={row.path === selectedPath ? 'true' : undefined}
              aria-expanded={row.isFolder ? row.isOpen : undefined}
              className={cn(
                'absolute inset-x-0 top-0 flex items-center gap-1.5 pr-2 text-left text-[11px] text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground',
                row.path === selectedPath && 'bg-surface-2 text-foreground',
              )}
              data-path={row.path}
              key={item.key}
              onClick={() =>
                row.isFolder ? toggleFolder(row.path) : onSelect(row.path)
              }
              style={{
                height: ROW_HEIGHT,
                paddingLeft: 8 + row.depth * 12,
                transform: `translateY(${item.start}px)`,
              }}
              type="button"
            >
              {row.isFolder ? (
                <ChevronRight
                  className={cn(
                    'size-3 shrink-0 transition-transform',
                    row.isOpen && 'rotate-90',
                  )}
                />
              ) : (
                <span className="size-3 shrink-0" />
              )}
              <span
                className={cn('truncate', row.isFolder && 'font-medium')}
                title={row.path}
              >
                {row.name}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-accent-green">
                +{row.additions}
              </span>
              <span className="shrink-0 tabular-nums text-accent-red">
                -{row.deletions}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
