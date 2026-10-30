# aide design

This file describes the interface aide ships today. Every value comes from `src/renderer/src/styles.css` or from the component that uses it. If the two disagree, styles.css wins and this file is wrong.

`bun run test:design-tokens` fails when this file names a custom property that styles.css does not define, or when styles.css defines one this file never names. CI runs it. So when you add, rename or delete a token, update the matching table here in the same change.

## Screenshots

Captured from a development build at 1440x900 with the fake agent provider.

| | |
|---|---|
| ![Agent pane with the sidebar open](docs/design/screenshots/agent-pane.png) | ![The same view in the High contrast palette](docs/design/screenshots/agent-pane-high-contrast.png) |
| Agent pane, Dark palette | Agent pane, High contrast palette |
| ![Approval card above the composer](docs/design/screenshots/approval-card.png) | ![Git review pane](docs/design/screenshots/git-review.png) |
| Approval card | Git review pane |
| ![Command palette](docs/design/screenshots/command-palette.png) | ![Settings, Appearance section](docs/design/screenshots/settings-appearance.png) |
| Command palette (Ctrl+K) | Settings > Appearance |

## Themes

Settings > Appearance > Theme offers System, Light, Dark and High contrast, stored in `localStorage` under `aide.theme` (`src/renderer/src/lib/theme-preference.ts`). System is the default. It follows `prefers-color-scheme` and switches when the OS setting changes, with no reload.

The preference resolves to one of three palettes, written to `data-palette` on the root element:

- **Light** lives in `[data-palette="light"]`. Cool gray chrome around white panes, a surface ladder that steps darker inside them, and accents deepened until text in them passes AA. No cream.
- **Dark** lives in `[data-palette="dark"]` and overrides part of the base block. A cool near-black canvas with a lighter surface ladder, so panes read as raised without needing hairlines.
- **High contrast** is the base block (`:root, [data-palette="contrast"]`). A pure black canvas, almost flat surfaces, and solid hairlines doing the separating.

The root also gets `data-theme` and a `light` or `dark` class, which switch HeroUI's own variables. While the palette changes, `data-palette-switching` turns transitions off for one task, so every element repaints at once instead of fading at its own speed. Palette selectors carry no `:root`, so any element with `data-palette` repaints its subtree in that palette. The theme picker thumbnails use this.

Code that cannot read CSS variables subscribes instead: `useColorScheme()` gives the diff view `light` or `dark`, and `TerminalPane` re-reads its colors from the tokens on every palette change.

Two scripts guard the palettes, and CI runs both through `bun run test:design-tokens`:

- `scripts/check-color-literals.mjs` fails on a hex, `rgb()`, `hsl()`, `oklch()`, `white`/`black` keyword or Tailwind palette class (`bg-red-500`) anywhere in `src/renderer` outside styles.css. Inside styles.css, a literal may only appear in a custom property definition.
- `scripts/check-contrast.mjs` computes WCAG contrast for every text pair in every palette (text, status accents, syntax tokens and terminal colors on the surfaces they sit on) and fails below 4.5:1.

Settings > Appearance > Animations sets `data-motion` on the root element. `data-motion="reduced"` is covered under Motion.

## Color

Each table lists the Light value, the Dark value, the High contrast value, and what the token is for. A Light or Dark cell reading "same" means that palette does not override the base block.

### Canvas and text

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--background` | `#eceef2` | `#08090c` | `#07080a` | App canvas behind panes and the top bar. |
| `--foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Primary text and icons. |
| `--body` | `#2c3038` | `#c4c8ce` | `#cdcdcd` | Paragraph text in transcripts (`.prose p`, `.prose li`), keycap labels, idle composer tools. |
| `--body-muted` | `#2c3038` | `#c4c8ce` | `#cccccc` | Softer body text. Has a `text-body-muted` utility. Nothing reads it today. |
| `--charcoal` | `#2c3038` | `#c4c8ce` | `#d3d3d4` | Nothing reads it today. |
| `--muted-foreground` | `#596070` | `#8e939c` | `#9c9c9d` | Secondary text: labels, timestamps, eyebrows, inactive tabs, list markers. |
| `--ash` | `#6b7280` | `#8e939c` | `#6a6b6c` | Dim text. Also the dot for a stopped session. |
| `--stone` | `#a1a7b1` | `#5a606a` | `#434345` | Dimmest text. Also the dot for a session with no known state. |
| `--on-dark-mute` | `rgba(20, 22, 27, 0.72)` | same | `rgba(255, 255, 255, 0.72)` | Nothing reads it today. |

