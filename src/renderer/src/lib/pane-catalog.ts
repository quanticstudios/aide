import {
  Eye,
  GitBranch,
  MessageSquareText,
  SquarePen,
  SquareTerminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import type { PaneType } from '../../../shared/domain'
import type { TerminalLaunchMode } from '../../../shared/terminal'

type PaneAccent = 'amber' | 'blue' | 'emerald' | 'rose' | 'violet'
export type PaneTemplateId =
  | 'chat'
  | 'terminal'
  | 'terminal-claude'
  | 'terminal-codex'
  | 'git'
  | 'editor'
  | 'preview'

export interface PaneDefaultMetadata {
  accent: PaneAccent
  description: string
  label: string
  type: string
}

export interface PaneCatalogEntry {
  createDescription: string
  defaultMetadata: PaneDefaultMetadata
  id: PaneTemplateId
  icon: LucideIcon
  terminalMode?: TerminalLaunchMode
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
    id: 'chat',
    icon: MessageSquareText,
    type: 'chat',
  },
  {
    createDescription: 'Plain shell execution and verification loops.',
    defaultMetadata: {
      accent: 'emerald',
      description: 'Execution and verification surface.',
      label: 'Workspace terminal',
      type: 'Terminal',
    },
    id: 'terminal',
    icon: SquareTerminal,
    terminalMode: 'shell',
    type: 'terminal',
  },
  {
    createDescription: 'Managed Claude Code session for agent work.',
    defaultMetadata: {
      accent: 'emerald',
      description: 'Managed Claude Code terminal session.',
      label: 'Claude terminal',
      type: 'Claude',
    },
    id: 'terminal-claude',
    icon: SquareTerminal,
    terminalMode: 'claude',
    type: 'terminal',
  },
  {
    createDescription: 'Managed Codex session for agent work.',
    defaultMetadata: {
      accent: 'emerald',
      description: 'Managed Codex terminal session.',
      label: 'Codex terminal',
      type: 'Codex',
    },
    id: 'terminal-codex',
    icon: SquareTerminal,
    terminalMode: 'codex',
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
    id: 'git',
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
    id: 'editor',
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
    id: 'preview',
    icon: Eye,
    type: 'preview',
  },
] satisfies readonly PaneCatalogEntry[]

const paneCatalogById = Object.fromEntries(
  paneCatalogEntries.map((entry) => [entry.id, entry]),
) as Record<PaneTemplateId, PaneCatalogEntry>

const paneCatalogByType = {
  chat: paneCatalogById.chat,
  terminal: paneCatalogById.terminal,
  git: paneCatalogById.git,
  editor: paneCatalogById.editor,
  preview: paneCatalogById.preview,
} as Record<PaneType, PaneCatalogEntry>

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
  return paneCatalogByType[paneType]
}

export function getPaneCatalogEntryForTemplate(
  paneTemplateId: string,
): PaneCatalogEntry | null {
  return paneCatalogById[paneTemplateId as PaneTemplateId] ?? null
}

export function createDefaultPaneMetadata(
  paneTemplateId: string,
): PaneDefaultMetadata {
  return (
    getPaneCatalogEntryForTemplate(paneTemplateId)?.defaultMetadata ??
    getPaneCatalogEntry(resolvePaneType(paneTemplateId) ?? 'chat')
      .defaultMetadata
  )
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
  const entry = getPaneCatalogEntryForTemplate(templateId)
  const resolvedType = entry?.type ?? null
  const metadata =
    entry?.defaultMetadata ?? paneCatalogByType.chat.defaultMetadata

  return { metadata, resolvedType }
}

export function resolveTerminalLaunchModeForPaneId(
  paneId: string,
): TerminalLaunchMode {
  const templateId = paneId.includes(PANE_COPY_MARKER)
    ? paneId.slice(0, paneId.indexOf(PANE_COPY_MARKER))
    : paneId

  return getPaneCatalogEntryForTemplate(templateId)?.terminalMode ?? 'shell'
}
