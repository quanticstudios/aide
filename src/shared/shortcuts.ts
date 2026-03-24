export type AppShortcutEvent =
  | { type: 'pane-next' }
  | { type: 'pane-previous' }
  | { type: 'workspace-next' }
  | { type: 'workspace-previous' }
  | { projectIndex: number; type: 'project-jump' }
