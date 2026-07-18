# Design System: Translunar — CAT Desktop Prototype

> Status: prototype source of truth. This document translates the approved
> retrofuturist direction into an implementable desktop CAT interface.
>
> Primary visual anchor: `docs/ChatGPT Image 2026年7月17日 20_04_16.png`.
> Its workbench composition, color weight, typography hierarchy, dot-matrix
> treatment, document preview, panel geometry, and overall art/product balance are
> the baseline for subsequent screens. Written rules in this document override any
> accidental copy, count, or interaction defect in the raster image.
>
> The existing `docs/stitch/screen-*.png` files are earlier Veridian/botanical
> experiments. They are obsolete references and must not be used to infer the
> current visual language, navigation, copy, or component behavior.

## 1. Product Character and Design Goal

Translunar is a professional translation workbench directed through the complete
visual language of Arknights "Lone Trail": mid-century space-race retrofuturism,
modernist grids, geometric abstraction, large achromatic fields, primary-color
stripes, and the tension between scientific optimism and the loneliness of deep
space. NASA-punk, cassette futurism, and atomic-age graphics are supporting
historical lenses, not three competing skins.

The result must read immediately as a modern CAT application—not a fictional
spacecraft console—but it also must not collapse into a generic minimalist SaaS
interface. Art direction is a product requirement for the prototype.

The space-program idea is an internal visual metaphor, not a replacement
vocabulary for the product:

- Use real CAT terms in the UI: **Project, Documents, Translation Memory,
  Termbase, QA, AI Suggestions, Confirmed, Draft, Export**.
- Do not rename documents to “payloads,” TM to “flight logs,” QA to “pre-flight,”
  AI to “guidance,” or confirmation to “GO.”
- Orbital lines, instrument ticks, registration marks, color bands, paper texture,
  asymmetric compositions, and panel geometry carry the theme without making
  users decode it.
- Nonfunctional decoration is allowed when it is unmistakably decorative. It must
  never resemble a control, status, metric, coordinate, or system message.

The target is a desktop tool used for long sessions. Density is 7/10 in the
editor and 4/10 in setup or overview screens. Variance is 7/10 in chrome and
3/10 in working cells: expressive composition around a predictable editor.
Motion is 6/10 at page and panel level, 3/10 inside the grid. The interface may
feel choreographed, but it must never delay typing or confirmation.

## 2. Non-Negotiable Usability Rules

1. The active source and target segment are always the strongest visual focus.
2. At least 60% of workbench width belongs to the segment grid. Brand graphics
   never reduce the working grid to a narrow decorative column.
3. Controls are placed by frequency of use. File switching and project settings
   open on demand; segment filters, search, QA navigation, and confirmation remain
   immediately available.
4. Decoration never sits behind editable text, table rows, menus, form labels, or
   error messages. Chrome and unused margins should still contain a deliberate
   graphic composition; "nothing but standard controls" is not an acceptable
   interpretation of restraint.
5. Status is never communicated by color alone. Pair color with text, icon, or
   shape.
6. Prototype screens must represent a possible product state. Counts add up,
   progress agrees with status counts, enabled actions have prerequisites, and
   warnings identify a real issue.
7. Avoid fantasy instrumentation: no meaningless gauges, fake telemetry,
   unexplained percentages, decorative coordinate strings, or nonfunctional
   switches.
8. Every top-level screen has one art-directed focal gesture beyond ordinary UI
   components: a stripe composition, asymmetric ink block, orbital line field,
   typographic crop, or engineered edge treatment.

## 3. Visual Theme and Surface Hierarchy

Use two visual zones with different discipline:

- **Application chrome**: top bar, setup screens, overview pages, dialogs, empty
  states, preview handles, and panel headers use warm ink blocks, asymmetric
  spacing, orbital geometry, the retro stripe signature, registration marks,
  short rulers, and controlled dot fields. This is where the Lone Trail identity
  should be unmistakable rather than merely hinted at.
