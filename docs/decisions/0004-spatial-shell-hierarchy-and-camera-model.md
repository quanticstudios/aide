# ADR 0004: Spatial Shell Hierarchy and Camera Model

- Status: Accepted
- Date: 2026-04-06
- Sources: `docs/01-product-decisions.md`, `docs/prd/spatial-navigation-canvas.md`, `docs/decisions/0002-workspace-pane-and-window-model.md`

## Context

The shell has drifted because the implementation started treating top-level pane navigation and split layout as the same structure.

That causes three recurring failures:

- split children appear in top-level pane navigation
- adding a pane mutates the current layout instead of creating a new destination
- adjacent workspaces or pane destinations can bleed into the viewport during transitions

The product does not need a Figma-style freeform canvas. It does need static destinations that stay in place while the camera moves to them.

## Decision

The shell model is:

```text
Project
  Workspace
    Pane
      View
```

Definitions:

- `Project`
  - tracked repository and grouping container
  - owns project-level metadata and remembers the last active workspace
- `Workspace`
  - one concrete working context inside a project
  - in practice this is one git worktree-backed context
  - owns its own pane track, runtime state, and remembered active pane
- `Pane`
  - top-level navigable destination inside a workspace
  - selected pane owns the full visible main region for that workspace
  - panes are static destinations on a horizontal track
- `View`
  - content instance rendered inside a pane
  - split layout operates on views inside the active pane, not on panes

The shell uses a camera-over-static-tracks model:

- workspaces are a vertical track
- panes are a horizontal track inside the active workspace
- the camera moves across those tracks
- destinations remain structurally stable while the camera moves

This is not a freeform 2D canvas. It is also not a tab strip that swaps selected content in place.

## Navigation rules

- `Alt + Left/Right` moves between panes only
- `Alt + Up/Down` moves between workspaces only
- project switching restores the remembered workspace and pane path for that project
- top-bar pane pills represent panes only
- split children must never appear in the pane strip or pane navigation order

## Layout rules

- creating a pane creates a new top-level pane destination
- splitting a pane creates or rearranges views inside that pane
- closing or resizing split content only affects views inside the active pane
- pane addition must not collapse an existing pane into a visible sibling strip

## Rendering rules

- the active workspace owns the viewport on the vertical axis
- the active pane owns the viewport on the horizontal axis
- non-active siblings may exist off-screen for directional animation
- non-active siblings must not remain visibly cut into the resting viewport

## Naming rule

User-facing product term:

- `Pane`

Allowed internal implementation term when disambiguation is necessary:

- `WorkspaceSurface`

If both terms exist in code, `WorkspaceSurface` must mean the same structural level as the user-facing `Pane`, not a second navigation layer.

## Consequences

- The top-level pane list must be independent from any split-tree leaf list.
- Split layout state should be stored beneath a pane, not used as the pane track itself.
- Future shell work should prefer “camera moves over static pane destinations” over “selected item swaps content in place”.
- If implementation requires another structural level, it must preserve the locked hierarchy above instead of redefining pane semantics ad hoc.
