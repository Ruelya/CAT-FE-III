# Design

| Item | Value |
| --- | --- |
| Date | 2026-08-17 |
| Product | Translunar CAT desktop (Electron + React) |
| Source of truth | This file is the portable design system. Runtime numbers live in `apps/desktop/src/renderer/tokens.css`. Enforcement lives in `.trellis/spec/frontend/design-language.md`. |
| Scope | What the renderer already ships after the courseware workbench + Option 2 paging merge. Not a wishlist. |

Use this document to design or review any new surface. If another note disagrees with `tokens.css`, fix the note in the same change.

---

## 1. Design read

A **local-first professional translation workbench** for career translators and localization engineers. They arrive from Trados, memoQ, or Phrase, sit in one window for hours, and judge the tool on density, keyboard reach, and whether it gets out of the way.

Not a marketing site. Not a consumer app. Not an analytics dashboard.

**One line:** quiet editorial structure, warm paper and cool ink, industrial controls, high information density, brand ribbon as data not decoration.

| Dial | Value | Meaning |
| --- | ---: | --- |
| Variance | 6/10 | Predictable workflows. Hierarchy may be asymmetric. No marketing composition. |
| Motion | 5/10 | Wide coverage, small amplitude, always causal. No ambient motion. |
| Density | 8/10 | Professional density. Interactive targets never under 32 px. |

External taste skills (`design-taste-frontend`, `ui-ux-pro-max`) target landing pages and mobile. This product is dense tables, a segment grid, and multi-step forms. Do not adopt their default palette, Inter, glass, or hero/bento layouts.

The renderer is presentation and interaction only. Segmentation, TM, QA, counts, and export gates belong to the Rust engine. The renderer never talks to SQLite.

---

## 2. Principles (reusable)

These apply to every surface, not just the editor.

1. **Warm paper, cool structure.** Surfaces are warm. Lines, muted text, borders, and disabled states are cool green-grey. That tension is what stops the UI from reading as a beige wash.
2. **One accent.** Advanced brown is the only interactive accent on every surface and both themes. Semantic colours (success / warning / error / info) are theme-fixed and never derived from a custom accent seed.
3. **The brand ribbon does work.** Five brand colours are a categorical data series (progress, QA severity, document type, charts). They never colour a button.
4. **Type carries quality.** Colour is structure. Type is voice.
5. **Never colour-only.** Status is colour + text, and a Phosphor glyph when space allows.
6. **Solid material.** No `backdrop-filter`, frosted glass, or translucent panels. Depth comes from the surface ladder plus a 1 px border. Shadows are rare and tinted.
7. **32 px floor.** Anything clickable is at least 32×32. Visually smaller chips extend the hit area.
8. **One primary per surface.** Secondary and danger stay reachable but visually subordinate.
9. **Empty states do not duplicate the masthead.** If the primary action is already on the surface, the empty state states the fact and stops.
10. **Counts are engine-owned.** A visible page must not pretend to be the whole document.

---

## 3. Colour

Raw colour, radius, motion, shadow, and z-index exist only in `tokens.css`. `pnpm ui:audit` enforces that.

### 3.1 Surface ladder

Adjacent steps differ by at least 2.5 CIE L\*. Structure must be readable without a border.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--color-sunken` | `#e2ded4` | `#121110` | Recessed wells |
| `--color-canvas` | `#eeeae1` | `#1a1714` | App background |
| `--color-surface` | `#f7f4ee` | `#24211c` | Panels, docks, grid |
| `--color-raised` | `#fffefb` | `#2f2b25` | Inputs, menus, raised rows |
| `--color-line` | `#d5d2c8` | `#37332c` | Decorative divider only |
| `--color-border` | `#82857e` | `#79756b` | Control boundary (≥ 3:1) |
| `--color-border-strong` | `#6d716b` | `#8b8579` | Stronger control edge |
| `--color-text` | `#1f1d1a` | `#f3efe8` | Body |
| `--color-text-muted` | `#585c57` | `#a5a89f` | Secondary, cool |
| `--color-text-subtle` | `#5c605c` | `#96948b` | Tertiary |

### 3.2 Accent

Default seed: `#765847` (`appearance-v1`). Runtime overwrites the accent family from the stored seed. Light default paint uses the seed as `--color-accent`. Dark default paint lightens it (about `#b98a70`).

