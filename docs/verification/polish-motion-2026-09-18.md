# Desktop motion review, 2026-09-18

Scope: sidebar, fleet drawer, workspace navigation, settings, and chat turn motion.
Review follows `kowalski-review-animations` and the user's Material Shell navigation requirements.

| Before                                              | After                                                                                  | Why                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sidebar hover expansion and a collapsed rail        | A header toggle controls a zero-width closed sidebar; its panel slides left over 200ms | The closed sidebar leaves no rail. Opening it moves workspace content.          |
| Independent sidebar visibility changes              | Width and panel transform share `cubic-bezier(0.23, 1, 0.32, 1)` and 200ms             | CSS transitions retarget from the current position when interrupted.            |
| Fleet drawer focus can scroll its translated parent | Focus uses `preventScroll`; the mounted drawer translates from the right inside a clipped, expanding column over 240ms    | The drawer keeps its right-hand origin and reduces the workspace width without overlap.              |
| Broad pane navigation transitions                   | Pane movement uses transform over 200ms; position dots keep fixed dimensions           | Movement preserves the spatial relationship between workspaces and panes.       |
| Press feedback writes the transform property        | Press feedback uses individual `scale`                                                 | Press feedback does not overwrite a control's positioning transform.            |
| Conversation history receives entrance motion       | Only running turns receive the turn animation class                                    | Returning to a pane does not replay every completed turn.                       |
| Motion depends on scattered component rules         | Saved System, On, and Reduced preferences control `data-motion`                        | Reduced mode removes movement while retaining brief color and opacity feedback. |

## Verdict

Approve the reviewed controls, with two explicit product requirements:

- Keyboard workspace and pane changes retain sliding motion, as requested by the user.
- Sidebar and drawer widths animate because opening must move the workspace content. A transform-only overlay would not satisfy this behavior. Reduced mode disables their 200ms and 240ms transitions. This is not a claim of frame-rate performance under arbitrary workloads.

Implementation anchors: `src/renderer/src/components/AppShell.tsx`, `SidebarTree.css`, `FleetDrawer.tsx`, `WorkspaceCanvas.tsx`, `ManagedAgentPane.tsx`, and `src/renderer/src/styles.css`.

## Verification

- 632 unit tests passed across 96 files.
- 43 Electron scenarios passed across the complete run and a targeted rerun on an isolated virtual display, including interrupted workspace navigation, pane restoration, composer focus, the right drawer, settings preferences, queued attachments, and terminal exits.
- Ctrl+B opens and closes the left sidebar and restores visible focus. The command palette exposes both sidebar toggles and pane close/resize actions.
- Desktop and narrow settings, provider menus, removable recipient tags, and sidebar screenshots were visually inspected.
- Production minification keeps initial renderer assets at 549.84 kB JavaScript and 445.17 kB CSS. Both configured size limits pass.
- Type checking and Biome pass. Biome reports existing advisory warnings. React Doctor reports 232 advisory findings; their triage is tracked in `aide-2p2`.

Provider responses in the Electron suite use test adapters. These checks do not establish live model quality or production readiness for every feature.

## Provider limits

Codex follow-ups use native steering after Jev preparation. Native Claude follow-ups require result-to-message mapping and are tracked in `aide-0t8`. Provider menus display discovered reasoning levels and Codex service tiers. Claude context variants remain selectable through advertised model IDs; a separate context control is tracked in `aide-rwt`.

## Review ownership

The `motion_audit` agent reviewed sidebar focus, drawer sizing, pane closure, and terminal focus. The `settings_page` agent implemented sidebar, settings, mention, and Jev controls. The `skills_discovery` agent implemented provider selection and Codex follow-ups. The orchestrator integrated their patches and ran the combined desktop checks.
