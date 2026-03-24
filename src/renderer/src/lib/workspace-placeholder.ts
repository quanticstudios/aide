import type { PlaceholderPane } from './navigation-poc'

export interface PlaceholderAction {
  description: string
  title: string
}

export function getPlaceholderActionsForPane(
  pane: Pick<PlaceholderPane, 'type'>,
): PlaceholderAction[] {
  const actionsByPaneType: Record<string, PlaceholderAction[]> = {
    Chat: [
      {
        description:
          'Capture the active goal, constraints, and expected output for this workspace.',
        title: 'Frame the task',
      },
      {
        description:
          'Link the task to the files, branch, and follow-up checks that matter.',
        title: 'Attach context',
      },
      {
        description:
          'Decide whether the next move is coding, reviewing, or asking for input.',
        title: 'Pick the next move',
      },
    ],
    Editor: [
      {
        description:
          'Jump straight to touched files instead of browsing the whole repo.',
        title: 'Open the target file',
      },
      {
        description:
          'Inspect the exact block that changed and keep the rest out of the way.',
        title: 'Inspect the diff context',
      },
      {
        description:
          'Save only the minimum edit that keeps this workspace coherent.',
        title: 'Make the focused edit',
      },
    ],
    Git: [
      {
        description:
          'Review changed files in the order that best rebuilds confidence.',
        title: 'Scan the change set',
      },
      {
        description:
          'Open the file or diff view that explains what the agent just touched.',
        title: 'Jump to the risky file',
      },
      {
        description:
          'Decide whether the workspace is ready for commit, not just visually complete.',
        title: 'Trust or reject the work',
      },
    ],
    Preview: [
      {
        description:
          'Load the local target that proves whether the change is actually working.',
        title: 'Open a local surface',
      },
      {
        description:
          'Re-run the exact page or route that matters for this workspace.',
        title: 'Validate the critical path',
      },
      {
        description:
          'Keep preview limited to local runtime surfaces instead of generic browsing.',
        title: 'Stay scoped',
      },
    ],
  }

  return (
    actionsByPaneType[pane.type] ?? [
      {
        description:
          'Use this workspace surface for the next most relevant action.',
        title: 'Keep the view focused',
      },
      {
        description:
          'Move only when the current pane no longer answers the task at hand.',
        title: 'Stay in context',
      },
      {
        description:
          'Let navigation express where you are rather than where you might go later.',
        title: 'Preserve orientation',
      },
    ]
  )
}