### Surfaces

Two ladders exist. The four-step ladder is what new components use. The named surfaces feed HeroUI and older components.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--surface-1` | `#f5f6f8` | `#14161b` | `#141416` | First step up from the canvas: resting buttons (`.btn-surface`), overview cards, code blocks, hover on rows and tabs. |
| `--surface-2` | `#eef0f3` | `#1c1f26` | `#1c1c1f` | Second step: the composer, active tabs and pills, hover on `.btn-icon` and `.row-hover`, inline code. |
| `--surface-3` | `#e4e7ec` | `#252932` | `#242427` | Third step: top of the keycap gradient. |
| `--surface-4` | `#d8dce3` | `#2f343e` | `#2c2c30` | Highest step. |
| `--surface` | `#ffffff` | `#14161b` | `#0d0d0d` | Pane body, and the inset blocks inside cards (approval command, diff box). |
| `--surface-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on `--surface`. |
| `--surface-secondary` | `#e2e5ea` | `#1c1f26` | `#101111` | Hover on sidebar rows and small icon buttons. Table headers in prose. |
| `--surface-secondary-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on `--surface-secondary`. |
| `--surface-tertiary` | `#d8dce3` | `#252932` | `#121212` | Hover on the sidebar project menu button. |
| `--surface-tertiary-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on `--surface-tertiary`. |
| `--card` | `#ffffff` | `#1c1f26` | `#0d0d0d` | Card background. Nothing reads it today. |
| `--card-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on cards. Nothing reads it today. |
| `--popover` | `#ffffff` | `#1c1f26` | `#0d0d0d` | Menus, popovers and dialogs (`.floating-surface`). |
| `--popover-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on popovers. |
| `--overlay` | `#ffffff` | `#1c1f26` | `#101111` | HeroUI overlay background. |
| `--overlay-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on overlays. |
| `--secondary` | `#eef0f3` | `#1c1f26` | `#101111` | HeroUI secondary button fill. |
| `--secondary-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on secondary buttons. Nothing reads it today. |
| `--muted` | `#eef0f3` | `#1c1f26` | `#101111` | HeroUI muted fill. |
| `--accent` | `#eef0f3` | `#1c1f26` | `#101111` | HeroUI accent fill. A neutral surface, despite the name. |
| `--accent-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on `--accent`. |
| `--accent-soft-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | HeroUI soft accent text. |

### Interactive color

Blue marks the one thing you can act on. Dark uses a single bright blue for fill, focus and links. High contrast uses a deeper fill blue and keeps the bright blue for links and the caret.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--primary` | `#0062cc` | `#2997ff` | `#0066cc` | Primary buttons, the send button, the active workspace tint (12% alpha), the composer focus ring, the global focus outline. |
| `--primary-foreground` | `#ffffff` | `#06121f` | `#ffffff` | Text and icons on `--primary`. |
| `--primary-focus` | `#0052ad` | `#2997ff` | `#0071e3` | Hover fill of `.btn-primary`, focus outline of `.cta-pill`. |
| `--primary-on-dark` | `#0062cc` | `#2997ff` | `#2997ff` | Links in transcripts, the text caret, active composer tools. |
| `--ring` | `#0071e3` | `#2997ff` | `#0071e3` | HeroUI and Tailwind focus rings. |
| `--focus` | `#0071e3` | `#2997ff` | `#0071e3` | HeroUI focus color. |

### State accents

