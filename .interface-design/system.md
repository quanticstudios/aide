# aide Design System — Warm Station

## Direction

Mission control density and purposefulness with warm charcoal surfaces. Color earned by status, not spent on decoration. Dense but comfortable — Raycast/Warp warmth, not NASA clinical.

**Intent:** Any developer, orienting across projects and workspaces. The interface communicates confidence through structure and restraint.

## Layout: Material Shell Paradigm

```
┌──────────────────────────────────────────────────────┐
│ Rail │  [Workspace tabs]                bearing strip │  36px
│      ├───────────────────────────────────────────────┤
│  P1  │                                                │
│  P2  │            Content area                       │
│  P3  │       (split pane tree — future)              │
│      │                                                │
└──────┴───────────────────────────────────────────────┘
  48px                    flex
```

- **Sidebar rail:** 48px collapsed (project initials), 240px expanded on hover, pinnable
- **Top bar:** workspace tabs for active project, bearing strip (project/branch) on right
- **Content area:** flexible, scrollable, will host split pane tree in Phase 2
- Rail and content share the same background — border separation, not color separation

## Depth Strategy

**Shadows + glass.** Layered shadows for depth (Linear-style), backdrop-filter blur on expanded sidebar for glass effect. Borders at low opacity define structure. Active states use teal left border (`inset 2px 0 0 var(--primary)`) and tinted backgrounds. Higher elevation = shadow + slightly lighter surface.

## Surfaces

| Token | Value | Use |
|-------|-------|-----|
| `--surface-base` | `#18181b` | Deepest — body, rail, topbar |
| `--surface-raised` | `#232328` | Cards, panels, toolbars |
| `--surface-inset` | `#141416` | Inputs, recessed areas, editor bg |
| `--surface-overlay` | `#2a2a30` | Dropdowns, hover states |

Same warm charcoal hue family. Lightness shifts only — never different hues for different surfaces.

## Text

| Token | Value | Use |
|-------|-------|-----|
| `--ink-primary` | `#e8e4df` | Default text, headings |
| `--ink-secondary` | `#9b9792` | Supporting text, descriptions |
| `--ink-muted` | `#6b6661` | Metadata, labels, inactive |
| `--ink-faint` | `#4a4743` | Disabled, placeholder, separators |

Warm whites and grays. Not blue-tinted.

## Borders

| Token | Value | Use |
|-------|-------|-----|
| `--edge` | `rgba(255, 250, 240, 0.08)` | Standard separation |
| `--edge-strong` | `rgba(255, 250, 240, 0.14)` | Emphasis, hover borders |
| `--edge-focus` | `rgba(92, 184, 154, 0.5)` | Focus rings |

Warm tone. Low opacity blends with background.

## Status Signals

| Token | Value | Meaning |
|-------|-------|---------|
| `--signal-ready` | `#5cb89a` | Healthy, active, connected |
| `--signal-pending` | `#d4a053` | Loading, waiting, in-progress |
| `--signal-fault` | `#d4645c` | Error, failed, disconnected |

Color is reserved for status. No decorative color anywhere.

## Spacing

8px base unit. Scale: `4 / 8 / 12 / 16 / 24 / 32 / 48`

Tokens: `--space-1` through `--space-12`

## Border Radius

| Token | Value | Use |
|-------|-------|-----|
| `--radius-sm` | `4px` | Buttons, inputs, badges |
| `--radius-md` | `6px` | List items, small cards |
| `--radius-lg` | `8px` | Panels, editor frame |

Technical, not playful. No pill shapes (no 999px).

## Typography

- **UI:** `"IBM Plex Sans"` — clean with personality, not generic
- **Data/code:** `"IBM Plex Mono"` — paths, values, code, branches
- **Headings:** 13px, weight 600
- **Labels/eyebrows:** 10px, weight 600, uppercase, letter-spacing 0.06-0.08em
- **Body:** 13px, weight 400
- **Small data:** 11-12px

Two typographic voices: the instrument (mono) and the label on the instrument (sans).

## Component Patterns

### Status Badge
Dot indicator (6px circle) + label text. Color from `--signal-*` tokens. Border from `--edge`. Classes: `.status-badge`, `.status-badge-ready`, `.status-badge-error`, `.status-badge-loading`, `.status-badge-idle`.

### Panel
`--surface-raised` background, `--edge` border, `--radius-lg` corners, `--space-4` padding. Headings at 13px/600. Description lists for key-value data.

### Sidebar Rail Project Item
Initial badge (28px square, `--radius-sm`, `--surface-raised` bg) + name + branch. Active state: `--surface-raised` bg, left border accent in `--signal-ready`.

### Top Bar Tab
Text button, 12px/500, `--ink-muted` default, `--ink-primary` + `--signal-ready` bottom border when active. No background change on active — bottom border is the indicator.

### Buttons
`--surface-raised` bg, `--edge` border, `--radius-sm`, `--ink-primary` text, 12px/500. Hover: `--surface-overlay` + `--edge-strong`. Active: `--surface-inset`. Focus: 2px `--edge-focus` outline.

## Principles

1. Color is status. If something has color, it means something.
2. Same background for rail and content — border separation, not color fragmentation.
3. Borders whisper. If borders are the first thing you see, they're too strong.
4. Typography carries hierarchy — weight and case, not color or size alone.
5. Every token traces to the warm charcoal family. No stray hues.
