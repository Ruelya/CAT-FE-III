# Translunar Design Language

Authority for every visual and interaction decision in the Electron renderer.
When this file and another spec disagree, this file wins and the other file is
corrected in the same change.

Read this before touching `tokens.css`, `styles/`, or any component that
renders visible UI.

---

## 1. Design read

Translunar CAT is a **local-first professional translation workbench for long
working sessions**. The user is a career translator or localization engineer
who arrives from Trados, memoQ, or Phrase, works in the same window for hours,
and judges the product on density, keyboard reach, and whether the tool gets
out of the way.

It is not a marketing site, not a consumer app, not an analytics dashboard.

The intended read: **quiet editorial structure, warm paper and ink, precise
industrial controls, high information density, selective brand geometry.**

### Design dials

| Dial | Value | Meaning here |
| --- | ---: | --- |
| Variance | 6/10 | Deliberate asymmetry and hierarchy inside predictable desktop workflows. No marketing composition. |
| Motion | 5/10 | Broad coverage, small amplitude, always causal. No ambient or decorative motion. |
| Density | 8/10 | Scan-friendly professional density with stable 32 px hit targets and readable type. |

### External skill policy

`.agents/skills/design-taste-frontend` and `.agents/skills/ui-ux-pro-max` are
installed and should be consulted, but both target marketing sites and mobile
apps. `design-taste-frontend` §13 explicitly excludes dense product UI, data
tables, and multi-step forms, which is most of this product. The adoption and
rejection list lives in `.agents/skills/README.md`. This file is the authority.

---

## 2. Colour

### 2.1 The palette question, answered

`design-taste-frontend` §4.2 bans "warm beige background + brass accent +
espresso text" as the AI-default premium-consumer palette. Translunar's warm
paper canvas and brown accent sit inside that family.

The palette stays, because it does real work: a warm low-luminance canvas is
easier on the eyes than stark white across an eight-hour session, and it
matches the proof-sheet mental model translators already have. It is a
documented brand contract, not a default reach.

The criticism is answered by **execution**, and these four rules are binding:

1. **Cool neutral axis.** Structural lines, secondary text, borders, and
   disabled states use a green-grey neutral, never a warm brown-grey. The
   tension between warm surfaces and cool structure is what stops the UI
   reading as an undifferentiated beige wash.
2. **Measurable surface ladder.** Four surface steps with a CIE L\* delta of at
   least 2.5 between neighbours. Structure must be visible without borders.
3. **Brand ribbon does real work.** The five brand colours are a categorical
   **data palette** for progress segmentation, QA severity, document type, and
   chart series. They are not decoration parked in the corner.
4. **Typography carries the load.** Space Grotesk, Chivo, Space Mono, and Noto
   Sans SC are the primary source of perceived quality. Colour is structure;
   type is voice.

### 2.2 Light theme (default)

Every value below was checked with sRGB relative luminance, CIE L\*, and WCAG
contrast. The numbers in parentheses are measured, not aspirational.

| Token | Hex | Note |
| --- | --- | --- |
| `--color-sunken` | `#e2ded4` | L\* 88.53 |
| `--color-canvas` | `#eeeae1` | L\* 92.78, ΔL\* 4.25 |
| `--color-surface` | `#f7f4ee` | L\* 96.27, ΔL\* 3.49 |
| `--color-raised` | `#fffefb` | L\* 99.65, ΔL\* 3.39 |
| `--color-line` | `#d5d2c8` | decorative divider only |
| `--color-border` | `#82857e` | cool; 3.12:1 on canvas (control boundary) |
| `--color-border-strong` | `#6d716b` | cool; 4.14:1 on canvas |
| `--color-text` | `#1f1d1a` | 14.01:1 on canvas |
| `--color-text-muted` | `#585c57` | cool; 5.67:1 on canvas |
| `--color-text-subtle` | `#5c605c` | cool; 4.76:1 on sunken |
| `--color-accent` | `#6b4a37` | on-accent text 7.83:1 |
| `--color-accent-hover` | `#57392a` | 10.29:1 |
| `--color-accent-active` | `#42291d` | 13.29:1 |
| `--color-accent-soft` | `#ece2d6` | body text 13.14:1 |
| `--color-on-accent` | `#fffefb` | |
| `--color-success` | `#1b5e3f` | 6.43:1 on canvas |
| `--color-warning` | `#7a4a08` | 6.22:1 on canvas |
| `--color-error` | `#a32f2f` | 5.82:1 on canvas |
| `--color-info` | `#1f5570` | 6.75:1 on canvas |
| `--color-success-soft` | `#dfe9e2` | success text 6.21:1 |
| `--color-warning-soft` | `#f0e6d3` | warning text 6.04:1 |
| `--color-error-soft` | `#f4dedd` | error text 5.44:1 |
| `--color-info-soft` | `#dce8ee` | info text 6.49:1 |