| Token | Role |
| --- | --- |
| `--color-accent` | Primary buttons, focus, selected emphasis |
| `--color-accent-hover` / `--color-accent-active` | Press ladder |
| `--color-accent-soft` | Selected row, soft chips |
| `--color-on-accent` | Text on a solid accent fill |
| `--color-focus` | 2 px focus ring |

A custom seed must still reach 4.5:1 for on-accent body text and 3:1 for the focus ring on canvas, surface, and raised. Reject seeds that cannot, with a visible reason.

### 3.3 Semantic (theme-fixed)

| Token | Light | Dark |
| --- | --- | --- |
| `--color-success` | `#1b5e3f` | `#63c093` |
| `--color-warning` | `#7a4a08` | `#e0ac4b` |
| `--color-error` | `#a32f2f` | `#f08a8a` |
| `--color-info` | `#1f5570` | `#77bcd9` |

Each has a `*-soft` fill. Never derive these from the accent seed.

### 3.4 Brand ribbon and data series

Identity order is fixed. Do not swap. Do not put these on interactive controls.

| Order | Name | Mark | Series (light) | Series (dark) |
| --- | --- | --- | --- | --- |
| 1 | Burnt | `#d9562b` | `#ad3f1d` | `#eb8258` |
| 2 | Ochre | `#d29a2e` | `#a3761a` | `#e8c063` |
| 3 | Lichen | `#87904a` | `#667130` | `#b0bb72` |
| 4 | Teal | `#4f8076` | `#356057` | `#5f978c` |
| 5 | Dusk | `#526f86` | `#374b5c` | `#5a7d95` |

Stacked bars leave a 1 px gap in the parent surface colour between segments. Every series also has a text label or legend.

### 3.5 Contrast floors

| Element | Floor |
| --- | ---: |
| Body and label text | 4.5:1 |
| Large text (18.66 px bold or 24 px regular) | 3:1 |
| Focus ring on every surface it can land on | 3:1 |
| Form control boundary, toggle, chart axis | 3:1 |
| Decorative divider | none |

---

## 4. Typography

Four bundled faces. No web fonts at runtime. `font-display: swap` on every face.

| Token | Face | Role |
| --- | --- | --- |
| `--font-display` | Space Grotesk | Surface titles, brand, empty-state headlines |
| `--font-ui` | Chivo | All chrome and body |
| `--font-mono` | Space Mono | Numbers, IDs, locales, paths, shortcuts |
| `--font-cjk` | Noto Sans SC | Source, target, and any CJK. Never preloaded. |

| Token | Size | Use |
| --- | ---: | --- |
| `--text-2xs` | 11 px | Keyboard hints, dense sub-labels |
| `--text-xs` | 12 px | Metadata, captions, chips |
| `--text-sm` | 13 px | Secondary body, table cells |
| `--text-md` | 14 px | Default body and controls |
| `--text-lg` | 16 px | Section headings, target editor |
| `--text-xl` | 20 px | Panel titles |
| `--text-2xl` | 26 px | Surface titles |
| `--text-3xl` | 34 px | Welcome only |

Weights: 400 / 500 / 600 / 700. Leading: tight 1.2, snug 1.35, body 1.5, CJK 1.75.

Rules:

- Every number, count, percentage, and duration uses `tabular-nums`.
- Italic is only for real emphasis in prose, never for labels.
- Prose measure is capped at `--measure` (68 ch). Table cells are not prose.
- Technical values (IDs, revisions, ISO times) are demoted: mono, muted, and if verbose, inside a collapsed disclosure. Raw JSON is not a UI.

---

## 5. Space, shape, elevation, layers

**Space** (`--space-*`): 2 / 4 / 8 / 12 / 16 / 20 / 24 / 32 / 48. Nothing else.

**Radius:** 4 px inputs and chips, 6 px buttons and panels, 8 px dialogs, 999 px dots and avatars only.

**Control height:** 24 px non-interactive chips only; 32 / 36 / 40 px for controls. 32 px is the interactive floor.

**Elevation:** `--shadow-sm` sticky headers and raised rows; `--shadow-md` menus; `--shadow-lg` dialogs. All tinted to the paper hue. Panels do not use shadow for depth.

**Layers:** `--z-base` 0, `sticky` 10, `dock` 20, `menu` 30, `dialog` 40, `toast` 50. Raw `z-index` integers are forbidden.

