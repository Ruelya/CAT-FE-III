# Workbench visual identity completion

## Goal

Close the approved Workbench design deviation, not merely add decorative
polish. The finished desktop Workbench must read as the Translunar CAT product
on both Windows and macOS while preserving the editor's long-session usability,
real CAT terminology, authoritative Engine behavior, IME safety, and panel
interaction contracts.

This is the second visual pass after `07-21-workbench-visual-polish`. That task
owns paint-level refinement; this task owns the remaining expression and
structural gap: local typography, branded loading/empty states, app-bar
identity/search, Suggestions hierarchy, quieter segment rows, truthful document
Preview hierarchy, and the 4/6/8 radius system.

## Evidence and source of truth

Authority order for visual decisions:

1. `docs/stitch/DESIGN.md` is the written source of truth.
2. `docs/ChatGPT Image 2026年7月17日 20_04_16.png` is the primary visual anchor.
3. `docs/frontend-design-deviation-report.md` and
   `.trellis/workspace/Ruelya/workbench-assistant-1250x744.png` describe the
   current implementation gap.
4. This PRD resolves execution details; it does not weaken the rules above.

Confirmed current facts:

- The broad Workbench composition already exists: warm paper/ink palette,
  Translunar Band, dominant segment grid, Suggestions, Preview, and status bar.
- The current UI still uses Windows-first system font stacks and 9-10px text in
  important chrome. The captured UI is visibly denser and more generic than the
  approved reference.
- The app bar has a real in-document search, while project-wide search already
  exists through the generated `search.global` contract on Project Home.
- Suggestions has the correct separate header/tabs structure, but its title
  block lacks the required cut terminal and its content reads too much like a
  generic assistant panel.
- The active segment exposes too many equally prominent micro-controls.
- PDF Preview can render a real page image. Non-PDF Preview currently presents a
  flat segment list and must not invent page numbers or document structure that
  the Engine/filter contracts do not provide.
- Radius values have drifted across `styles.css`; the approved semantic scale is
  4px inputs, 6px buttons, and 8px panels.

There are no blocking product decisions left in this task.

## Requirements

### R1 - Bundled local typography

- Bundle open-license WOFF2 assets locally and load the bundled face before any
  system fallback. There are no CDN requests and no Windows-only face is first
  in an intended stack.
- Use Space Grotesk for display, Chivo for UI/body, Space Mono for metadata, and
  Noto Sans SC for Simplified Chinese/editor content. Vendor the corresponding
  license text and record exact upstream version, source URL, SHA-256, included
  weights, and subsetting method.
- Keep arbitrary Simplified Chinese document content covered. A fixture-only
  glyph subset is prohibited. Unicode-range splitting is allowed only when all
  packaged chunks remain available offline.
- Total checked-in WOFF2 payload is at most 20 MiB. Report the measured font
  payload and packaged-app delta; if complete coverage cannot fit, return to
  planning instead of silently using an OS-dependent primary face.
- Workbench body/UI text is 14-15px, editable source/target is 15-16px, and dense
  metadata is at least 11px. User font scaling to 125% must not clip controls,
  CJK, or panel content.

### R2 - Exactly eight branded working states

Implement all three loading states and all five empty states below. They share a
small Workbench visual-state primitive, stable dimensions, one concise line of
domain-accurate copy, and a restrained existing brand motif. They do not use a
circular spinner, bare `No data`, an emoji, invented lore, or a new illustration
language.

Loading states:

1. TM match lookup for the active segment.
2. Assistant wait from accepted request until the first readable response chunk.
3. PDF page render.

Empty states:

1. No TM match.
2. No term hit.
3. No open QA issue.
4. No Assistant conversation/message yet.
5. No segment matches the current grid filters/search.

Loading skeletons match the final content geometry. A low-contrast
accent-tinted shimmer is allowed only as operation feedback; reduced motion
keeps the skeleton static. Existing recovery controls remain available. Empty
states expose one real next action where the product already supports one (for
example, clearing grid filters); they never add an inert decorative button.
Every state has a bounded accessible name/status and does not announce on every
animation frame.

