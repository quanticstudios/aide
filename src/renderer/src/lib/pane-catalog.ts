import {
  Eye,
  GitBranch,
  MessageSquareText,
  SquarePen,
  SquareTerminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { PaneType } from '../../../shared/domain'

type PaneAccent = 'amber' | 'blue' | 'emerald' | 'rose' | 'violet'

export interface PaneDefaultMetadata {
  accent: PaneAccent
  description: string
  label: string
  type: string
}

export interface PaneCatalogEntry {
  createDescription: string
  defaultMetadata: PaneDefaultMetadata
  icon: LucideIcon
  type: PaneType
}

const paneCatalogEntries = [
  {
    createDescription: 'Task steering, notes, and AI coordination.',
    defaultMetadata: {
      accent: 'blue',
      description: 'Task and coordination surface.',
      label: 'Chat task thread',
      type: 'Chat',
    },
    icon: MessageSquareText,
    type: 'chat',
  },
  {
    createDescription: 'CLI execution and verification loops.',
    defaultMetadata: {
      accent: 'emerald',
      description: 'Execution and verification surface.',
      label: 'Workspace terminal',
      type: 'Terminal',
    },
    icon: SquareTerminal,
    type: 'terminal',
  },
  {
    createDescription: 'Branch state, diffs, and trust checks.',
    defaultMetadata: {
      accent: 'amber',
      description: 'Inspection and trust surface.',
      label: 'Git review',
      type: 'Git',
    },
    icon: GitBranch,
    type: 'git',
  },
  {
    createDescription: 'File inspection and edit validation.',
    defaultMetadata: {
      accent: 'violet',
      description: 'File inspection and edit validation surface.',
      label: 'Editor inspect',
      type: 'Editor',
    },
    icon: SquarePen,
    type: 'editor',
  },
  {
    createDescription: 'Preview the running app or docs surface.',
    defaultMetadata: {
      accent: 'rose',
      description: 'Preview surface for the running app or docs.',
      label: 'Preview target',
      type: 'Preview',
    },
    icon: Eye,
    type: 'preview',
  },
] satisfies readonly PaneCatalogEntry[]

const paneCatalog = Object.fromEntries(
  paneCatalogEntries.map((entry) => [entry.type, entry]),
) as Record<PaneType, PaneCatalogEntry>

const displayTypeToPaneType = Object.fromEntries(
  paneCatalogEntries.map((entry) => [
    entry.defaultMetadata.type.toLowerCase(),
    entry.type,
  ]),
) as Record<string, PaneType>

const PANE_COPY_MARKER = '::copy-'

export function listPaneCatalogEntries(): readonly PaneCatalogEntry[] {
  return paneCatalogEntries
}

export function getPaneCatalogEntry(paneType: PaneType): PaneCatalogEntry {
  return paneCatalog[paneType]
}

export function createDefaultPaneMetadata(
  paneType: PaneType,
): PaneDefaultMetadata {
  return getPaneCatalogEntry(paneType).defaultMetadata
}

export function createDefaultPaneState(_paneType: PaneType): null {
  return null
}

export function resolvePaneType(typeLabel: string | null): PaneType | null {
  if (!typeLabel) {
    return null
  }

  return displayTypeToPaneType[typeLabel.toLowerCase()] ?? null
}

export function createFallbackPaneMetadata(paneId: string): {
  metadata: PaneDefaultMetadata
  resolvedType: PaneType | null
} {
  const templateId = paneId.includes(PANE_COPY_MARKER)
    ? paneId.slice(0, paneId.indexOf(PANE_COPY_MARKER))
    : paneId
  const resolvedType = (
    templateId in paneCatalog ? templateId : null
  ) as PaneType | null
  const metadata =
    resolvedType !== null
      ? paneCatalog[resolvedType].defaultMetadata
      : paneCatalog.chat.defaultMetadata

  return { metadata, resolvedType }
}