These belong to session activity: state dots, workspace badges, approval and error cards. Chrome never uses them. Every accent has a `-soft` partner at 14 to 15% alpha for backgrounds behind the solid color.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--accent-blue` | `#0866c6` | same | `#57c1ff` | Running or connecting session (pulsing dot). |
| `--accent-blue-soft` | `rgba(8, 102, 198, 0.1)` | `rgba(87, 193, 255, 0.14)` | `rgba(87, 193, 255, 0.15)` | Background behind blue. |
| `--accent-green` | `#157a3a` | same | `#59d499` | Ready session, completed fleet tasks, finished workspace setup. |
| `--accent-green-soft` | `rgba(21, 122, 58, 0.1)` | `rgba(89, 212, 153, 0.14)` | `rgba(89, 212, 153, 0.15)` | Background behind green. |
| `--accent-yellow` | `#8a5d00` | same | `#ffc533` | Session waiting on you. Its 3% tint marks sidebar rows awaiting approval or input. |
| `--accent-yellow-soft` | `rgba(176, 120, 0, 0.12)` | `rgba(255, 197, 51, 0.14)` | `rgba(255, 197, 51, 0.15)` | Background behind yellow. |
| `--accent-red` | `#c8222c` | `#ff6b6b` | `#ff6161` | Errors, the danger ghost button. Its 3% tint marks a sidebar row in error. |
| `--accent-red-soft` | `rgba(200, 34, 44, 0.1)` | `rgba(255, 107, 107, 0.14)` | `rgba(255, 97, 97, 0.15)` | Error card background, danger ghost hover. |
| `--accent-purple` | `#7a45d6` | same | `#bd93ff` | A plan is ready to review. |
| `--accent-purple-soft` | `rgba(122, 69, 214, 0.1)` | same | `rgba(189, 147, 255, 0.15)` | Background of a plan-ready sidebar row and badge. |
| `--accent-peach` | `#b2490f` | same | `#ffb084` | Approval card border and icon. |
| `--accent-peach-soft` | `rgba(214, 101, 36, 0.12)` | same | `rgba(255, 176, 132, 0.14)` | Approval card background. |
| `--accent-ochre` | `#8a5d00` | same | `#e8b94a` | Meant for awaiting input. Nothing reads it today. Sidebar rows use `--accent-yellow`. |
| `--accent-ochre-soft` | `rgba(176, 120, 0, 0.12)` | same | `rgba(232, 185, 74, 0.14)` | Background behind ochre. Nothing reads it today. |
| `--destructive` | `#c8222c` | `#ff6b6b` | `#ff6161` | Error text and destructive menu items. |
| `--destructive-foreground` | `#ffffff` | same | `#000000` | Text on a destructive fill. Nothing reads it today. |
| `--brand-claude` | same | same | `#d97757` | Claude's mark keeps its brand orange. Every other provider mark is monochrome. |

### Lines

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--border` | `rgba(20, 22, 27, 0.1)` | `rgba(255, 255, 255, 0.07)` | `#242728` | Default 1px edge: inactive panes, cards, inputs, pane headers, table cells. |
| `--border-soft` | `rgba(20, 22, 27, 0.07)` | `rgba(255, 255, 255, 0.07)` | `rgba(255, 255, 255, 0.08)` | Quieter edge: inline code, code blocks. |
| `--border-strong` | `rgba(20, 22, 27, 0.2)` | `rgba(255, 255, 255, 0.14)` | `rgba(255, 255, 255, 0.16)` | The active pane's edge, hover edges on cards and surface buttons, the ring around floating surfaces. |
| `--input` | `rgba(20, 22, 27, 0.14)` | `rgba(255, 255, 255, 0.07)` | `#242728` | Input edge. Nothing reads it today. Fields use `--field-border`. |
| `--separator` | `rgba(20, 22, 27, 0.1)` | `rgba(255, 255, 255, 0.07)` | `#242728` | HeroUI separator. |

### Fields

HeroUI reads these for text inputs and selects.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--field-background` | `#ffffff` | `#1c1f26` | `#101111` | Field fill. |
| `--field-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Field text. |
| `--field-placeholder` | `#636a77` | `#8e939c` | `#9c9c9d` | Placeholder text. |
| `--field-border` | `rgba(20, 22, 27, 0.14)` | `rgba(255, 255, 255, 0.07)` | `#242728` | Field edge. |
| `--field-radius` | same | same | `0.5rem` | Field corner radius. |
| `--field-shadow` | same | same | `0 0 0 0 transparent inset` | No field shadow. |

### Sidebar