- **Working surfaces**: the segment grid, editor fields, matches, terminology,
  QA rows, and document preview are quiet, flat, and optimized for scanning.
  Their structure comes from rules, spacing, alignment, and state—not ornament.

The interface should feel printed, engineered, and maintained: deep warm paper,
soft-black ink, square status lamps, measured spacing, occasional matte color,
and static paper grain. Low-frequency pages may use isolated geometry and large
empty fields to suggest the scale and solitude of deep space. It must not resemble
a game HUD, spacecraft simulator, museum placard, or themed restaurant menu.

## 4. Color System

### 4.1 Functional palette

- **Mission Paper** (`#F1E7D6`) — primary application canvas. Deliberately deeper
  and warmer than the previous near-white prototype.
- **Chart White** (`#FCF8EE`) — editor cells, forms, popovers, and raised surfaces.
- **Umbra Ink** (`#221B18`) — primary text and occasional solid header fields;
  never use pure black.
- **Graphite Sepia** (`#6E655C`) — secondary text, metadata, placeholders, and
  inactive icons. It must still meet contrast requirements at its assigned size.
- **Paper Shade** (`#EAE0CE`) — hover, selected row, and grouped field background.
- **Hairline Ink** (`rgba(34, 27, 24, 0.18)`) — structural borders and dividers.
- **Signal Orange** (`#F25C1A`) — the primary interactive accent: primary action,
  keyboard focus, active segment edge, and selected tab. Use it sparingly.
- **Confirmed Green** (`#3F7652`) — confirmed/valid state.
- **Warning Ochre** (`#A97824`) — warning or needs-review state.
- **Error Red** (`#B84232`) — blocking QA error and destructive action.
- **Machine Blue** (`#4F7089`) — machine-origin metadata only, such as MT/LLM
  source labels. It is not a general secondary accent.

Do not use green, ochre, red, or blue for decoration. They retain stable semantic
meaning across the application.

### 4.2 Signature retro stripes

The distinctive brand mark is the **Translunar Band**: five flat, adjacent stripes
in this fixed order:

1. **Burnt Orange** `#D9562B`
2. **Solar Ochre** `#D29A2E`
3. **Lichen Green** `#87904A`
4. **Instrument Teal** `#4F8076`
5. **Dusk Blue** `#526F86`

Rules:

- The band is a brand signature, not a second functional palette. Its individual
  colors do not indicate status and are not used for buttons or charts.
- Use all five colors in the fixed order. No gradients, glow, transparency, or
  reordered “rainbow” variants.
- Standard desktop use: an 8–10px horizontal band along one edge of the top app bar,
  or a 12–20px vertical band on a setup/empty-state composition.
- A screen gets at most one full band. A compressed echo containing the same full
  five-color sequence may appear on the app mark, selected project thumbnail, or
  document-preview handle. It must be subordinate and never repeat on cards or rows.
- Keep the band out of the segment grid and away from status lamps. It must remain
  recognizable through placement and sequence, not repetition.
- In dark mode, keep the same hues and reduce brightness by roughly 10%; do not
  turn them into neon strips.

### 4.3 Dark theme

- Canvas `#191511`, surfaces `#242019`, primary text `#F5EFE2`, secondary text
  `#B9AEA1`, borders `rgba(245, 239, 226, 0.16)`.
- Signal Orange lifts to `#FF6B2B`; state colors may lift slightly for contrast.
- Preserve the warm palette. Avoid cold blue-grey panels and phosphor glow.

### 4.4 Texture and art-direction budget

- Paper grain is a static raster or CSS texture at 1.5–3% effective contrast. It
  may cover the canvas but must be imperceptible behind body text.
- Each workbench screen may use: one complete Translunar Band, one primary
  technical motif (short ruler, orbital arc, or dot field), up to two corner
  registration marks, and one local Umbra Ink title block.
- Decorative coverage should remain approximately 6–8% of the visible screen.
  Signal Orange remains below roughly 1.5%; the full stripe band below 0.8%.