Brand data series, ordered light to dark, minimum L\* separation 3.4:

| Token | Hex | L\* | vs surface |
| --- | --- | ---: | ---: |
| `--color-series-ochre` | `#a3761a` | 52.7 | 3.70 |
| `--color-series-lichen` | `#667130` | 45.4 | 4.82 |
| `--color-series-burnt` | `#ad3f1d` | 42.0 | 5.46 |
| `--color-series-teal` | `#356057` | 37.5 | 6.46 |
| `--color-series-dusk` | `#374b5c` | 30.9 | 8.23 |

### 2.3 Dark theme

| Token | Hex | Note |
| --- | --- | --- |
| `--color-sunken` | `#121110` | L\* 5.12 |
| `--color-canvas` | `#1a1714` | L\* 7.98, ΔL\* 2.85 |
| `--color-surface` | `#24211c` | L\* 12.90, ΔL\* 4.93 |
| `--color-raised` | `#2f2b25` | L\* 17.76, ΔL\* 4.86 |
| `--color-line` | `#37332c` | decorative divider only |
| `--color-border` | `#79756b` | 3.06:1 on raised |
| `--color-border-strong` | `#8b8579` | 3.84:1 on raised |
| `--color-text` | `#f3efe8` | 15.57:1 on canvas |
| `--color-text-muted` | `#a5a89f` | cool; 7.40:1 on canvas |
| `--color-text-subtle` | `#96948b` | 4.62:1 on raised |
| `--color-accent` | `#c79a7c` | on-accent text 7.09:1 |
| `--color-accent-hover` | `#d8ac8e` | 8.68:1 |
| `--color-accent-active` | `#e6bd9f` | 10.32:1 |
| `--color-accent-soft` | `#3a322a` | body text 10.97:1 |
| `--color-on-accent` | `#1a1714` | |
| `--color-success` | `#63c093` | 8.07:1 on canvas |
| `--color-warning` | `#e0ac4b` | 8.65:1 on canvas |
| `--color-error` | `#f08a8a` | 7.40:1 on canvas |
| `--color-info` | `#77bcd9` | 8.48:1 on canvas |
| `--color-success-soft` | `#1c2f26` | success text 6.40:1 |
| `--color-warning-soft` | `#332a17` | warning text 6.85:1 |
| `--color-error-soft` | `#3a2222` | error text 6.08:1 |
| `--color-info-soft` | `#1d2a33` | info text 6.97:1 |

Brand data series, minimum L\* separation 6.0:

| Token | Hex | L\* | vs surface |
| --- | --- | ---: | ---: |
| `--color-series-ochre` | `#e8c063` | 79.5 | 9.28 |
| `--color-series-lichen` | `#b0bb72` | 73.5 | 7.79 |
| `--color-series-burnt` | `#eb8258` | 65.2 | 6.01 |
| `--color-series-teal` | `#5f978c` | 58.5 | 4.81 |
| `--color-series-dusk` | `#5a7d95` | 50.7 | 3.67 |

### 2.4 Colour rules

- **One accent.** Advanced brown is the only interactive accent, in both
  themes and on every surface. No section introduces a second accent.
- **Semantic independence.** Success, warning, error, and info are theme-fixed
  and never derived from the accent seed, including a custom user seed.
- **Custom accent seeds** must still reach 4.5:1 for on-accent body text and
  3:1 for the focus ring against canvas, surface, and raised. A seed that
  cannot is rejected with a visible reason.
- **Brand ribbon** colours are only the brand mark and the data series. They
  never colour an interactive control.
- **Series adjacency.** Segments of a stacked bar are separated by a 1 px gap
  in the parent surface colour, so adjacent series never need a mutual
  contrast ratio. Every series also carries a text label or legend.
- **Never colour-only.** Status is always colour plus text, and where space
  allows plus a Phosphor glyph.
- **No raw colour values** outside `tokens.css`. Enforced by `pnpm ui:audit`.
- **No `backdrop-filter`**, frosted glass, or translucent panel material.
  Scrims and state tints are allowed and must be tokenised.

### 2.5 Contrast floors