**Scrim:** `--color-scrim`, tokenised, only behind modal dialogs.

**Chrome geometry (current product):**

| Token | Default |
| --- | ---: |
| `--chrome-height` | 44 px |
| `--rail-w` | 40 px |
| `--file-nav-w` | 200 px (clamp 140–360) |
| Intel dock | 300 px (clamp 220–480) |
| `--preview-w` | 280 px (clamp 200–520) |
| `--panel-w-pdf` | 288 px |
| `--panel-w-tm` | 320 px (legacy rail; intel now sits above the grid) |

---

## 6. Motion

Wide coverage, small amplitude, causal. Animate **only** `transform` and `opacity`, except the measured grid-track width when a dock opens or closes.

| Token | Value | Use |
| --- | --- | --- |
| `--motion-instant` | 60 ms | Press |
| `--motion-fast` | 120 ms | Colour and state |
| `--motion-base` | 160 ms | Surface swap |
| `--motion-slow` | 220 ms | Dock resize |
| `--ease-standard` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | Default |
| `--stagger-step` | 40 ms | First 8 list rows |

| Class | Trigger | Spec |
| --- | --- | --- |
| M1 | Surface change | View Transition or 8 px `translateY` cross-fade, 160 ms |
| M2 | Dock open / collapse | Track width + opacity, 220 ms. Content stays mounted, becomes `inert` |
| M3 | Active row | Left emphasis bar + accent-soft fill |
| M4 | Async | Skeleton matches settled geometry. Buttons keep their label |
| M5 | Confirm / save success | Chip hue + one `scale(1.04 → 1)` pulse |
| M6 | List first paint | First 8 rows, 6 px up. No overshoot on dense tables |
| M7 | `:active` | `translateY(1px)` or `scale(0.985)`, 60 ms |

`prefers-reduced-motion: reduce` collapses every motion token to 0. No ambient loops, parallax, scroll hijack, marquees, custom cursors, or spinners that replace a button label.

---

## 7. Components

Class names live in `styles/primitives.css`. Do not invent a second button or field language.

### Buttons

| Class | Intent |
| --- | --- |
| `.btn--primary` | One per surface |
| `.btn--secondary` | Raised, bordered |
| `.btn--ghost` | Transparent, hover tint |
| `.btn--quiet` | Text-only row actions |
| `.btn--danger` | Destructive |

Sizes: `--sm` 32, `--md` 36, `--lg` 40. `.btn--icon` stays a 32 px square and needs both `title` and `aria-label`.

Labels never wrap. Primary labels are at most three words. A button never stretches to fill a container. Form submit rows are right-aligned at content width. Pending keeps the label and blocks a second click.

### Fields

Label above, control, hint below, error below the hint. Placeholder is not a label. Invalid controls set `aria-invalid` and `aria-describedby`. On submit, focus the first invalid control.

### Chips and progress

`.chip` plus `--success` / `--warning` / `--error` / `--info` / `--accent`. Progress uses `.progress-bar` with `--confirmed` / `--draft` / `--open` segments from the brand series.

### Tables and lists

Sticky header. 1 px `--color-line` row rules. Hover tint. Selected = `--color-accent-soft` plus a left emphasis bar. Numeric columns right-aligned and tabular. Scroll stays inside the panel. No document-level horizontal overflow.

### Tabs versus navigation

Route-like section switching is `<nav>` + `aria-current`. A real tab widget must implement the full APG pattern (roving tabindex, Arrow / Home / End, `aria-controls`, named `tabpanel`). Half a tab pattern is worse than a link list.

### Panels and dialogs

Collapsed dock content stays mounted, `inert` + `aria-hidden`. Dialogs trap focus, restore the opener, treat Escape as non-destructive, and stay mounted through async work.

Inside a modal, show the focus ring on `:focus`, not only `:focus-visible`. Initial focus is the safest action: Cancel in a confirm; Recover (not Discard) in draft recovery.

### Empty, loading, error

- Loading: skeleton whose geometry matches the settled layout.
- Empty: bounded, titled, no bare header row. No lone string `Loading` or `Empty`.
- Error: typed, next to the control, input preserved, retry when useful.
- Transient results go to the toast region (`--z-toast`). Persistent results stay next to the control that produced them.

### Icons