- Decoration line weight is normally 1px at 8–14% opacity. Primary structural
  dividers may rise to 30–38% opacity.
- The main grid's source/target cells contain no decorative texture or graphics.
  Grid headers and outer gutters may carry a restrained edge treatment as long as
  it does not resemble a control or data value.
- Do not combine a ruler, multiple orbit systems, four corner marks, and a large
  dot field on one screen. The art layer needs a focal hierarchy, not accumulation.

### 4.5 Dot matrix

The regular circular dot matrix visible in the primary visual anchor is a formal
Translunar texture for filling otherwise inert chrome space.

- Use a strict orthogonal matrix, never a random star field. Recommended desktop
  construction: 1–1.5px dots on an 8–10px pitch.
- Light surfaces use Umbra Ink at 10–16% opacity; dark surfaces use Mission Paper
  at 10–14%. The matrix remains lower contrast than every border and label.
- Place it in clipped, non-reading zones: the unused half of a panel header,
  outside gutters, preview margins/handles, footer end caps, or empty-state fields.
- It may appear in up to three small fields on a workbench when they align to the
  same structural grid. Combined coverage remains below roughly 3% of the screen.
- A field should end at a panel edge, crop, mask, or tonal block; do not scatter
  isolated dots around controls.
- Never place dots behind source/target text, match text, form labels, QA evidence,
  menus, or focus rings.
- Dot matrices are static. A page transition may reveal a field once with a short
  mask wipe, but dots do not shimmer, scroll, pulse, or change density continuously.

## 5. Typography

- **Display: Space Grotesk** — implementation proxy for Lone Trail's geometric,
  space-age modernist display language. Use for screen titles, project names, key
  counts, and empty-state headings. The historical lineage includes Futura and
  ITC Avant Garde Gothic; do not claim the implementation font is the event's
  exact official typeface.
- **UI and body: Chivo** (fallback: Archivo) — navigation, forms, editable segment
  text, buttons, menus, tables, and help copy.
- **Mono: Space Mono** (fallback: JetBrains Mono) — segment IDs, match percentages,
  file counts, word/character counts, timestamps, and keyboard shortcuts.
- **CJK: Noto Sans SC / TC / JP / KR as appropriate** — minimum 14px in the editor;
  do not artificially widen CJK tracking in body or editable text.

Recommended desktop scale:

- Screen title: 26–32px / 1.1, 600–700 weight. Project/setup pages may use a
  cropped 36–44px display composition when it does not reduce working space.
- Section title: 16–18px / 1.3, 600 weight.
- UI/body: 14–15px / 1.45.
- Dense metadata: 12px / 1.35; never smaller than 11px.
- Editable source/target: 15–16px / 1.55, user-scalable.

Small uppercase labels are allowed when they carry useful information, for example
`SEGMENT 418`, `TM 96%`, `PAGE 7 OF 24`, or `3 QA ISSUES`. Pure typographic ornament
may use a cropped letterform, line, or number fragment only when it cannot be read
as product data. Do not add readable decorative labels such as `MODULE 02`,
`FLIGHT LOG`, `SYSTEM NOMINAL`, `FIG. 04`, or unexplained coordinate strings.

Banned fonts: Inter, Roboto, Arial as deliberate visual choices; Orbitron,
Audiowide, Eurostile Extended, or other sci-fi display clichés; generic serifs.

## 6. Desktop Layout

Design for Windows and macOS desktop, not for mobile. Prototype baseline is
`1440 × 900` (16:10). The minimum supported working viewport is `1180 × 720`.

### 6.1 Main workbench anatomy

1. **App bar, 64–72px**: an Umbra Ink surface with an asymmetric 280–360px identity composition containing
   the app mark and real project name, followed by the current document switcher,
   global search, Run QA, Export, and overflow/settings. The identity zone may use
   one cropped geometric/orbital gesture. Place the 5–6px Translunar Band along the
   lower edge. Do not put low-frequency engine configuration here.