The sidebar paints itself with `--sidebar`, the surface ladder and `--primary`. Nothing reads the other sidebar tokens today.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--sidebar` | `#eceef2` | `#08090c` | `#07080a` | Sidebar fill. Same as the canvas. |
| `--sidebar-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Sidebar text. |
| `--sidebar-primary` | `#0062cc` | `#2997ff` | `#0066cc` | Sidebar primary color. |
| `--sidebar-primary-foreground` | `#ffffff` | `#06121f` | `#ffffff` | Text on `--sidebar-primary`. |
| `--sidebar-accent` | `#e2e5ea` | `#14161b` | `#0d0d0d` | Sidebar accent fill. |
| `--sidebar-accent-foreground` | `#14161b` | `#f2f3f5` | `#f4f4f6` | Text on `--sidebar-accent`. |
| `--sidebar-border` | `rgba(20, 22, 27, 0.1)` | `rgba(255, 255, 255, 0.07)` | `#242728` | Sidebar edge. |
| `--sidebar-ring` | `#0071e3` | `#2997ff` | `#0071e3` | Focus ring inside the sidebar. |

### Keycap gradient

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--key-bg-start` | `#ffffff` | `#2f343e` | `#121212` | Start of a keycap gradient. `.keycap` paints from `--surface-3` to `--surface-1` instead. Nothing reads it today. |
| `--key-bg-end` | `#eef0f3` | `#252932` | `#0d0d0d` | End of the same gradient. Nothing reads it today. |

### Syntax highlighting

Shiki's css-variables theme reads these at runtime (`src/renderer/src/lib/highlighter.ts`), so code blocks and diffs switch with the palette and nothing re-tokenizes. Dark and High contrast share GitHub's dark colors. Light uses GitHub's light colors, with a darker comment gray so comments pass AA on `--surface-1`.

| Token | Light | Dark and High contrast | Role |
|---|---|---|---|
| `--shiki-foreground` | same | `var(--foreground)` | Plain code text. |
| `--shiki-background` | same | `transparent` | The code block's own surface shows through. |
| `--shiki-token-comment` | `#5f6873` | `#8b949e` | Comments. |
| `--shiki-token-constant` | `#0550ae` | `#79b8ff` | Constants and numbers. |
| `--shiki-token-function` | `#6639ba` | `#b392f0` | Function names. |
| `--shiki-token-keyword` | `#cf222e` | `#f97583` | Keywords. |
| `--shiki-token-link` | `#0a3069` | `#dbedff` | Links. |
| `--shiki-token-parameter` | `#953800` | `#ffab70` | Parameters. |
| `--shiki-token-punctuation` | `#24292f` | `#e1e4e8` | Punctuation. |
| `--shiki-token-string` | `#0a3069` | `#9ecbff` | Strings. |
| `--shiki-token-string-expression` | `#116329` | `#85e89d` | Template expressions. |

### Shadows and scrim

Shadows mix `--shadow-color` with transparent at the strength the recipe needs, so one token sets the weight of every shadow in a palette.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--shadow-color` | `rgba(16, 24, 40, 0.24)` | same | `#000000` | Base color of every shadow. |
| `--edge-highlight` | `transparent` | same | `rgba(255, 255, 255, 0.06)` | The 1px inner highlight on the top edge of floating surfaces. |
| `--scrim` | `rgba(16, 24, 40, 0.3)` | same | `rgba(0, 0, 0, 0.5)` | Backdrop behind the command palette and the workspace switcher (`bg-scrim`). |

### Terminal

xterm takes concrete colors, so `src/renderer/src/lib/terminal-theme.ts` reads the tokens off the root element. Red, green, yellow, blue and magenta read `--accent-red`, `--accent-green`, `--accent-yellow`, `--accent-blue` and `--accent-purple`. Foreground and cursor read `--foreground`. These cover the rest:

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--terminal-black` | `#24292f` | same | `#0d0d0d` | ANSI black. |
| `--terminal-bright-black` | `#57606a` | same | `#242728` | ANSI bright black. |
| `--terminal-white` | `#5c6370` | same | `#cdcdcd` | ANSI white. A gray in Light, so white text stays readable. |
| `--terminal-bright-white` | `#8c959f` | same | `#ffffff` | ANSI bright white. |
| `--terminal-cyan` | `#0f6e85` | same | `#7dcfff` | ANSI cyan and bright cyan, and cyan in tool output (`text-terminal-cyan`). |
| `--terminal-selection` | `rgba(8, 102, 198, 0.18)` | same | `rgba(255, 255, 255, 0.16)` | Selected text. |