`@phosphor-icons/react` only. 16 px dense chrome, 18 px title strip, 20 px empty states. `regular` by default, `bold` for window controls and toggles. No second family, no hand-authored icon paths, no emoji as structure.

---

## 8. Layout patterns

### 8.1 Product chrome

One title strip (`AppChrome`, 44 px). Left: five-colour brand mark, product name, current project / file. Center: contextual File menu. Right: destinations that are valid in this context (Home, Search, Command, AI, Assets, Settings, QA, Export, Insights) plus platform window controls.

macOS uses system traffic lights (`hiddenInset`). Windows and Linux use in-renderer min / max / close (`hidden`).

Appearance lives in `localStorage` key `translunar.renderer.appearance.v1` (`theme` + `accentSeed`). It does not go into engine settings or git.

`App.tsx` mounts exactly one surface. There is no URL router.

### 8.2 List / form surface

Welcome, Project Home, Create, Import, QA, Export, Assets, Settings.

- Content is width-constrained and top-anchored.
- A form does not float in an empty viewport. Either the surface has more real content, or the form sits in a bounded card.
- No bento grids, no equal-weight feature cards, no nested decorative cards.
- Wizard steps only describe real gates. Do not invent extra steps.

### 8.3 IDE workbench (current editor)

This is the densest and visually dominant surface. Other surfaces stay subordinate.

```text
+-- AppChrome ----------------------------------------------------------+
| Act | Files    | Tabs                                                 | Preview     |
| bar | FileNav  | CommandBar  Confirm / Find / Tags / Comments         | Live recon  |
| F/P |          | FilterBar   Open Draft Confirmed Findings ...        | DOMPurify   |
| /C  |          | IntelDock   Matches / Terms / Concordance / AI       | click jump  |
|     |          | Grid        # | Ctx | Source | Target | Status       |             |
|     |          | Paging      Previous   n–m of N   Next               |             |
+-----+----------+------------------------------------------------------+-------------+
| Status: file, locales, progress, counts     Add files / Pretranslate                |
+-------------------------------------------------------------------------------------+
```

Defaults (`workbench-layout.v1`): files open, preview open, chat closed.

Grid columns: `#` · `Ctx` · Source · Target · Status.

- Ctx is a short structure label (`html`, `p`, …).
- Source is tagged text: inline tags render as `inline-tag` chips. Ctrl/Meta-click places a source tag on the target.
- Only the active row mounts the target editor. The hidden `textarea` test id stays `target-editor-${id}`; the visible layer is `target-surface-${id}`.
- Status shows Open / Draft / Confirmed plus Translation / Review / Signed.

**Two filter layers. Do not merge them into one control.**

1. Client display filter on the current page: Open / Draft / Confirmed / Findings / Comments / Repeats, plus text / regex / whitespace / tag display.
2. Engine page window: `segment.editor.list` offset / limit. Document totals come from engine `counts`.

Intelligence sits **above** the grid (Matches / Terms / Concordance / AI), not as a lone Exact TM rail.

Preview sits on the **right**: live reconstruction. Markdown goes through `marked` then `DOMPurify`. HTML and other filters reconstruct typography then use the same sanitizer. When managed DOCX bytes exist, `docx-preview` paints the original file above the clickable live blocks. This is not Word COM, not the PDF page dock, and not OnlyOffice.

OnlyOffice view-host code may exist in the repo. It is **not** mounted in the workbench by default, so it cannot displace live preview.

PDF documents open a separate page-review dock.

---

## 9. Interaction contracts

| Action | Contract |
| --- | --- |
| Confirm | Ctrl+Enter next unconfirmed; Ctrl+Alt+Enter next in order; Ctrl+Shift+Enter stay. If this page is done and the document has more, load the next engine page. |
| Save | Ctrl+S / File → Save flushes the active draft. IME composition never confirms or saves. |
| Row move | Up / Down stay inside the grid. |
| Source tags | Chips. Ctrl/Meta-click places. Adjacent placeholders may group. |
| Filter count | Always “shown of document total”, never “shown of this page” pretending to be the file. |
| QA jump | Find the segment by id, paging if needed. Do not no-op because it is off the current page. |
| Preview jump | Click a block, or Enter / Space. |
| Destructive confirm | Initial focus on the safest action. |

Clicking the hidden `textarea.sr-only` in tests requires `{ force: true }`.