2. **Editor toolbar, 48–52px**: segment status filters, match filter, in-file find,
   previous/next issue, and view options.
3. **Segment grid, fluid and dominant**: source and target columns, narrow segment
   ID/state column, optional narrow match-origin column.
4. **Suggestions panel, 390–430px**: tabs `Matches`, `Terms`, and `AI`. The active
   tab contains results for the selected segment. The AI provider/model selector
   belongs inside the AI tab or project settings.
5. **Document preview dock**: a P0 feature below the segment grid, limited to the
   grid width and never extending below Suggestions. The collapsed 30–34px handle
   shows `Document preview · Page 7 of 24`, zoom, and expand state. The expanded
   default is 180–220px and resizable from 120–320px. Prototype hero screens should
   show it expanded at least once so the feature cannot disappear from review.
6. **Status footer, 28–32px**: an Umbra Ink strip with warm text, document progress,
   selected segment, save/sync state, and word/character counts. A clipped dot
   matrix may occupy an unused end cap. Show only values the product can compute.

There is no persistent left file rail. The current document control opens a
popover with file name, type, segment progress, issue count, and search.

The grid must retain at least 420px visible height when preview is expanded. At
widths below 1180px, the Suggestions panel becomes an overlay drawer or can be
collapsed. The source/target grid remains usable; do not shrink editable text below
14px. Phone layouts are outside the product scope.

### 6.2 Setup and overview screens

- Use a contained width of 1120–1280px with an asymmetric 30/70 or 35/65 split.
- The narrow side may contain step progress, a strong orbital/line composition,
  isolated geometry suggesting deep-space scale, or a vertical Translunar Band.
  The main side contains real form content. This is an intentionally expressive
  surface, not a generic centered wizard.
- Three-step project creation uses plain labels:
  `1 Files & languages`, `2 Resources & AI`, `3 Review & create`.
- Do not use countdown copy (`T-3`, `LAUNCH`) for navigation or button labels.

## 7. Component Specifications

### 7.1 Segment grid

- Rows use hairline dividers, not cards. Default vertical padding is 10–12px.
- Segment IDs use mono numerals such as `418`, without decorative punctuation.
- State indicator: 7–8px square plus a textual tooltip/accessible label.
- Active row: Paper Shade fill and a 2px Signal Orange leading edge.
- Editable target cell has a visible focus boundary and enough internal padding for
  IME candidate windows.
- Tags are protected compact tokens labeled `1`, `2`, etc., with linked-pair
  highlighting. They are functional controls, not ornamental bracket glyphs.
- Confirmed, draft, untranslated, locked, and issue states must remain distinct in
  both light and dark themes.
- The grid contains no orbital arcs, crosshairs, halftone, stripes, diagonal lines,
  or decorative microcopy.

### 7.2 Suggestions panel

- The panel frame may be more art-directed than ordinary SaaS sidebars: one short
  Umbra Ink tab/header block, an asymmetric title baseline, a clipped corner, or a
  1px calibration edge is encouraged. The result content itself remains quiet.
- Follow the visual anchor's header composition: `Suggestions` sits inside a warm-
  black block with one diagonal/cut terminal; the remaining header width may use a
  low-contrast dot matrix. Tabs begin on the next row and are not merged into the
  decorative title block.
- **Collapse control — expanded state**: exactly one 32–36px icon button lives at
  the far right of the Suggestions header, preferably inside the dot-matrix field.
  It uses a single right-pointing chevron and the accessible name
  `Collapse Suggestions`. It is a compact square/rectangular control with a 4–6px
  radius, not a floating pill and not an overlay between the grid and panel.
- **Collapse control — collapsed state**: the panel leaves a 36–40px rail attached
  to the right window edge. The rail preserves the header's ink/dot treatment and
  contains exactly one left-pointing chevron with the accessible name
  `Open Suggestions`. Do not show both directions at once.