### Project colors

The colors a project can pick in the sidebar, as Tailwind's palette values. Light swaps the two that wash out on white for their 600 shades.

| Token | Light | Dark | High contrast | Role |
|---|---|---|---|---|
| `--project-red` | same | same | `oklch(63.7% 0.237 25.331)` | Red project icon and swatch. |
| `--project-orange` | same | same | `oklch(70.5% 0.213 47.604)` | Orange project icon and swatch. |
| `--project-yellow` | `oklch(68.1% 0.162 75.834)` | same | `oklch(85.2% 0.199 91.936)` | Yellow project icon and swatch. |
| `--project-lime` | `oklch(64.8% 0.2 131.684)` | same | `oklch(76.8% 0.233 130.85)` | Lime project icon and swatch. |
| `--project-emerald` | same | same | `oklch(69.6% 0.17 162.48)` | Emerald project icon and swatch. |
| `--project-teal` | same | same | `oklch(70.4% 0.14 182.503)` | Teal project icon and swatch. |
| `--project-cyan` | same | same | `oklch(71.5% 0.143 215.221)` | Cyan project icon and swatch. |
| `--project-sky` | same | same | `oklch(68.5% 0.169 237.323)` | Sky project icon and swatch. |
| `--project-indigo` | same | same | `oklch(58.5% 0.233 277.117)` | Indigo project icon and swatch. |
| `--project-violet` | same | same | `oklch(70.2% 0.183 293.541)` | Violet project icon and swatch. |
| `--project-purple` | same | same | `oklch(62.7% 0.265 303.9)` | Purple project icon and swatch. |
| `--project-fuchsia` | same | same | `oklch(66.7% 0.295 322.15)` | Fuchsia project icon and swatch. |
| `--project-pink` | same | same | `oklch(65.6% 0.241 354.308)` | Pink project icon and swatch. |
| `--project-rose` | same | same | `oklch(64.5% 0.246 16.439)` | Rose project icon and swatch. |

### Tailwind utilities

The `@theme inline` block turns color tokens into Tailwind utilities. Each one is `var()` of the token with the same name minus `color-`, so `--color-surface-2` gives you `bg-surface-2`, `text-surface-2` and `border-surface-2`, all following the active palette.

```
--color-background  --color-foreground
--color-card  --color-card-foreground  --color-popover  --color-popover-foreground
--color-primary  --color-primary-foreground  --color-primary-on-dark  --color-primary-focus
--color-secondary  --color-secondary-foreground  --color-muted  --color-muted-foreground
--color-accent  --color-accent-foreground
--color-destructive  --color-destructive-foreground
--color-border  --color-input  --color-ring
--color-sidebar  --color-sidebar-foreground  --color-sidebar-primary
--color-sidebar-primary-foreground  --color-sidebar-accent
--color-sidebar-accent-foreground  --color-sidebar-border  --color-sidebar-ring
--color-accent-blue  --color-accent-blue-soft  --color-accent-red  --color-accent-red-soft
--color-accent-green  --color-accent-green-soft  --color-accent-yellow  --color-accent-yellow-soft
--color-accent-purple  --color-accent-purple-soft  --color-accent-peach  --color-accent-peach-soft
--color-accent-ochre  --color-accent-ochre-soft
--color-surface-1  --color-surface-2  --color-surface-3  --color-surface-4
--color-surface  --color-surface-secondary  --color-surface-tertiary
--color-body  --color-body-muted  --color-ash  --color-stone
--color-brand-claude  --color-scrim  --color-terminal-cyan
--color-project-red  --color-project-orange  --color-project-yellow  --color-project-lime
--color-project-emerald  --color-project-teal  --color-project-cyan  --color-project-sky
--color-project-indigo  --color-project-violet  --color-project-purple  --color-project-fuchsia
--color-project-pink  --color-project-rose
```

## Typography

Two families, both bundled through `@fontsource-variable`, so the app never depends on what the machine has installed.

Settings > Appearance sets a family and a size for the interface and for code. `src/renderer/src/lib/font-preference.ts` stores them in `localStorage` under `aide.fonts` and writes them onto the root element over the defaults below. An empty field keeps the default.