Stable test ids (do not rename): `workbench`, `bilingual-grid`, `display-filter`, `intel-dock`, `structure-preview`, `segment-paging`, `target-editor-*`, `target-surface-*`, `add-files`, `file-nav`.

---

## 10. Copy

Concise, functional, domain-accurate. State the fact and the recovery action.

Forbidden: descriptive subtitles, guiding microcopy, feature narration, future-feature copy, contrast sentences built on “不是”, marketing filler (`Elevate`, `Seamless`, `Unleash`, `Next-Gen`), invented precise numbers, em dash or en dash in visible copy, decorative status dots, scroll cues, version stamps in chrome.

Sentence case for labels and headings. Title case only for proper nouns.

---

## 11. Accessibility

WCAG 2.2 AA in both themes.

- Every workflow is completable from the keyboard. The focus ring is never removed.
- Repeated row actions include item identity in the accessible name.
- `role="status"` for status, `role="alert"` for actionable failure, without stealing focus.
- Reading order matches visual order. After a surface change, focus lands on the new heading.
- CJK IME composition is never interrupted.
- Supported viewports: 1180×700, 1250×744, 1680×942, 1920×1080, and 125% text zoom. No document-level overflow, overlap, clipping, or hidden primary action.

---

## 12. What this is not

| Wrong noun | Why |
| --- | --- |
| VS Code / Zed / Monaco as the product | Those are code editors. The spine is a segment pair + tags + TM. |
| OnlyOffice / Word as the editor | Document suites are preview hosts at most. Default preview is live reconstruction. |
| Claiming Trados parity | No Word COM, no seven-tier review, no `.sdltm` / `.sdltb`, no cloud collaboration. Close is the goal. Parity is not. |
| A homemade four-column table as Studio | The current translator surface is intel on top, preview on the right, status on the bottom. |
| Current-page counts as file counts | Counts come from the engine. |

---

## 13. File map

| Path | Role |
| --- | --- |
| `apps/desktop/src/renderer/tokens.css` | Only file allowed to hold raw colour / radius / motion / z |
| `apps/desktop/src/renderer/styles/primitives.css` | Buttons, fields, chips, empty states |
| `apps/desktop/src/renderer/styles/workbench.css` | Workbench grid and docks |
| `apps/desktop/src/renderer/surfaces/Workbench.tsx` | Workbench composition |
| `apps/desktop/src/renderer/workbench/SegmentGrid.tsx` | Segment grid + engine paging |
| `apps/desktop/src/renderer/workbench/IntelDock.tsx` | Memory / terms / concordance / segment AI |
| `apps/desktop/src/renderer/workbench/StructurePreview.tsx` | Right-side live preview |
| `apps/desktop/src/renderer/workbench/DisplayFilterBar.tsx` | Client filter strip |
| `apps/desktop/src/renderer/workbench/TaggedText.tsx` | Source tag chips |
| `apps/desktop/src/renderer/state/appearance.ts` | appearance-v1 |
| `apps/desktop/src/renderer/state/workbench-layout.ts` | Dock widths and toggles |
| `.trellis/spec/frontend/design-language.md` | Enforceable contract (English) |

---

## 14. Verification

| Gate | Command |
| --- | --- |
| Static design audit | `pnpm ui:audit` |
| Visual + geometry | `pnpm ui:shots` / `pnpm ui:shots:matrix` |
| Reduced motion | `node scripts/ui-shots.mjs --reduced-motion` |
| Contrast and tokens | `apps/desktop/src/renderer/state/appearance.test.ts` |
| Behaviour | `pnpm --filter @translunar/desktop test` |

A rule that cannot be checked mechanically is checked by reading the captured PNGs.

---

## 15. Forbidden

Glass · a second accent · semantic colours derived from the accent · raw colour outside `tokens.css` · radius outside 4 / 6 / 8 / full · raw `z-index` · raw motion durations · a second icon family · hand-drawn icon paths · emoji as structure · placeholder as label · hit targets under 32 px · `display: none` to animate a dock · animating width / height / top / left except M2 · ambient motion · overshoot on dense tables · spinners replacing button labels · bare `Loading` / `Empty` · empty tables without an empty state · JSON as UI · half a `role="tab"` · destructive actions without a safest-first confirm · em / en dashes in visible copy · marketing filler · inline layout styles that are not data-derived geometry.
