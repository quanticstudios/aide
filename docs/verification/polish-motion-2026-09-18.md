# Desktop motion review, 2026-09-18

Scope: sidebar, fleet drawer, workspace navigation, settings, and chat turn motion.
Review follows `kowalski-review-animations` and the user's Material Shell navigation requirements.

| Before                                              | After                                                                                  | Why                                                                             |
| --------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sidebar hover expansion and a collapsed rail        | A header toggle controls a zero-width closed sidebar; its panel slides left over 200ms | The closed sidebar leaves no rail. Opening it moves workspace content.          |
| Independent sidebar visibility changes              | Width and panel transform share `cubic-bezier(0.23, 1, 0.32, 1)` and 200ms             | CSS transitions retarget from the current position when interrupted.            |
| Fleet drawer focus can scroll its translated parent | Focus uses `preventScroll`; the mounted drawer translates from the right over 240ms    | The drawer keeps its right-hand origin during opening and closing.              |
| Broad pane navigation transitions                   | Pane movement uses transform over 200ms; position dots keep fixed dimensions           | Movement preserves the spatial relationship between workspaces and panes.       |
| Press feedback writes the transform property        | Press feedback uses individual `scale`                                                 | Press feedback does not overwrite a control's positioning transform.            |
| Conversation history receives entrance motion       | Only running turns receive the turn animation class                                    | Returning to a pane does not replay every completed turn.                       |
| Motion depends on scattered component rules         | Saved System, On, and Reduced preferences control `data-motion`                        | Reduced mode removes movement while retaining brief color and opacity feedback. |

## Verdict

Approve the reviewed controls, with two explicit product requirements:

- Keyboard workspace and pane changes retain sliding motion, as requested by the user.
- Sidebar width animates because opening must move the workspace content. A transform-only overlay would not satisfy this behavior. The 200ms transition is disabled in Reduced mode. This is not a claim of frame-rate performance under arbitrary workloads.

Implementation anchors: `src/renderer/src/components/AppShell.tsx`, `SidebarTree.css`, `FleetDrawer.tsx`, `WorkspaceCanvas.tsx`, `ManagedAgentPane.tsx`, and `src/renderer/src/styles.css`.

## Verification

- 626 unit tests passed across 96 files.
- 40 Electron scenarios passed on an isolated virtual display, including interrupted workspace navigation, pane restoration, composer focus, the right drawer, settings preferences, queued attachments, and terminal exits.
- Follow-up sidebar, branding, settings, and navigation checks passed after removing the collapsed rail.
- Desktop and narrow settings screenshots were visually inspected.

Provider responses in the Electron suite use test adapters. These checks do not establish live model quality or production readiness for every feature.
