# HeroUI Selective Adoption Plan

## Goal

Adopt the parts of HeroUI v3 that improve the shell's visual quality, interaction polish, and accessibility without replacing the custom navigation architecture that makes this product distinct.

This is a selective adoption plan, not a full design system migration.

## Decision Summary

- Use HeroUI v3, not v2.
- Keep the shell layout, navigation model, and workspace/pane semantics custom.
- Keep some shadcn components where they are simple and already good enough.
- Replace the highest-value primitives first: surfaces, controls, overlays, and list navigation.
- Do not introduce HeroUI tabs or drawer as primary shell structure.

## Why HeroUI v3

HeroUI v3 is a better fit for this repo because it already matches the current technical direction:

- React 19
- Tailwind CSS v4
- CSS-variable theming
- CSS-first animation
- React Aria accessibility model

It also offers stronger default visual polish than the current shadcn subset, especially for:

- surface hierarchy
- badges and chips
- toolbar-like grouped controls
- list and menu interactions
- overlay styling
- loading and scroll affordances

HeroUI v2 is not recommended for this repo because it would add migration churn without any real long-term advantage.

## Current UI Baseline

The repo currently uses:

- custom shell geometry for project rail, pane strip, and workspace content
- light use of shadcn wrappers in `src/renderer/src/components/ui/`
- direct custom styling in `src/renderer/src/styles.css`

The currently important shadcn-backed primitives are:

- `Button`
- `Badge`
- `Input`
- `Tooltip`

There is also a larger shadcn/Radix layer already present but not central to the shell's current feel:

- `Select`
- `Sheet`
- `ScrollArea`
- `Tabs`
- `Sidebar`
- `Skeleton`

## What Stays Custom

These should remain custom and repo-owned:

- project rail behavior
- workspace and pane navigation model
- top-level shell geometry
- pane strip behavior
- workspace switching overlay behavior
- keyboard semantics for pane and workspace movement

We should borrow HeroUI primitives, not surrender the product structure to HeroUI.

## What We Should Pull From HeroUI

### High-value fits

- `Surface`
- `Button`
- `Badge` and `Chip`
- `Kbd`
- `Toolbar`
- `ListBox`
- `Popover`
- `Dropdown`
- `Tooltip`
- `ScrollShadow`
- `TextField`, `Input`, `Select`
- `Skeleton`

### Likely not worth using for the core shell

- `Tabs` for primary navigation
- `Drawer` for the desktop shell
- `Card` as the core pane primitive

`Card` may still be useful inside panes for nested views, but the pane itself should remain a full-region shell-owned surface.

## Adoption Principles

1. Preserve navigation-first product identity.
2. Replace primitives before replacing structures.
3. Align tokens before broad component swaps.
4. Move one visual family at a time.
5. Keep the app buildable throughout the transition.
6. Avoid a half-migrated look where HeroUI and shadcn fight each other.

## Design Token Plan

Before major component replacement, align the shell theme with HeroUI's surface model.

### Current token shape

The repo currently centers on tokens like:

- `--background`
- `--card`
- `--popover`
- `--primary`
- `--secondary`
- `--sidebar`

### Desired token shape

HeroUI works best when the shell also has explicit surface tiers and field styling:

- `--surface`
- `--surface-secondary`
- `--surface-tertiary`
- `--field-*`
- semantic accent/foreground pairings

### Recommendation

Do a token alignment pass first, but keep the current visual mood:

- dark shell
- teal primary accent
- muted borders
- soft layered surfaces

This should be a shell theme pass, not a visual redesign.

## Phased Rollout

### Phase 0 - Theme and primitive spike

Goal: prove that HeroUI can coexist with the current shell without damaging the navigation model.

Scope:

- add HeroUI v3 dependencies and CSS imports
- align shell tokens to HeroUI-friendly surface semantics
- replace only one or two primitives in a contained surface

Candidate targets:

- `Badge`
- `Button`

Acceptance criteria:

- app still builds and runs cleanly
- shell geometry is unchanged
- new primitives feel visually better, not merely different
- no major token or CSS conflicts

### Phase 1 - Low-risk shell primitives

Goal: improve polish without touching shell structure.

Replace:

- `Button`
- `Badge`
- `Tooltip`
- `Skeleton`
- `Kbd`

Likely impact areas:

- pane indicators
- branch pills
- switcher hint chips
- toolbar actions
- loading placeholders

Acceptance criteria:

- visual consistency improves
- no change to navigation semantics
- keyboard and focus states remain explicit and visible

### Phase 2 - Top bar and overlay primitives

Goal: upgrade interaction-heavy navigation surfaces.

