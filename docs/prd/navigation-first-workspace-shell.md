# Navigation-First Workspace Shell

## Problem Statement

The current prototype proves a few technical spikes, but it does not yet prove the product's core claim: that supervising AI coding work across projects and workspaces feels faster and less fragmented than juggling separate windows, tabs, terminals, and editors.

The shell needs to make navigation the product, not a thin wrapper around panes. Users should be able to see where they are, switch projects and workspaces quickly, and trust that the active workspace owns the main view. Pane sophistication can come later. The early shell should avoid debug surfaces, bottom junk, and competing layout regions that dilute the navigation model.

## Solution

Build the first real app shell around projects, workspaces, and navigation. The shell should always present a visible sidebar rail, a stable top-level workspace selection model, and a single main content region that fills the remaining window. The selected workspace owns that main region. The shell should support quick project and workspace changes through the sidebar first, then keyboard shortcuts and overview behavior as the next layer.

The initial shell should feel like a structural map of work rather than a pane demo. It should restore prior state, clearly indicate the current project and workspace, and treat full-window content ownership as the default. Placeholder content is acceptable in the main region, but only if it reinforces the selected workspace instead of competing with navigation.

## User Stories

1. As a developer supervising several efforts, I want projects grouped separately from workspaces, so that I can keep repository-level context distinct from active work.
2. As a developer, I want the workspace to be the thing I open and switch, so that the product matches how I actually work.
3. As a developer, I want the selected workspace to own the main content area, so that I never wonder what the app is currently showing me.
4. As a developer, I want the shell to use the full available window cleanly, so that no wasted debug or placeholder sections compete for attention.
5. As a developer, I want a sidebar rail that is always present, so that I always have a structural map of projects and workspaces.
6. As a developer, I want the sidebar to expand on hover and pin open, so that I can browse deeply without losing screen space by default.
7. As a developer, I want the current project and workspace to be visually obvious, so that switching never leaves me disoriented.
8. As a developer, I want to create a new project from the shell, so that I can start tracking work without database edits or manual setup.
9. As a developer, I want to create a new workspace from the active project, so that I can branch work quickly.
10. As a developer, I want workspace switching to update both the sidebar and main area together, so that navigation feels atomic and trustworthy.
11. As a developer, I want app relaunch to restore my known projects and workspaces, so that the shell preserves continuity between sessions.
12. As a developer, I want the last active project and workspace restored by default, so that relaunch puts me back in context.
13. As a keyboard-heavy user, I want dedicated workspace-switch shortcuts, so that I can move between parallel work quickly.
14. As a keyboard-heavy user, I want project switching to use a different mechanism than pane movement, so that navigation stays learnable.
15. As a keyboard-heavy user, I want project jump hints while holding Ctrl, so that I can jump directly to a project without hunting.
16. As a developer, I want an overview switcher later, so that larger project and workspace sets remain manageable.
17. As a developer, I want the shell to degrade cleanly when there are no projects or workspaces yet, so that the empty state is not confusing.
18. As a developer, I want failures in restore or selection state to surface without breaking the whole shell, so that navigation remains dependable.
19. As a developer, I want navigation behavior to be explicit before pane depth grows, so that the product validates its real differentiator early.
20. As a developer, I want pane implementation to stay secondary until navigation and workspace flow feel right, so that effort is spent on product identity first.

## Navigation and Interaction Model

### Structural model

- `Workspace` is the top-level runtime object.
- `Project` is grouping, metadata, and a source for creating workspaces.
- The selected workspace owns the main content region.
- The main content region should fill all remaining available window space.

### Shell layout

- A permanent sidebar rail is always visible.
- The sidebar is collapsed by default.
- Hover may expand it temporarily.
- Users can pin it open.
- The main content region consumes the rest of the window.
- The top bar may provide lightweight context and workspace switching affordances, but it must not compete with the main content region.
- No bottom diagnostics, runtime cards, storage cards, or debug panels belong in the primary shell.

### Navigation rules

- Left/right is reserved for pane navigation.
- Workspace switching uses dedicated controls and shortcuts.
- Project switching uses the sidebar, overview, and direct jump hints.
- The shell should support mouse and keyboard paths equally.

### Shortcut expectations

- `Alt + Up/Down`: previous or next workspace in the current project.
- `Ctrl` hold: reveal numeric project hints in the sidebar.
- `Ctrl + digit`: jump directly to a visible project.
- `Cmd/Ctrl + Tab`: open the overview switcher in the later navigation phase.
- Shortcut handling should live behind a reusable keyboard layer so bindings can evolve without scattering listeners.

### Selection behavior

- Selecting a project updates the visible workspace set.
- Selecting a workspace updates the main content region immediately.
- Creating a project or workspace should select the new object by default unless later UX testing proves otherwise.
- On boot, restore the last active project and workspace when that state is valid.

### Empty and failure states

- If no project exists, show a clear create-project path.
- If a project exists but no workspace exists, show a clear create-workspace path.
- If restore state is invalid, fall back to a safe default selection instead of crashing or rendering an ambiguous shell.

## Implementation Decisions

- Build the navigation shell before investing in deeper pane work.
- Keep workspace selection state as a shared, explicit domain concept.
- Persist projects, workspaces, and selection state using the existing SQLite-backed storage path.
- Favor a single navigation state model that drives sidebar, top bar, and main content selection together.
- Keep the shell full-window and single-purpose: navigation structure plus one active workspace content region.
- Introduce keyboard handling through a thin abstraction that can wrap native listeners or a library such as TanStack Hotkeys without binding the whole app directly to implementation details.
- Keep pane placeholders minimal; they should support shell development but not dominate the UX.
- Defer overview richness and pane-local tab stacks until the shell already feels spatial and learnable.
- Treat hover-expand as convenience only; every sidebar action must also remain keyboard-accessible.
- Preserve the one-workspace-one-window rule in state even before detached windows ship.

## Testing Decisions

- Test shell behavior through public UI boundaries and shared selection interfaces, not internal component state.
- Prioritize integration-style tests for:
  - project and workspace restore on boot
  - project selection updating workspace lists
  - workspace selection updating the main content region
  - empty-state flows for missing projects and missing workspaces
  - keyboard-driven workspace and project switching
  - sidebar collapsed, hover, and pinned-open state behavior
- Add focused unit tests only where pure domain logic benefits, such as selection fallback rules, summary derivation, and keyboard mapping decisions.
- Use the current runtime checks as part of the definition of done:
  - `bun test`
  - `bun run build`
  - `bunx @biomejs/biome check .`
  - `npx -y react-doctor@latest .`
- Prefer deleting shallow UI tests if a stronger boundary test covers the same behavior.

## Out of Scope

- Rich pane implementations beyond what is required to anchor the shell
- advanced editor behavior
- pane-local tab stacks
- detached multi-window behavior
- command palette depth
- notification center depth
- multi-provider integration
- visual flourish that competes with navigation clarity
- bottom debug surfaces or developer-only status cards in the product shell

## Further Notes

- This PRD is intentionally biased toward navigation as the product moat.
- The shell should answer the question: "Can I jump between active workspaces without losing the plot?"
- If the answer is still no after this work, deeper pane investment should pause until navigation is corrected.