### R3 - App-bar identity and real global search access

- Strengthen the 280-360px identity composition with the existing BrandMark,
  real project name, restrained orbital/registration geometry, and the single
  full Translunar Band. The identity must be unmistakable without crowding
  document controls or actions.
- Put project-wide search in the app bar as a prominent keyboard-accessible
  command backed by the existing generated `search.global` contract. Reuse or
  extract the existing safe snippet rendering and result behavior; do not fork a
  second search implementation.
- Selecting a global result flushes pending Workbench edits before opening the
  returned project/document/segment. Failure keeps the current Workbench and
  draft visible. The existing in-file search remains in the editor toolbar and
  keeps its accurate label.
- At compact supported width, identity, search, Run QA, Export, and overflow do
  not overlap; lower-frequency content yields before the grid typography shrinks.

### R4 - Suggestions structure and hierarchy

- Render `Suggestions` in the approved warm-ink title block with one cut terminal;
  place the low-contrast dot field and exactly one stateful collapse control in
  the remaining header area. Tabs stay on their own row.
- Preserve the existing docked/collapsed/maximized behavior, mounted/inert exit
  transition, focus handoff, and one-button rail contract.
- Matches, Terms, QA, and AI results use quiet hierarchy, readable metadata, and
  real provenance/actions. Assistant controls must not visually erase the CAT
  resource hierarchy.
- The cut corner is a single branded surface treatment, not a repeated control
  shape. No content, focus ring, or click target may occupy the clipped area.

### R5 - Quieter, more legible segment rows

- The active source/target pair remains the strongest visual focus. Rows remain
  divider-based, with a 2px active orange edge and square state lamp; no cards or
  decorative graphics are added to cells.
- Reduce equal-weight micro-control noise. Keep frequent actions immediately
  available as familiar Lucide icon controls with names/tooltips; group genuinely
  lower-frequency actions behind one labeled overflow menu without changing their
  command behavior.
- Preserve protected-tag controls, source/target text, error evidence, keyboard
  access, IME composition behavior, and save/confirm semantics.
- If row geometry changes, update the virtualization contract and test it with a
  10,000-segment fixture. No text, toolbar, or candidate-window area may be clipped.

### R6 - Truthful real-document Preview hierarchy

- Rebuild the Preview as a clear document surface: strong handle/title bar,
  document identity, truthful position, grouped document controls, thumbnail or
  structure rail, paper/page canvas, and an unmistakable active-segment location.
- PDF keeps its actual rendered page image, page count, and extracted block
  relationship. PDF render uses the R2 loading state and preserves error/recovery.
- DOCX/HTML/Markdown/TXT use ordered Engine-provided segments and structural paths
  to create a document-like reading hierarchy. Do not claim a page number,
  heading, table, or layout relation that the current contract cannot prove;
  non-paginated/degraded formats show truthful segment/section position and the
  limitation when necessary.
- Preview content can navigate to a real segment, preserves target focus when
  opened, and retains the existing docked/collapsed/maximized and 120-320px resize
  contracts. Decorative treatment stays in the handle/margins, never over the
  document text.

### R7 - Token convergence

- Radius source of truth is exactly `--radius-input: 4px`,
  `--radius-button: 6px`, and `--radius-panel: 8px` for rectangular UI. True
  circles and the 0-1px square status-lamp treatment are explicit semantic
  exceptions; 3/5/7/9px drift is removed rather than preserved as hidden aliases.
- Introduce the approved spacing scale 4/8/12/16/24/32 and migrate Workbench
  app bar, toolbar, segment rows, Suggestions, Preview, states, and dialogs.
  Record intentional raw geometry values that are not spacing tokens.
- Raise sub-11px metadata in the Workbench surfaces covered by this task. Do not
  shrink type to repair overflow.
- Apply light/dark parity and preserve the visual-polish tokens already landed.
  Token migration is mechanical and screenshot-gated separately from structural
  work.

### R8 - Accessibility, performance, and visual evidence

- Meet WCAG AA for text, controls, and focus indicators in light and dark themes.
  Status is never color-only; icon controls have accessible names and tooltips.
