import {
  File,
  FileMinus2,
  FilePen,
  FilePlus2,
  FileSymlink,
  type LucideIcon,
} from 'lucide-react'

import type {
  GitChangeKind,
  WorkspaceGitFileStatus,
  WorkspaceGitPullRequest,
} from '../../../shared/git'

const FAILING_CHECK_CONCLUSIONS = new Set([
  'ACTION_REQUIRED',
  'CANCELLED',
  'FAILURE',
  'STARTUP_FAILURE',
  'TIMED_OUT',
])

export interface PullRequestCheckSummary {
  failing: number
  passing: number
  pending: number
}

export function summarizePullRequestChecks(
  checks: WorkspaceGitPullRequest['checks'],
): PullRequestCheckSummary {
  const summary: PullRequestCheckSummary = {
    failing: 0,
    passing: 0,
    pending: 0,
  }

  for (const check of checks) {
    const conclusion = (check.conclusion ?? '').toUpperCase()

    if (conclusion === 'SUCCESS') {
      summary.passing += 1
    } else if (FAILING_CHECK_CONCLUSIONS.has(conclusion)) {
      summary.failing += 1
    } else {
      summary.pending += 1
    }
  }

  return summary
}

export function formatPullRequestState(
  pullRequest: WorkspaceGitPullRequest,
): string {
  const state = pullRequest.state.toUpperCase()

  if (state === 'OPEN' && pullRequest.isDraft) {
    return 'Draft'
  }

  return state.charAt(0) + state.slice(1).toLowerCase()
}

export function hasUnmergedGitFiles(
  files: readonly WorkspaceGitFileStatus[],
): boolean {
  return files.some(
    (file) => file.staged === 'unmerged' || file.unstaged === 'unmerged',
  )
}

export function resolveSelectedGitFilePath(
  files: readonly WorkspaceGitFileStatus[],
  selectedPath: string | null,
): string | null {
  if (!files.length) {
    return null
  }

  if (selectedPath && files.some((file) => file.path === selectedPath)) {
    return selectedPath
  }

  return files[0]?.path ?? null
}

export function formatGitChangeKind(kind: GitChangeKind): string {
  switch (kind) {
    case 'added':
      return 'Added'
    case 'copied':
      return 'Copied'
    case 'deleted':
      return 'Deleted'
    case 'modified':
      return 'Modified'
    case 'renamed':
      return 'Renamed'
    case 'unmerged':
      return 'Unmerged'
    case 'untracked':
      return 'Untracked'
    case 'unmodified':
      return 'Unmodified'
  }
}

export function iconForGitChangeKind(kind: GitChangeKind): LucideIcon {
  switch (kind) {
    case 'added':
    case 'untracked':
      return FilePlus2
    case 'modified':
    case 'unmerged':
      return FilePen
    case 'deleted':
      return FileMinus2
    case 'renamed':
    case 'copied':
      return FileSymlink
    default:
      return File
  }
}

export function iconForGitFile(file: WorkspaceGitFileStatus): LucideIcon {
  const dominant: GitChangeKind =
    file.staged !== 'unmodified' ? file.staged : file.unstaged
  return iconForGitChangeKind(dominant)
}

export function gitChangeKindColorClass(kind: GitChangeKind): string {
  switch (kind) {
    case 'added':
    case 'untracked':
      return 'bg-accent-green'
    case 'modified':
    case 'renamed':
    case 'copied':
      return 'bg-accent-yellow'
    case 'deleted':
      return 'bg-accent-red'
    case 'unmerged':
      return 'bg-accent-red'
    default:
      return 'bg-muted-foreground/40'
  }
}

export function getGitFileChangeBadges(file: WorkspaceGitFileStatus): string[] {
  const badges: string[] = []

  if (file.isStaged) {
    badges.push(`Staged: ${formatGitChangeKind(file.staged)}`)
  }

  if (file.isUnstaged) {
    badges.push(`Unstaged: ${formatGitChangeKind(file.unstaged)}`)
  }

  return badges.length > 0 ? badges : ['Clean']
}