| Element | Floor |
| --- | ---: |
| Body and label text | 4.5:1 |
| Text 18.66 px bold or 24 px regular | 3:1 |
| Focus ring against every surface it can land on | 3:1 |
| Form control boundary, toggle track, chart axis | 3:1 |
| Decorative divider | none |

---

## 3. Typography

Four bundled roles. No web fonts are fetched at runtime.

| Token | Family | Role | Fallback |
| --- | --- | --- | --- |
| `--font-display` | Translunar Space Grotesk | Surface titles, brand, empty-state headlines | `"Segoe UI Variable Display", system-ui, sans-serif` |
| `--font-ui` | Translunar Chivo | All interface and body text | `"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif` |
| `--font-mono` | Translunar Space Mono | Numbers, IDs, locales, timestamps, file paths, keyboard hints | `ui-monospace, "Cascadia Mono", Consolas, monospace` |
| `--font-cjk` | Translunar Noto Sans SC | Source and target text, and any CJK content | `"Microsoft YaHei", "PingFang SC", sans-serif` |

Rules:

- `font-display: swap` on every face. Nothing blocks first paint.
- Noto Sans SC is 7.78 MB unsubsetted. It is **never preloaded** and is only
  applied to segment content, the target editor, and CJK-bearing labels. The
  delivery strategy is decided by measurement, not preference.
- Every number, identifier, count, percentage, and duration uses
  `font-variant-numeric: tabular-nums` so columns align.
- Italic is used only for genuine emphasis in prose, never for labels.

### Type scale

| Token | Size | Line height | Use |
| --- | ---: | ---: | --- |
| `--text-2xs` | 11 px | 1.35 | keyboard hints, dense table sub-labels |
| `--text-xs` | 12 px | 1.4 | metadata, captions, chip text |
| `--text-sm` | 13 px | 1.45 | secondary body, table cells |
| `--text-md` | 14 px | 1.5 | default body and control text |
| `--text-lg` | 16 px | 1.5 | section headings, target editor |
| `--text-xl` | 20 px | 1.35 | panel titles |
| `--text-2xl` | 26 px | 1.25 | surface titles |
| `--text-3xl` | 34 px | 1.2 | Welcome only |

Line-height tokens: `--leading-tight` 1.2, `--leading-snug` 1.35,
`--leading-body` 1.5, `--leading-cjk` 1.75.
Weight tokens: `--weight-regular` 400, `--weight-medium` 500,
`--weight-semibold` 600, `--weight-bold` 700.

Prose measure is capped at 68 characters. Table cells are not prose.

---

## 4. Space, shape, elevation, layers

**Spacing** (`--space-*`): `0.5` 2 px, `1` 4 px, `2` 8 px, `3` 12 px, `4` 16 px,
`5` 20 px, `6` 24 px, `7` 32 px, `8` 48 px. Nothing else.

**Radius** (shape consistency lock): `--radius-sm` 4 px for inputs, chips, and
small controls; `--radius-md` 6 px for buttons, menus, and panels;
`--radius-lg` 8 px for dialogs and the largest containers; `--radius-full`
999 px reserved for status dots and avatars only. A rectangle uses exactly one
of these. No other radius value may appear anywhere.

**Control heights**: `--control-h-sm` 32 px, `--control-h-md` 36 px,
`--control-h-lg` 40 px. **32 px is the floor for anything interactive**,
including icon-only buttons. Visually smaller affordances must extend their hit
area with padding or a pseudo-element, not shrink the target. Non-interactive
chips and badges may be 24 px.

**Elevation**: only three levels, all tinted to the surface hue, never pure
black on light.

| Token | Use |
| --- | --- |
| `--shadow-sm` | Raised row, sticky header |
| `--shadow-md` | Menu, popover, tooltip |
| `--shadow-lg` | Modal dialog |

Panels, cards, and sections get their depth from the surface ladder and a 1 px
border, not from a shadow.

**Layers** (`--z-*`): `base` 0, `sticky` 10, `dock` 20, `menu` 30, `dialog` 40,
`toast` 50. Raw `z-index` integers are forbidden.

**Scrim**: `--color-scrim`, theme-tokenised, used only behind modal dialogs.

---

## 5. Motion

Motion is at 5/10: **wide coverage, small amplitude, always causal**. The
perceived quality of a professional tool comes from continuity and
responsiveness, not from spectacle.

### Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--motion-instant` | 60 ms | Press feedback |
| `--motion-fast` | 120 ms | State and colour change |
| `--motion-base` | 160 ms | Surface transition, content swap |
| `--motion-slow` | 220 ms | Panel dock and resize |
| `--ease-standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Default |
| `--ease-decelerate` | `cubic-bezier(0, 0, 0.2, 1)` | Enter |
| `--ease-accelerate` | `cubic-bezier(0.4, 0, 1, 1)` | Exit |
| `--stagger-step` | 40 ms | List entrance |

### The seven motion classes

| Class | Trigger | Specification |
| --- | --- | --- |
| **M1 surface transition** | Navigating between surfaces | `document.startViewTransition` with feature detection; cross-fade plus 8 px `translateY`, `--motion-base`. Falls back to a plain cross-fade. |
| **M2 panel continuity** | TM, PDF, or editor panel docking, collapsing, maximizing | Animate the grid track width plus content opacity, `--motion-slow`, `--ease-standard`. Never `display: none`. |
| **M3 row focus** | Segment grid active or selected row | Left emphasis bar `scaleY` from 0 to 1 plus background tint, `--motion-fast`. |
| **M4 async lifecycle** | Any pending operation | Skeleton whose geometry matches the settled layout, cross-fading to content over `--motion-fast`. Pending buttons keep their label and add an inline indicator so width never changes. |
| **M5 settle feedback** | Confirm, save, apply, export success | Status chip hue transition plus a single `scale(1.04)` to `scale(1)` pulse, `--motion-fast`. Fires once. |
| **M6 list entrance** | First mount of a list or table | `translateY(6px)` to `0` with opacity, `--stagger-step`, capped at the first 8 rows. **Never an overshoot easing on dense data.** |
| **M7 press** | `:active` on any control | `translateY(1px)` or `scale(0.985)`, `--motion-instant`. |

### Hard motion rules

- Animate **only** `transform` and `opacity`. Animating `width`, `height`,
  `top`, or `left` is forbidden except for the single grid-track case in M2,
  which is measured and bounded.
- Every animation must be justifiable in one sentence as hierarchy, causality,
  feedback, or state change. If it cannot, delete it.
- **Forbidden outright**: ambient loops, parallax, scroll hijacking,
  decorative marquees, cursor followers, custom cursors, spinners that replace
  a button label, and any animation on a list longer than 8 visible rows.
- Under `prefers-reduced-motion: reduce`, all motion tokens collapse to `0ms`,
  view transitions are skipped, and staggering is removed. `pnpm ui:shots
  --reduced-motion` asserts the computed durations are zero.

---

## 6. Components

### Buttons

Five intents: `primary` (one per surface), `secondary`, `ghost`, `quiet`
(text-only, for tertiary row actions), `danger`. Three sizes mapping to the
control-height tokens, plus an icon-only variant that keeps a 32 px square.

- Exactly one primary action per surface. Secondary and destructive actions are
  visually subordinate but keep semantic labels and keyboard access.
- Button labels never wrap. Primary labels are at most three words.
- A button never becomes full width to fill a container. Form submit rows are
  right-aligned at content width.
- Pending state keeps the label and disables duplicate submission.
- Icon-only buttons require both `title` and `aria-label`. Enforced by
  `pnpm ui:audit`.

### Fields

Label above, control, hint below, error below the hint. Never a placeholder as
a label. Invalid controls set `aria-invalid` and point at their error node with
`aria-describedby`. On submit, focus moves to the first invalid control.

### Tables and lists

Sticky header, 1 px row separators drawn with `--color-line`, row hover tint,
selected row using the accent-soft tint plus a left emphasis bar. Numeric
columns are right-aligned and tabular. Confined scroll inside the panel; never
document-level horizontal overflow.

### Tabs versus navigation

- Section switching that behaves like a route uses `<nav>` with `aria-current`.
- Only a real tab widget uses `role="tab"`, and then it must implement the full
  APG pattern: roving `tabIndex`, Arrow, Home, End, `aria-controls`, and a
  named `tabpanel`. Half a tab pattern is worse than a link list.

### Panels and dialogs

Panel chrome is shared. Collapsed panel content stays mounted, becomes `inert`
and `aria-hidden`, and focus moves to the expand control.

Dialogs trap focus, restore the opener on close, treat Escape as
non-destructive, and stay mounted through async completion.

**Initial focus is the safest action available in that dialog**, meaning the
one that cannot lose user work or data. In a confirmation this is Cancel. In
the draft recovery dialog there is no Cancel: the choice is Recover or
Discard, and Recover is the action that preserves work, so Recover takes
initial focus. In the stale variant the same reasoning selects Retry. Reading
the rule as "always literally the Cancel button" would put initial focus on the
destructive option in exactly the dialog where a mistake costs the most.

### Status

Semantic chip with colour, text, and glyph. Progress uses the brand data
series. Transient results go to the toast region; persistent results stay in
place next to the control that produced them.

### Icons

`@phosphor-icons/react` only. 16 px in dense chrome, 18 px in the title strip,
20 px in empty states. `regular` weight by default and `bold` for window
controls and toggles. No hand-authored icon paths, no emoji as structural
icons, no second icon family.

---

## 7. Interaction states

Every interactive element covers: rest, hover, focus-visible, active, selected
or current, disabled. State changes must not alter layout bounds.

Every asynchronous action covers: **pending** with a duplicate-submit guard,
**success** where the result is not otherwise visible, **typed error** placed
next to the affected control with the user's input preserved, **cancellation**
where the operation is long, and a **recovery path**.

Every collection covers: **loading** as a skeleton matching settled geometry,
**empty** as a bounded intentional state offering exactly one real action, and
**error** with a retry.

An empty table rendered as a bare header row is a defect. The strings
`Loading` and `Empty` on their own are defects.

---

## 8. Information architecture and density

- The Workbench is the densest and visually dominant surface. Everything else
  is subordinate.
- Secondary surfaces use compact lists, tables, forms, and unframed sections.
  No bento grids, no equal-weight feature cards, no nested decorative cards.
- Surface content is width-constrained and vertically anchored to the top.
  A form must not float in an otherwise empty viewport; either the surface
  carries additional real content or the form is centred in a bounded panel.
- Chrome exposes only destinations that are valid for the current context and
  always shows the current location.
- Technical values such as identifiers, revisions, and ISO timestamps are kept
  but demoted: monospace, subtle colour, and where verbose, inside a collapsed
  "Technical details" disclosure. Raw JSON dumps are not a presentation.

---

## 9. Copy

Concise, functional, domain-accurate. State the fact and the available
recovery action.

Forbidden: descriptive subtitles, guiding microcopy, feature narration,
future-feature copy, contrast constructions using `不是`, marketing filler
(`Elevate`, `Seamless`, `Unleash`, `Next-Gen`), invented precise numbers,
em dash and en dash characters, decorative status dots, scroll cues, and
version stamps in product chrome.

Sentence case for labels and headings. Title case only for proper nouns.
Enforced in part by `pnpm ui:audit` rule R7.

---

## 10. Accessibility floor

WCAG 2.2 AA in both themes, non-negotiable:

- Complete keyboard operation of every workflow, with a visible focus indicator
  that is never removed.
- Programmatic names for every control; item identity included in repeated row
  actions.
- Status messages announced with `role="status"`, actionable failures with
  `role="alert"`, without stealing focus.
- Reading order matches visual order; each surface transition moves focus to
  the new heading.
- CJK IME composition is never interrupted by a confirm or save handler.
- Usable at 1180x700 (the BrowserWindow minimum), 1250x744, 1680x942, and
  1920x1080, and at 125 % text scaling, with no document-level horizontal
  overflow, overlap, clipping, or hidden primary action.

---

## 11. Verification

| Gate | Command |
| --- | --- |
| Static design-system audit | `pnpm ui:audit` |
| Visual and geometry evidence | `pnpm ui:shots`, `pnpm ui:shots:matrix` |
| Reduced motion | `node scripts/ui-shots.mjs --reduced-motion` |
| Contrast and token contracts | `apps/desktop/src/renderer/state/appearance.test.ts` |
| Behaviour | `pnpm test`, `pnpm test:e2e:desktop` |

`pnpm ui:audit` must exit 0. `pnpm ui:shots` must report zero geometry
findings and zero renderer console errors. A rule that cannot be checked
mechanically is checked by reading the captured screenshots.

---

## 12. Forbidden, in one list

`backdrop-filter` · frosted glass · translucent panel material · a second
accent colour · accent-derived semantic colours · raw colour values outside
`tokens.css` · radius values outside the 4/6/8/full scale · raw `z-index`
integers · raw motion durations · `lucide-react` · a second icon family ·
hand-authored icon paths · emoji as structural icons · placeholder as label ·
interactive targets under 32 px · `display: none` to animate a collapsible ·
animating layout properties · ambient or decorative motion · overshoot easing
on dense data · spinners replacing button labels · bare `Loading` and `Empty`
strings · empty tables without an empty state · raw JSON as a presentation ·
`role="tab"` without the full keyboard pattern · destructive actions without a
Cancel-first confirmation · em dash and en dash in visible copy · marketing
filler words · inline layout styles outside data-derived geometry.
