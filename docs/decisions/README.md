# Decision Log

This folder captures the accepted scope and architecture constraints that should stay stable while implementation starts.

Status meanings:

- Accepted: active and expected to guide implementation
- Superseded: replaced by a newer decision
- Draft: still under discussion

## Accepted decisions

1. `0001-product-scope-and-non-goals.md` - product category, core surfaces, and explicit non-goals
2. `0002-workspace-pane-and-window-model.md` - workspace-first runtime model, pane rules, and window ownership constraints
3. `0003-implementation-baseline.md` - Electron, React, TypeScript, Bun, Vite, and Biome baseline
4. `0004-spatial-shell-hierarchy-and-camera-model.md` - locked `project -> workspace -> pane -> view` model and camera-over-static-tracks rule

## Update rule

If implementation forces a meaningful scope or architecture change, add a new decision file instead of silently editing the old assumptions across the repo.