| Token | Value | Role |
|---|---|---|
| `--ui-font-family` | Geist Variable, then the system UI font | Interface family. `--font-sans` reads it. |
| `--ui-font-scale` | `1` | Interface size divided by 14px. Scales `body`, `.prose` and Tailwind's text steps. |
| `--code-font-family` | Geist Mono Variable, then JetBrains Mono, then the system monospace | Code family. `--font-mono` reads it. |
| `--code-font-size` | `12.5px` | Code blocks, tool output and shell output. Diffs and the terminal take the size too once it is set; until then they keep 12px and 13px. |
| `--font-sans` | `var(--ui-font-family)` | Tailwind's `font-sans`. |
| `--font-mono` | `var(--code-font-family)` | Tailwind's `font-mono`. |

The terminal keeps JetBrains Mono with Nerd Font fallbacks for prompt glyphs until a code family is set, and then puts that family first.

`@theme inline` scales Tailwind's text steps by `--ui-font-scale`: `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl` and `--text-2xl`. Arbitrary sizes such as `text-[13px]` and the px sizes in styles.css do not scale.

`body` sets 14px times the scale, line-height 1.5, letter-spacing -0.01em, ligatures and kerning on, and antialiased smoothing. The sizes below are the ones components use at the default scale.

| Size | Weight | Where |
|---|---|---|
| 10px | 600 | Composer section labels (uppercase, 0.18em tracking), mono shortcut digits on approval buttons. |
| 11px | 600 | `.eyebrow` (uppercase, 1.2px tracking, `--muted-foreground`), pane tabs in the top bar. |
| 12px | 400 to 500 | `.keycap`, `.system-notice`, Tailwind `text-xs` for meta lines and inline commands. |
| 12.5px | 400 | `--code-font-size`: code inside `.prose pre`, tool and shell output, line-height 1.6. |
| 13px | 500 to 600 | `.composer-tool` (500), workspace names in the sidebar (600), menu rows. |
| 14px | 400 to 600 | Base UI text, card titles (600). |
| 15px | 400 | `.prose` transcript text (line-height 1.6, -0.006em) and the composer textarea (line-height 1.5). |
| 1em to 1.25em of 15px | 600 | `.prose` h3, h2, h1, with -0.018em tracking and line-height 1.3. |

`.display` sets weight 600 and -0.3px tracking for headings that need to stand out.

## Spacing

styles.css defines no spacing tokens. Components use Tailwind's default 4px step. The values that come up most:

- 16px (`p-4`): padding inside a pane frame when more than one pane shows.
- 12px by 16px (`py-3 px-4`): approval card and composer textarea padding.
- 8px by 12px: sidebar workspace row (`py-2 pl-3`), with 40px on the right for its hover actions.
- 5px by 8px with a 6px gap: `.composer-tool`.
- 48rem (`max-w-3xl`): the transcript, approval card and composer all share this width, centered in the pane.

One layout token exists:

| Token | Value | Role |
|---|---|---|
| `--pane-header-h` | `40px` | Height of every pane header and of the sidebar project row, so their bottom edges line up across the window. `e2e/pane-header-alignment.spec.ts` guards it. |

## Radii

`@theme inline` replaces Tailwind's radius scale, so `rounded-md` means `--radius-md` and so on.

| Token | Value | Where |
|---|---|---|
| `--radius-xs` | `4px` | Keycaps, the focus outline. |
| `--radius-sm` | `6px` | Menu and list box rows. |
| `--radius-md` | `8px` | Popovers, menus, tooltips, the command palette, composer tools, sidebar rows, buttons. |
| `--radius-lg` | `10px` | Pane frames, the approval card, code blocks. |
| `--radius-xl` | `16px` | Modal dialogs, the workspace switcher. |
| `--radius-pill` | `9999px` | Pills (see below). |
| `--radius` | `0.5rem` | HeroUI's base radius. Matches `--radius-md`. |

HeroUI rounds overlays to 24px and their rows to 16px on its own. styles.css overrides that for `.popover`, `.select__popover`, `.dropdown__popover`, `.tooltip`, `[cmdk-root]` and `[data-model-selector-menu]` (8px), and for `.menu-item` and `.list-box-item` (6px).

## Elevation

