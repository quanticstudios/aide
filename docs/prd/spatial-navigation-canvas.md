# Spatial Navigation Canvas

## Problem Statement

The shell currently behaves like a selection-driven React app instead of a spatial workspace shell. Pane and workspace changes can snap back to defaults, keyboard navigation behaves differently between browser and Electron, and terminal lifetime is tied too closely to visible component lifecycle. This makes the product feel unreliable at exactly the moment where it should feel most distinctive.

The navigation model needs to work like a persistent camera over a spatial canvas:

- panes move horizontally
- workspaces move vertically
- project switches restore remembered position instead of resetting state
- switching away from a pane must not destroy the runtime service behind it unless the user explicitly closes it

Until this is true, the shell does not validate its core product claim.

## Solution

Introduce a spatial navigation model that treats project, workspace, and pane position as durable runtime state rather than as transient UI selection. The shell should resolve the full navigation path once at boot, then move through that path explicitly with deterministic state transitions and directional animation.

The selected workspace still owns the full main region. Inside that workspace, the selected pane owns the full visible pane region. The shell should render movement as a camera transition across a conceptual grid:

- horizontal axis: pane changes within a workspace
- vertical axis: workspace changes within a project
- project axis: project switch restores that project's last active workspace and pane without resetting to index 0 first

This PRD does not require a full split-tree implementation immediately. It defines the spatial model the current placeholder shell must satisfy now, and that the future split-tree layout must preserve later.

## User Stories

1. As a developer, I want pane changes to feel like moving left and right across a workspace canvas, so that pane navigation feels spatial instead of tab-like.
2. As a developer, I want workspace changes to feel like moving up and down, so that workspaces feel like a second navigation axis rather than another row of tabs.
3. As a developer, I want project switches to restore my last active workspace and pane in that project, so that switching contexts does not reset me to a default view.
4. As a developer, I want the shell to resolve directly to my remembered navigation state on boot, so that I do not see resets and snap-backs before the correct target appears.
5. As a developer, I want pane 4, pane 5, and every other pane target to be reachable by click and keyboard in Electron as reliably as in the browser, so that desktop behavior is trustworthy.
6. As a developer, I want workspace switching to work inside terminal focus, so that keyboard-heavy navigation remains available while I am actively using the terminal.
7. As a developer, I want terminal sessions to survive switching away from the terminal pane, so that I can jump back to a running session without losing state.
8. As a developer, I want terminal sessions to survive switching away from a workspace and back again, so that workspace movement does not destroy active runtime work.
9. As a developer, I want the shell to remember the last active pane per workspace, so that revisiting a workspace restores the correct focus target.
10. As a developer, I want the shell to remember the last active workspace per project, so that project changes return me to the right workspace.
11. As a developer, I want project jump hints and workspace switch overlays to affect the same navigation state as clicks and shortcuts, so that every entry path stays in sync.
12. As a developer, I want browser and Electron behavior to match for navigation semantics, so that the desktop shell does not introduce a second behavior model.
13. As a developer, I want invalid remembered state to repair deterministically, so that the shell never falls into a broken or ambiguous target.
14. As a developer, I want directional movement to animate from the correct origin, so that left/right and up/down feel intentional and legible.
15. As a developer, I want the spatial navigation model to work before the full split-tree layout lands, so that the product promise is validated early.

## Navigation and Interaction Model

### Structural model

- `Project` groups workspaces and remembers `lastActiveWorkspaceId`.
- `Workspace` is the top-level runtime object and remembers `lastActivePaneId`.
- `Pane` is the visible tool surface within a workspace.
- The shell camera resolves a full path: `project -> workspace -> pane`.

### Spatial axes

- Pane movement is horizontal.
- Workspace movement is vertical.
- Project movement is a context switch that restores the project's remembered workspace and pane rather than resetting to the first workspace or first pane.

### First-render rule

On boot, the shell must:

1. load projects and workspaces
2. load persisted app/project/workspace selection state
3. resolve the full valid path once
4. render directly to that path
5. enable animated transitions only after initial resolution is complete

This avoids the current reset-then-snap behavior.

### Navigation rules

- `Alt + Left/Right` changes pane within the current workspace.
- `Alt + Up/Down` changes workspace within the current project.
- `Alt + h/l` mirrors pane movement.
- `Alt + j/k` mirrors workspace movement.
- `Ctrl + digit` jumps project.
- Project jump restores remembered workspace and pane for that project.
- All interaction paths update the same navigation state model:
  - pane strip click
  - workspace switcher overlay
  - project rail click
  - project jump hints
  - keyboard shortcuts

### Focus behavior

- Focused pane is always unambiguous.
- Terminal focus must not swallow shell navigation shortcuts.
- Overlay visibility must respond to modifier key state without becoming the source of truth for navigation state.

### Repair rules

- If a remembered project is missing, choose the first valid project.
- If a remembered workspace is missing for a valid project, choose that project's first valid workspace.
- If a remembered pane is missing for a valid workspace, choose that workspace's first valid pane.
- Repair happens once per invalid transition, not continuously during normal interaction.

## Implementation Decisions

- Replace ad hoc selection derivation with a dedicated navigation state model.
- Treat `project -> workspace -> pane` as a resolved navigation chain rather than three independent pieces of state.
- Separate boot-time resolution from runtime interaction updates.
- Keep renderer shortcut handling as the canonical fallback path; Electron-specific hooks must not change semantics.
- Introduce a camera-style workspace track separate from the pane track so horizontal and vertical motion are independent.
- Persist `lastActiveWorkspaceId` per project and `lastActivePaneId` per workspace in durable storage.
- Treat PTY sessions as workspace/pane-owned runtime services that live independently of renderer visibility.
- Reattach terminal views to existing PTY sessions when revisiting a workspace or pane instead of respawning them.
- Do not attempt to solve multi-window behavior here beyond preserving the existing one-workspace-one-window rule.
- Keep the current placeholder pane model only as a temporary visual representation; the navigation state model must already match future split-tree semantics.

## Testing Decisions

- Add focused unit tests for:
  - resolved boot path selection
  - project/workspace/pane repair rules
  - directional movement math
  - remembered pane/workspace restoration
  - native shortcut mapping
- Add integration-style renderer tests for:
  - pane switching by click and keyboard
  - workspace switching by click and keyboard
  - project jump restoring remembered workspace and pane
  - active pane restoration after workspace switch
  - active workspace restoration after project switch
- Add Electron-aware E2E coverage using Playwright for critical navigation flows because the current bugs reproduce only in the desktop app:
  - pane 4/5 reachability in Electron
  - workspace switching from terminal focus
  - project jump from `Ctrl + digit`
  - no snap-back to index 0 on boot or context switch
  - terminal reattachment after leaving and returning
- Keep the normal quality gates:
  - `bun test`
  - `bun run build`
  - `bunx @biomejs/biome check .`
  - `npx -y react-doctor@latest .`

## Out of Scope

- full split-tree editor/terminal/git layout authoring UI
- pane-local tab stacks
- multi-window canvas synchronization
- notification center work
- provider workflow changes unrelated to navigation state
- deep terminal features beyond lifetime and reattachment
- visual redesign unrelated to spatial navigation clarity

## Further Notes

- This work is allowed to refactor the current shell state model aggressively because the current behavior is not trustworthy enough to serve as a base.
- The browser path is a useful baseline, but Electron behavior is the acceptance bar.
- The shell should feel like a spatial operating surface, not like a React app with selection widgets.
