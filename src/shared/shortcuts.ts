export type AppShortcutEvent =
  | { type: 'overview-open' }
  | { type: 'pane-next' }
  | { type: 'pane-previous' }
  | { type: 'workspace-next' }
  | { type: 'workspace-previous' }
  | { projectIndex: number; type: 'project-jump' }