- The control never covers segment content, panel cards, the divider, or document
  preview. It remains in the same logical header position in both states so the
  spatial relationship is obvious.
- **Matches**: match percentage, source library, source and target, word-level diff,
  metadata, and an explicit Insert action/shortcut.
- **Terms**: source term, approved target, status such as preferred/forbidden,
  definition or note when available, and source termbase.
- **AI**: provider/model, grounded inputs summary, generated suggestion, streaming
  state, Replace/Insert/Diff actions, and a visible machine-origin label.
- Never imply grounding with copy such as “grounded” unless the actual injected TM,
  terms, style instructions, or document context can be inspected.
- Empty states explain why no result exists and what action may fix it. Example:
  `No matches above 70%` with `Lower threshold`—not themed prose.

### 7.3 Document preview dock

- Collapsed height 30–34px; expanded default 200px; user-resizable 120–320px.
- The title bar includes file name, page position, previous/next page, zoom,
  `Follow active segment`, pop-out, and collapse.
- The active segment is located in the rendered document with one low-saturation
  orange outline or wash. Clicking preview content navigates to its segment.
- Opening preview preserves target-cell focus and the active grid row. If space is
  insufficient, reduce preview height before reducing editor typography.
- DOCX, HTML, and Markdown preview their real document structure. Unsupported or
  degraded formats explain the limitation; never display a fake page.
- The preview handle may carry a short compressed five-color band and fine ruler
  ticks. The document page itself carries no decorative overlay.

### 7.4 Buttons and controls

- One primary action per surface. Signal Orange fill, 4–6px radius, no glow.
- Secondary actions use an ink border or text treatment. Destructive actions use
  Error Red only after clear confirmation.
- Pressed feedback: translate by 1px and darken slightly. Focus ring: 2px Signal
  Orange with a visible offset.
- Minimum hit target is 32px for dense desktop controls and 40px for primary form
  actions. Icon-only buttons require tooltips and accessible names.
- Chips are reserved for filters, tags, and compact metadata. Do not turn every
  navigation item or button into a pill.

### 7.5 Panels, cards, and tables

- Use cards only when a contained object benefits from grouping, such as a TM
  match or attached resource. Dense lists use dividers and aligned columns.
- Default radius: 4px inputs, 6px buttons, 8px panels. No oversized 24–40px cards.
- Shadows are minimal and tinted warm; popovers and dialogs may use one elevation
  level. Persistent panels rely on borders, not floating shadows.
- A single 45-degree corner cut is allowed on one large brand surface per screen,
  never on every control.

### 7.6 QA and validation

- QA uses real severity and issue copy: `Error`, `Warning`, `Info`, rule name,
  affected segment, source/target evidence, and actions such as `Go to segment`,
  `Fix`, or `Ignore with reason`.
- Example: `Number mismatch: source contains “30”; target contains “60”.`
- A low-opacity diagonal pattern may appear only on the narrow leading edge of a
  blocking error banner. Do not use hazard stripes as general decoration.
- Export review clearly distinguishes blocking errors from warnings and states
  what will happen next.

### 7.7 Loading, empty, and error states

- Loading uses skeletons matching the final layout. Progress bars show determinate
  progress only when the value is known.
- Empty states contain one concise explanation and one next action. They are a
  high-expression zone: large achromatic fields, an isolated geometric object,
  an orbital line, or distant small type may evoke deep-space scale and solitude,
  but never replace the explanation or invent lore.
- Error states preserve user work, state what failed, and provide a recovery path.
  Avoid dramatic “ABORT” or “MISSION FAILED” language.

## 8. Content and Prototype Data Rules

### 8.1 Copy style

- Clear, compact, domain-accurate, and action-led.
- Use sentence case for English UI. Reserve uppercase for short metadata or status.
- Buttons describe the result: `Create project`, `Continue`, `Run QA`, `Confirm
  segment`, `Export DOCX`, `Insert suggestion`.