export function letterForGitChangeKind(kind: GitChangeKind): string {
  switch (kind) {
    case 'added':
      return 'A'
    case 'copied':
      return 'C'
    case 'deleted':
      return 'D'
    case 'modified':
      return 'M'
    case 'renamed':
      return 'R'
    case 'unmerged':
      return '!'
    case 'untracked':
      return 'U'
    default:
      return ''
  }
}

export function dominantGitChangeKind(
  file: WorkspaceGitFileStatus,
): GitChangeKind {
  return file.staged !== 'unmodified' ? file.staged : file.unstaged
}

export type GitTreeNode =
  | {
      readonly kind: 'dir'
      readonly path: string
      readonly name: string
      readonly children: GitTreeNode[]
    }
  | {
      readonly kind: 'file'
      readonly path: string
      readonly name: string
      readonly file: WorkspaceGitFileStatus
    }

interface DirBuilder {
  files: Map<string, WorkspaceGitFileStatus>
  dirs: Map<string, DirBuilder>
}

function emptyDir(): DirBuilder {
  return { dirs: new Map(), files: new Map() }
}

function insertFile(root: DirBuilder, file: WorkspaceGitFileStatus): void {
  const segments = file.path.split('/').filter((segment) => segment.length > 0)
  if (segments.length === 0) {
    return
  }

  let current = root
  for (let i = 0; i < segments.length - 1; i += 1) {
    const segment = segments[i] as string
    let next = current.dirs.get(segment)
    if (!next) {
      next = emptyDir()
      current.dirs.set(segment, next)
    }
    current = next
  }

  const fileName = segments[segments.length - 1] as string
  current.files.set(fileName, file)
}

function compactNode(node: GitTreeNode): GitTreeNode {
  if (node.kind === 'file') {
    return node
  }

  const compactedChildren = node.children.map(compactNode)

  if (
    compactedChildren.length === 1 &&
    compactedChildren[0]?.kind === 'dir' &&
    !node.path.endsWith('/')
  ) {
    const onlyChild = compactedChildren[0]
    return {
      children: onlyChild.children,
      kind: 'dir',
      name: `${node.name}/${onlyChild.name}`,
      path: onlyChild.path,
    }
  }

  return {
    children: compactedChildren,
    kind: 'dir',
    name: node.name,
    path: node.path,
  }
}

function materialize(builder: DirBuilder, prefix: string): GitTreeNode[] {
  const dirNodes: GitTreeNode[] = []
  const sortedDirNames = Array.from(builder.dirs.keys()).sort((a, b) =>
    a.localeCompare(b),
  )
  for (const name of sortedDirNames) {
    const childBuilder = builder.dirs.get(name) as DirBuilder
    const dirPath = prefix ? `${prefix}/${name}` : name
    const dirNode: GitTreeNode = {
      children: materialize(childBuilder, dirPath),
      kind: 'dir',
      name,
      path: dirPath,
    }
    dirNodes.push(compactNode(dirNode))
  }

  const fileNodes: GitTreeNode[] = []
  const sortedFileNames = Array.from(builder.files.keys()).sort((a, b) =>
    a.localeCompare(b),
  )
  for (const name of sortedFileNames) {
    const file = builder.files.get(name) as WorkspaceGitFileStatus
    fileNodes.push({ file, kind: 'file', name, path: file.path })
  }

  return [...dirNodes, ...fileNodes]
}

export function buildGitFileTree(
  files: readonly WorkspaceGitFileStatus[],
): GitTreeNode[] {
  if (files.length === 0) {
    return []
  }

  const root = emptyDir()
  for (const file of files) {
    insertFile(root, file)
  }

  return materialize(root, '')
}

export function collectDirPaths(nodes: readonly GitTreeNode[]): string[] {
  const paths: string[] = []
  const walk = (list: readonly GitTreeNode[]) => {
    for (const node of list) {
      if (node.kind === 'dir') {
        paths.push(node.path)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return paths
}