Depth comes from the surface ladder first: canvas, then `--surface` for panes, then `--surface-1` and `--surface-2` for things inside them. In Dark each step is visibly lighter. In Light panes are white on gray chrome and each step inside them is darker. In High contrast the steps are close and `--border` does the work. Shadows mix `--shadow-color` (see Shadows and scrim). Three recipes cover everything that floats:

- **Floating surface** (`.floating-surface`) for popovers, menus and dialogs. `--popover` fill, a 1px `--edge-highlight` on the top edge, a `0 8px 24px -8px` shadow at 70% of `--shadow-color`, and a 1px `--border-strong` ring.
- **Composer.** A 1px `--border` ring plus a 2px shadow at 50% of `--shadow-color` at rest. While focused, the ring turns `--primary` and the shadow grows to `0 8px 24px -12px`.
- **Active card.** `.overview-card.is-active` swaps its border to `--primary` and adds a matching 1px ring. On hover it lifts 1px.

## Motion

| Token | Value | Use |
|---|---|---|
| `--t-fast` | `140ms cubic-bezier(0.22, 0.61, 0.36, 1)` | Color, background, border and shadow changes on every interactive utility class, composer tools, transcript links. |
| `--t-base` | `200ms cubic-bezier(0.22, 0.61, 0.36, 1)` | Nothing reads it today. |
| `--ease-out-strong` | `cubic-bezier(0.23, 1, 0.32, 1)` | Entrances and size changes: turns, drawers, settings, the sidebar tree, button presses. |

Durations in use:

| Duration | What moves |
|---|---|
| 140ms | Hover and color changes (`--t-fast`). |
| 150ms / 220ms | Terminal drawer height, closing / opening. Only the height animates. |
| 160ms | Button press: every button scales to 0.97. Conversation minimap ticks and preview. |
| 180ms | Settings page fade and slide. Fleet drawer opacity. |
| 200ms | Expanded sidebar tree slide. |
| 240ms | A new transcript turn fades in and rises 6px. Fleet drawer width and slide, on `cubic-bezier(0.32, 0.72, 0, 1)`. |
| 3s, looping | `.sidebar-working-shimmer`, a `--foreground` sweep at 2 to 4% opacity across a working workspace row. |
| 2s, looping | `.thinking-shimmer`, a `--foreground` highlight sweeping across `--muted-foreground` text while the model reasons. Off under `prefers-reduced-motion`. |

With `data-motion="reduced"`, every animation stops, and transitions shrink to opacity and color only at 100ms. Turns, the settings page, the sidebar tree and button presses stop moving. The minimap also honors `prefers-reduced-motion`.

## Components

### Pane

A pane is a workspace's unit of work: agent, terminal, editor, git review, preview. `getPaneFrameClassName` in `src/renderer/src/lib/pane-frame.ts` builds its frame.

- A sole pane fills the canvas with `--surface` and has no border or radius.
- With several panes, each frame is `--radius-lg`, 16px padding, `--surface` fill, and a 1px `--border` edge. The active pane's edge is `--border-strong`. Nothing else changes, so focus reads without a color shift.
- A pane header is `--pane-header-h` tall with a bottom `--border` and 20px side padding (Git review, Preview).
- Top bar pane tabs are 11px semibold with a `--radius-md` corner and a state dot. Inactive tabs use `--muted-foreground` and fill with `--surface-secondary` on hover.

Session state dots are 8px circles: `--accent-blue` pulsing while running or connecting, `--accent-yellow` waiting, `--accent-green` ready, `--accent-red` error, `--ash` stopped, `--stone` unknown (`src/renderer/src/lib/session-state-dot.ts`).

### Sidebar row

Two row types in `SidebarTree.tsx`:

- **Project row.** `--pane-header-h` tall, `--radius-md`, 8px side padding, `--surface-secondary` on hover or while a child has focus. Its menu button appears on hover.
- **Workspace row.** `--radius-md`, 8px top and bottom, 12px left. The name is 13px semibold. The branch and age line under it is mono and muted. The active workspace gets a 12% `--primary` tint. Rows without activity fill with `--surface-secondary` on hover.

A workspace row's background also reports agent activity. Error gets a 3% `--accent-red` tint. Pending approval and awaiting input get a 3% `--accent-yellow` tint, plus a yellow badge ("Agent Approval" in the approval screenshot). Working or connecting runs the shimmer. Plan ready fills with `--accent-purple-soft`.

