# Design — Workbench visual polish

## Approach

All work is paint-level: new CSS custom properties, additive pseudo-element /
pseudo-class rules, and one keyframe pair driven by a transient class. No DOM
structure changes; the only TSX touch is a class toggle + timer in the
existing `confirmSegment` success path in `Workbench.tsx`.

## Token additions (`:root`)

```css
--surface-raised: #fffdf6;   /* cards floating above paper */
--surface-sunken: #ece2cf;   /* wells/scroll backdrops below paper */
--accent-hover: #d94f13;     /* existing hardcoded hover, now tokenized */
--neutral: #9a9288;          /* untranslated gray, now tokenized */
--focus-ring: 0 0 0 2px rgba(242, 92, 26, 0.55);
```

Dark themes (`.theme-dark` + `theme-system` media query) define matching
values: raised `#2a2620`, sunken `#14120f`, accent-hover `#ff7434`,
neutral `#8b8177`, focus ring uses the same accent alpha (accent hue is
theme-invariant). Grain overlay is **light theme only** — dark paper noise
reads as dirt at this palette's value range.

Chrome uses semantic `--chrome-bg` / `--chrome-fg` tokens instead of swapping
`--ink` and `--surface`. The Workbench also resolves `color: var(--ink)` in the
same element that owns the theme class. This prevents ancestor-inherited light
theme text and keeps app/status/header/action chrome readable in dark mode.

## Per-requirement mechanics

### R1 Selection
```css
::selection { background: rgba(242,92,26,.24); color: inherit; }
.app-bar ::selection, .status-bar ::selection,
.document-switcher ::selection, .project-search ::selection {
  background: rgba(242,92,26,.55); color: #fffaf0;
}
```
`color: inherit` avoids breaking CJK target text colors.

### R2 Depth ladder
- `.suggestion-scroll` background → `var(--surface-sunken)` (keep the dot
  texture layered above it via existing background-image).
- `.match-card, .qa-card` background → `var(--surface-raised)`.
- `.preview-lines` background → `color-mix(in oklab, var(--surface-sunken),
  transparent 20%)` so active-line accent tint still reads.
No border/shadow changes — depth comes from value contrast alone.

### R3 Grain
Data-URI SVG with `feTurbulence` (baseFrequency .8, 2 octaves) at ~2.5%
opacity as an additional `background-image` layer on `.workbench-app`;
`background-attachment: fixed` is avoided (paint cost in Electron), so the
layer repeats. The Workbench is the actual full-viewport paint layer and owns
the theme class, which lets dark-theme `--paper-grain: none` resolve in the
same custom-property scope. `body` keeps the plain fallback background. No new
stacking context or z-index is introduced.

### R4 Scrollbar
```css
.segment-grid::-webkit-scrollbar, ... { width: 10px; height: 10px; }
...-thumb { background: var(--line-strong); border: 3px solid transparent;
  border-radius: 6px; background-clip: content-box; }
...-thumb:hover { background-color: var(--accent); }
...-track { background: transparent; }
```
Transparent border + content-box gives a "thin at rest" look without
reserving layout width changes (scrollbar is overlay-sized in layout terms
here because track is transparent and width is constant 10px; gutter already
exists). `scrollbar-gutter: stable` already on assistant transcript; we do
not add it elsewhere (layout shift risk).

### R5 Focus ring
Add `:focus-visible { box-shadow: var(--focus-ring); outline: none; }` to:
`.filter-button`, `.confirm-button`, `.icon-button`, `.suggestion-tabs
button`, `.insert-button`, `.assistant-quick-actions button`,
`.assistant-composer > button`, `.preview-actions .icon-button`,
`.filter-group select`. Elements that already have bespoke focus styles
(textareas, form fields, tag capsules) are untouched.

### R6 Confirm flash
- Keyframes `lamp-pop` (scale 1 → 1.35 → 1, 300ms) applied to
  `.status-lamp.just-confirmed i`.
- Keyframes `row-flash` (background-color from
  `color-mix(in srgb, var(--band-2) 26%, var(--paper-shade))` fading to the
  row's normal active background, 450ms) applied to
  `.segment-row.row-flash td`.
- TSX: in `confirmSegment`, after the engine confirms successfully and state
  is updated, `setFlashSegmentId(id)`; row render adds `row-flash` when
  `segment.id === flashSegmentId`; a `window.setTimeout(500)` clears it.
  Timer stored on the existing `timersRef` map pattern so unmount cleans up.
  Virtualization safety: flash id is keyed by segment id, so re-windowing
  simply won't render the class if the row leaves the window; clearing timer
  still fires.
- The existing `@media (prefers-reduced-motion: reduce)` block already
  collapses all animation durations to 1ms — no extra gate needed, but the
  flash must not depend on animation events for class cleanup (uses
  setTimeout, so it's safe).

### R7 Token debt
- Replace `#d94f13` (3 occurrences: `.button.primary:hover`,
  `.export-command:hover`, `.assistant-composer > button:hover`) with
  `var(--accent-hover)`.
- Replace `#9a9288` (2 occurrences: `.status-lamp i`,
  `.status-counts .untranslated`) with `var(--neutral)`.
- Delete `.suggestions-header > strong { clip-path: none; }` line and the
  `.suggestions-header > strong::after { content: none; }` rule (dead since
  the angled-clip experiment was removed).

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Scrollbar width change shifts virtualized row offsets | `EDITOR_ROW_HEIGHT` is row height, unaffected by scrollbar; grid already scrolls with gutter |
| `::selection` color harms readability in target textarea | alpha .24 on paper keeps contrast ratio > 7 for ink text; CJK textarea inherits color |
| Flash class lingers if component unmounts mid-animation | cleanup only removes a class; worst case a stale id in state, cleared on next confirm |
| Dark theme contrast of sunken/raised | values chosen to keep ≥ 8% value gap vs `--surface`; verified via screenshot review |
| E2E exact-match on colors | quality spec forbids exact-pixel assertions; existing tests use geometry tolerances |

## Rollback

Single-commit, two files. `git revert` of the commit restores prior visuals
with zero data or API impact.