Replace or rebuild with HeroUI:

- top strip grouped controls using `Toolbar`
- workspace switcher overlay using `ListBox`
- pane and project action menus using `Popover` or `Dropdown`

Do not replace:

- shell geometry
- project rail ownership
- pane switching logic

Acceptance criteria:

- top bar looks tighter and more premium
- switcher overlay gains better keyboard and focus semantics
- menus and popovers stop feeling hand-rolled

### Phase 3 - Form and setup flows

Goal: improve CRUD and settings surfaces.

Replace:

- `Input` with HeroUI `TextField` + `Input`
- `Select` with HeroUI `Select`
- supporting field descriptions and errors with `Description`, `FieldError`, and `Label`

Likely areas:

- project creation
- workspace creation
- provider configuration
- settings panels

Acceptance criteria:

- forms feel cleaner and more intentional
- validation and accessibility improve
- field-on-surface styling becomes consistent

### Phase 4 - Scroll and nested surfaces

Goal: improve affordance in complex workspace views.

Adopt:

- `ScrollShadow`
- `Surface`
- selective `Card` use inside panes where nested blocks make sense

Likely areas:

- horizontal pane strip affordance
- side panels inside panes
- feed/list views
- logs or task history views

Acceptance criteria:

- scrollable regions advertise themselves elegantly
- nested views gain stronger depth hierarchy
- pane remains the full-region wrapper; nested views become structured surfaces inside it

### Phase 5 - Cleanup and reduction

Goal: remove leftover duplication once HeroUI is proven.

Actions:

- remove shadcn wrappers that no longer provide value
- trim Radix-only dependencies no longer used
- keep only the custom shell components plus the UI primitives we still want

Acceptance criteria:

- fewer parallel abstractions
- cleaner dependency graph
- less custom CSS spent recreating existing HeroUI behavior

## Recommended Component Mapping

### Replace soon

- `src/renderer/src/components/ui/button.tsx` -> HeroUI `Button`
- `src/renderer/src/components/ui/badge.tsx` -> HeroUI `Badge` or `Chip`
- `src/renderer/src/components/ui/tooltip.tsx` -> HeroUI `Tooltip`
- `src/renderer/src/components/ui/input.tsx` -> HeroUI `TextField` + `Input`

### Replace after the first primitive pass succeeds

- `src/renderer/src/components/ui/select.tsx` -> HeroUI `Select`
- custom workspace switcher rows -> HeroUI `ListBox`
- top pane control strip -> HeroUI `Toolbar`

### Keep custom for now

- `src/renderer/src/components/AppShell.tsx`
- `src/renderer/src/components/AppSidebar.tsx`
- `src/renderer/src/components/WorkspaceCanvas.tsx`
- pane motion and selection logic in `src/renderer/src/App.tsx`

## Risks

### CSS conflict risk

HeroUI and existing shadcn styles may compete if we import too much too quickly.

Mitigation:

- start with low-risk primitives
- avoid full replacement in one pass
- keep visual comparisons narrow and deliberate

### Over-library risk

The shell could drift toward generic component-library aesthetics.

Mitigation:

- keep layout custom
- keep navigation semantics custom
- use HeroUI for polish, not page structure

### Token mismatch risk

If tokens are not aligned first, HeroUI components will look foreign.

Mitigation:

- do a surface/token pass before broader adoption

### Scope creep risk

Trying to replace everything at once will slow the real product work.

Mitigation:

- work in beads
- stop after each visual family and evaluate

## Recommended Bead Breakdown

1. `Design system spike: HeroUI token and import pilot`
2. `Replace shell buttons and badges with HeroUI`
3. `Replace shell tooltips and keyboard hint styling`
4. `Adopt HeroUI toolbar for pane indicator strip`
5. `Rebuild workspace switcher overlay with HeroUI listbox`
6. `Adopt HeroUI select/textfield for creation flows`
7. `Add HeroUI scroll shadows and nested surface hierarchy`
8. `Remove obsolete shadcn wrappers and unused dependencies`

## Success Criteria

- the shell still feels custom and navigation-first
- the visual quality clearly improves
- the top bar, overlay, and small controls feel more premium
- pane and workspace navigation semantics remain untouched
- the codebase ends up with fewer duplicate abstractions, not more

## Recommendation

Start with a small, deliberate hybrid migration:

1. HeroUI token/surface pilot
2. `Button` + `Badge/Chip` + `Tooltip`
3. `Toolbar` + `ListBox`

If that pass looks and feels better, continue. If it makes the shell feel generic, stop and keep HeroUI limited to overlays and form surfaces.