### Pill

`--radius-pill` marks the main action in a group, not every button.

- The main action in a flow uses HeroUI `Button` with `rounded-pill`: "Allow once" on the approval card, and "Open project" on the empty workspace, padded 11px by 22px.
- `.composer-tool.is-pill` is a toolbar control shown as a chip: the reasoning effort picker, and the Plan mode badge. 6% `--foreground` fill, 10% on hover, 10px side padding.
- Composer suggestion chips are full-round, 12px semibold, `--primary` text on a 10% `--primary` fill with a 40% `--primary` border.

`.filter-pill` sets colors only (muted, hover to `--surface-1`, active `--surface-2`), and the component supplies the radius. `.cta-pill` and `.text-link-on-dark` exist in styles.css, but no component uses them today.

### Approval card

`ManagedPendingApprovalPanel.tsx`. It sits directly above the composer at the same 48rem width and takes keyboard focus when it appears.

- Container: `--radius-lg`, 1px `--accent-peach` border, `--accent-peach-soft` fill, 12px by 16px padding.
- Header: a warning icon in `--accent-peach`, then "Approval required" in 14px semibold `--foreground`. With more than one approval queued, a muted "1 of N" follows the title.
- Body: the command or file path in mono 12px on an inset `--surface` block with a `--border` edge and `--radius-md`. Diffs render in the same inset style. Raw tool input folds into a `details` element.
- Actions: "Allow once" (primary, pill), "Allow for session" (secondary), "Deny" (ghost). Each ends in a mono 10px digit at 70% opacity, and pressing 1, 2 or 3 picks it.

### Composer

`ManagedComposer.tsx`. Docked at the bottom of an agent pane, 48rem wide.

- Shell: a 16px radius (Tailwind's `rounded-2xl`, not an aide token), `--surface-2` fill, and the composer elevation from above.
- Textarea: 15px with line-height 1.5, transparent, placeholder at 70% of `--muted-foreground`, grows up to 200px and then scrolls.
- Toolbar: `.composer-tool` buttons for attachments, model, agents, effort and permission mode. 13px weight 500 in `--body`, 6% `--foreground` on hover, `--primary-on-dark` when active, 35% opacity when disabled. A context window meter and the round `--primary` send button (`--primary-focus` on hover) sit on the right.
- Menus that open from the composer (model, permission mode, skills, mentions) use `.floating-surface`.

### Smaller utilities

| Class | Look |
|---|---|
| `.btn-icon` | Transparent, `--muted-foreground`. Hover: `--surface-2`, `--foreground`. |
| `.btn-surface` | `--surface-1` with a `--border` edge. Hover: `--surface-2`, `--border-strong`. |
| `.btn-primary` | `--primary` fill. Hover: `--primary-focus`. |
| `.btn-danger-ghost` | `--accent-red` text. Hover: `--accent-red-soft` fill. |
| `.pane-tab`, `.editor-tab` | Muted text. Hover: `--surface-1`. Active: `--surface-2` with a `--border` edge. |
| `.row-hover`, `.notif-item`, `.job-row`, `.change-row` | Transparent rows that fill with `--surface-1` or `--surface-2` on hover or when active. Unread notifications rest on `--surface-1`. |
| `.overview-card` | `--surface-1` with a `--border` edge. See Elevation for hover and active. |
| `.keycap` | 20px tall, 12px text, `--radius-xs`, a `--surface-3` to `--surface-1` gradient, `--border` edge. |
| `.hairline`, `.hairline-soft`, `.hairline-strong` | A 1px border in `--border`, `--border-soft` or `--border-strong`. Defined, unused today. |
| `.system-notice` | 12px muted text centered between two `--border` rules. |

Focus is a 2px `--primary` outline with a 1px offset and `--radius-xs` corners, on `:focus-visible` only. Text inputs skip the outline and show focus through the caret (`--primary-on-dark`) and their container's edge. Selected text gets a 28% tint of `--accent-blue`.

The persisted-state recovery screen (`.recovery-*` classes at the top of styles.css) reads the canvas, the surface ladder, `--border-strong`, `--accent-yellow` and `--accent-red`, so it follows the palette like everything else.