- `prefers-reduced-motion` disables shimmer movement and structural motion without
  hiding busy/success/error information.
- The segment grid remains at least 60% of usable Workbench width in the normal
  docked composition and remains operable at 125% font scaling.
- Test 1250x744, 1680x942, and 1920x1080 in light/dark. There is no document-level
  horizontal overflow, overlap, clipping, renderer console error, or text escaping
  a control.
- Capture named before/after screenshots for default Workbench, each of the eight
  working states, Suggestions modes, Preview modes, and the compact Assistant view.

## Acceptance criteria

- [ ] AC1: Packaged Space Grotesk, Chivo, Space Mono, and Noto Sans SC are the
      primary rendered faces on Windows and macOS; licenses/provenance are
      vendored, arbitrary SC text is covered offline, and WOFF2 payload is within
      20 MiB with measured evidence.
- [ ] AC2: All 3 loading and 5 empty states are individually reachable, named,
      screenshot-covered, stable in size, dark-theme correct, and static under
      reduced motion.
- [ ] AC3: App bar contains the approved identity composition and real
      project-wide search access; search-result navigation flushes edits and
      opens the returned project/document/segment without duplicating snippet
      parsing or Engine-owned search rules.
- [ ] AC4: Suggestions has the cut-corner title/dot-field hierarchy and keeps its
      single-button collapse/rail, focus, tabs, and panel-mode contracts.
- [ ] AC5: Segment rows are quieter and readable at all three viewports and 125%
      font scaling; active source/target remains dominant, all commands remain
      keyboard reachable, and a 10,000-row fixture retains correct virtualization.
- [ ] AC6: Preview reads as a document surface, shows truthful PDF/page or
      non-paginated segment position, locates/navigates the active segment, and
      preserves focus, resize, and panel modes without fake structure.
- [ ] AC7: Rectangular UI uses the 4/6/8 semantic radius tokens with only documented
      circle/square exceptions; covered Workbench metadata is at least 11px and
      spacing uses the approved scale.
- [ ] AC8: WCAG AA/manual keyboard/CJK IME checks pass in light and dark themes;
      no state is color-only and no motion is required to understand progress.
- [ ] AC9: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
      `pnpm build:desktop`, and `pnpm test:e2e:desktop` pass on the supported Node
      lane, with no renderer console/page errors and approved screenshot evidence.

## Out of scope

- Rebranding setup, Project Home, Insights, QA Review, or Export Review beyond
  shared token/font effects required for consistency.
- A new document-layout/reflow Engine API or fabricated reconstruction of DOCX,
  HTML, or Markdown pagination. A future richer preview contract may add faithful
  layout data, but this task must remain truthful with current data.
- Region-specific TC/JP/KR font forms beyond the approved EN-US -> zh-CN
  Workbench acceptance fixture. System fallbacks remain available for unsupported
  locale-specific forms; expanding packaged locale coverage requires a measured
  follow-up compatibility decision.
- Changes to translation, QA, TM, termbase, Assistant generation, or persistence
  business rules.
- Mobile layouts, a new illustration language, remote font delivery, or animated
  decorative background effects.

## Delivery and scheduling

- Recommended Trellis parent is `07-19-platform-packaging-product-shell`, so
  visual release evidence rolls into the full-PRD platform/release path. The
  current `task.json` intentionally remains `parent: null` during this planning
  pass; the main session should link it only after confirming no concurrent task
  metadata edit. Apply the same ownership decision to visual-polish separately,
  outside this task's file ownership.
- `07-21-workbench-visual-polish` must be checked, committed, and archived before
  this task starts. Preserve its paint tokens and confirm-flash behavior.
- Keep all sequential work packages in this task; do not create one child task per
  visual slice. Each package has its own focused verification and rollback point
  in `implement.md`.
- Shared renderer files are edited by one implementation worker at a time. Font
  provenance/size research and screenshot review may run in parallel when they do
  not modify the same files.
- Keep task status `planning` until the final planning summary receives fresh
  implementation approval and `task.py start` is run by the main session.