- Avoid slogans, lore, mood text, fake quotes, “system” chatter, and ornamental
  captions that do not help complete a task.
- Ban generic AI marketing copy: “Elevate,” “Unleash,” “Seamless,” “Next-gen,”
  “Intelligent workflow,” “Mission accomplished,” or “Ready for launch.”

### 8.2 Realistic content fixture

Use this shared fixture across prototype screens so the product state stays
coherent:

- Project: `Craft Contracts 2026`
- Language pair: `English (US) → Chinese (Simplified)`
- Current file: `Master Services Agreement.docx`
- Other file: `Appendix A – Services.docx`
- Current file totals: `1,248 segments` — `774 confirmed`, `401 draft`,
  `73 untranslated`, `3 QA issues`; confirmed progress `62%`
- Translation memory: `Legal EN–ZH` — `128,436 segments` — writable
- Termbase: `Contracts Terms` — `2,315 terms`
- Engine label: use a provider name or `OpenAI-compatible endpoint`; do not invent
  unreleased model versions, quality badges, or unsupported “recommended” claims.
- Active source: `The Supplier shall maintain commercially reasonable
  administrative, technical, and physical safeguards.`
- Active target: `供应商应采取商业上合理的管理、技术和物理安全措施。`
- QA example: source `The retention period is 30 days.` / target
  `保留期为 60 天。` / issue `Number mismatch: 30 → 60`.

These values are prototype fixtures, not product promises. If a screen shows only
part of the fixture, its visible numbers must still remain consistent.

## 9. Motion and Interaction

Motion is an art-direction layer with four time scales:

- **L0 micro feedback, 70–100ms** — hover, press, focus, shortcut acknowledgement.
- **L1 state change, 120–160ms** — selection, confirmation, save, filters, tabs.
- **L2 local space, 180–240ms** — preview, Suggestions panel, popover, drawer.
- **L3 workspace/page, 240–320ms** — document switching and workbench transitions.
  Low-frequency project/setup pages may extend to 360–480ms when a graphic line or
  color band leads the composition. No workbench action waits for the animation.

Motion tokens:

```text
motion-in    cubic-bezier(.16, 1, .3, 1)
motion-move  cubic-bezier(.2, .8, .2, 1)
motion-out   cubic-bezier(.4, 0, 1, 1)
```

Specific behavior:

- **Document preview**: container enters from the bottom in 220ms; document content
  fades in 60ms later over 120ms. Close in 160ms. Resizing follows the pointer with
  no easing; release snap is at most 100ms. Focus and active row do not move.
- **Suggestions panel**: open with 12px translation + fade over 200ms; close over
  150ms. Tabs use 80ms old-content fade followed by 120ms new-content fade and a
  4px shift. Collapse uses one stateful header button: fade panel content over
  100ms, resolve the grid to its final width immediately, then visually transition
  the panel shell into the 36–40px rail over 180–200ms using a FLIP/transform
  treatment. Reopening reverses the relation. The chevron changes only after the
  target state is committed. Keyboard focus changes immediately, not after animation.
- **Segment confirmation**: square state fill 100ms, orange guide contracts over
  140ms, row surface settles over 160ms. Advance focus only after persistence
  succeeds and never during IME composition.
- **QA navigation**: nearby targets scroll over 160–180ms. Distant targets jump near
  the destination, then receive a 120–220ms location highlight; never perform a
  long cinematic scroll through hundreds of rows.
- **AI generation**: append readable phrases or semantic chunks with a 60–80ms
  fade. Do not simulate per-character typing. A 2px progress rail may loop only
  while a request is genuinely active and disappears within 140ms on completion.
- **Document switching**: preserve toolbar, columns, preview frame, and panel
  geometry. Fade old grid content over 100ms and new content over 160ms; directional
  movement is at most 8px. The Translunar Band may perform one 240ms brightness
  sweep after successful load, then remain static.
- **Page-level Lone Trail transition**: retain the previous canvas at about 70%
  visual strength while the new layer enters from 16–24px away. A diagonal line,
  orbit stroke, or color band may arrive 40–60ms ahead of content and then become
  static. Returning reverses the spatial relationship.

Looping is allowed only for real ongoing operations such as AI generation, import,
export, or batch QA. Background orbits, stripes, grain, status lamps, active rows,
decorative text, and starbursts never loop. Static texture is preferred to animated
noise.

During `compositionstart` → `compositionend`, do not confirm, insert suggestions,
run global shortcuts, move focus, change panel, or animate target-cell height.

Respect `prefers-reduced-motion` and provide an application-level equivalent.
Reduced Motion replaces movement, scale, stroke drawing, and smooth long scrolling
with immediate state changes or 0–100ms crossfades while preserving focus, errors,
save state, and other functional feedback.

Animate `transform` and `opacity` by default. Run at most two major animations at
once, cancel superseded transitions instead of queueing them, target 60fps, and
test with a 10,000-segment virtual list, 125% text scaling, Suggestions open, and
document preview expanded.

## 10. Accessibility and Platform Behavior

- Meet WCAG AA contrast for text and controls. Validate the warm palette rather
  than assuming it passes.
- Full keyboard access is mandatory. Focus must remain visible on the active cell,
  tabs, menus, filters, document switcher, and dialog actions.
- CJK IME composition must not trigger shortcuts or move focus. Leave sufficient
  room around editable cells for candidate windows.
- Support application font scaling without clipping. At 125% scaling, the grid and
  Suggestions panel must remain operable.
- Do not rely on hover for essential information. Tooltips supplement labels; they
  do not replace required text.

## 11. Prototype Acceptance Checklist

A generated or hand-built prototype is acceptable only if:

- It looks like translation software before it looks like a space console.
- The active source/target pair is immediately identifiable.
- Project, file, status, QA, TM, termbase, and AI labels use real CAT language.
- The segment grid remains the dominant and least decorated area.
- The screen has a deliberate Lone Trail composition beyond standard controls:
  deeper warm paper, asymmetric hierarchy, and a controlled geometric/line motif.
- Dot matrices appear only as clipped, grid-aligned chrome fields and never behind
  readable content.
- All visible counts and progress values are internally consistent.
- The Translunar Band appears once, in the fixed five-color order, without being
  confused with status colors.
- No decorative sentence, fake metric, unexplained code, or nonfunctional gauge is
  needed to make the screen feel designed. Pure graphic decoration is welcome when
  it cannot be mistaken for product information.
- Document preview appears in at least one primary workbench prototype and behaves
  as a real linked, resizable P0 surface.
- The Suggestions collapse control is a single stateful header/rail button. No
  floating double-chevron capsule appears between the grid and sidebar.
- The screen could be implemented with standard desktop components and real product
  data without inventing backend capabilities.

## 12. Banned Patterns

- No decorative mission copy or replacement of established CAT terminology.
- No fake telemetry, system chatter, meaningless gauges, or random percentages.
- No NASA logo imitation, mission patches, astronaut imagery, starscapes, planets
  as backgrounds, or spacecraft cockpit framing.
- No purple/blue neon, holograms, glow, chrome bevels, glassmorphism stacks,
  scanlines, or greeble clutter.
- No gradients as decoration; the Translunar Band uses flat adjacent colors.
- No ornament behind readable/editable text and no decorative overlay inside the
  segment cells. Chrome, gutters, panel headers, preview handles, and empty states
  are explicitly allowed to be art-directed.
- No giant centered hero layout for desktop workflows.
- No three equal marketing cards, oversized KPI cards, or dashboard content without
  a user decision attached.
- No generic names such as Acme or John Doe, fake round numbers, or invented model
  versions.
- No circular spinners, bare `No data`, emoji icons, custom cursors, or pill-shaped
  everything.
- No generic near-white SaaS treatment that removes paper depth, asymmetric
  composition, graphic linework, and the Translunar Band in the name of restraint.
