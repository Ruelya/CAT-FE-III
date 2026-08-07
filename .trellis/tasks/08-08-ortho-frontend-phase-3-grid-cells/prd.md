# ORTHO Phase 3 — Grid and Cells

## Status

- Scope: `docs/design-ii/09-implementation.md` §4, Phase 3 only
- Intended implementation branch: `implement/ortho-frontend`
- Delivery type: frontend expression and interaction refactor
- Dependencies: Phase 0–2 shell, Masthead, FilterRail, DocumentMatrix, and ActiveAxis are complete and remain in place

## Goal

Deliver the Phase 3 workbench segment grid as a dense, keyboard-complete translation surface: plate-and-seam rows, eight shape-coded status lamps, an IME-safe target editor, functional protected-tag capsules, roving grid navigation, multi-selection with batch actions, and inline QA.

The change must preserve the existing translation, persistence, and navigation contracts. `Workbench` remains the orchestration owner; Phase 3 changes how existing state and commands are presented and connected, not how the engine, contracts, drafts, or editor commands work.

## User outcomes

1. A translator can identify each segment state without relying on color alone.
2. Focusing or navigating a target cell always moves the single ActiveAxis to that row.
3. CJK composition is never interrupted by confirmation, navigation, overlays, autocomplete, animated resizing, or premature draft writes.
4. Protected tag pairs and structural errors are visible and operable without exposing raw XML.
5. The complete grid flow is usable from the keyboard, including range selection and batch actions.
6. QA findings are visible at the affected row and can use the existing locate/ignore paths without duplicating business logic.
7. Existing windowed rendering remains bounded for large documents.

## In scope

### R1. Row geometry and status expression

- Replace card-like row treatment with rigid plate-and-seam geometry: no row margins, card radii, or persistent shadows; row and cell hierarchy uses the existing design tokens and three documented seam weights.
- Keep the current ID, status, source, and target information architecture. Do not add an unbacked match-source column or synthetic data.
- Rows use the documented minimum height and grow with source/target content.
- Render one accessible 8px status lamp with shape, color, and localized text for each presentation state:
  - untranslated: hollow square;
  - draft: half-filled square;
  - confirmed: solid square;
  - reviewed: solid square with clipped upper-right corner;
  - signed: solid square with outer frame;
  - QA error: solid square with cross;
  - QA warning: solid square with diagonal slash;
  - locked: solid square with center bar.
- Use existing segment/workflow/QA data to derive lamp presentation. Presentation precedence is error, warning, locked, signed, reviewed, confirmed, draft, untranslated; this mapping must not alter stored state.
- Show the row action rail only while the row is hovered or contains focus. Anchor its 24px rail on the source/target inter-column seam and expose exactly the primary best-match insertion, comment, and More entry points. Existing secondary commands remain reachable through the existing menu and shortcuts.
- Do not add decorative copy, telemetry, texture, watermark, badge, or ornamental geometry inside source or target cells.

### R2. Target cell, focus, and IME contract

- Keep the existing target draft value, update, save, confirm, and disabled/signed behavior.
- Use the supported native `field-sizing: content` behavior so the target editor grows with content. Preserve a standards-safe fallback based on the current textarea behavior.
- Preserve editable text at 14px or larger and `scroll-margin-block: 96px`; keep at least 8px between the editor and the first clickable QA control.
- Target focus activates/selects its segment before any dependent UI update. The row remains the sole grid ActiveAxis perch; no second axis or competing orange focus marker is introduced.
- Continue using the global `useComposition` guard plus the existing per-segment composition tracking. Every Phase 3 key handler must return before acting when the global guard, `event.isComposing`, or key code 229 indicates composition.
- Between `compositionstart` and `compositionend`, Phase 3 must not confirm, navigate, change selection, move a tag, open/close an overlay, show autocomplete, animate row/editor size, run input-driven QA reflow, or schedule a draft write.
- On `compositionend`, retain the exact composed value and resume the existing deferred draft-save behavior at 400ms.
- Preserve the registered leave guard and `persistAllSegments` path; Phase 3 must neither bypass nor duplicate them.

### R3. Protected-tag capsules

- Reuse the existing protected-tag metadata, target positions, tag issue list, and tag mutation callbacks; do not parse XML or change contract shapes.
- Present source and target tags as compact functional capsules using existing display text and pair identity. Do not show raw XML or literal angle-bracket markup.
- Hovering or focusing either member of a pair highlights both members with the documented signal wash/border.
- A source tag missing from the target receives the error treatment; target order mismatches receive the warning treatment. Existing tag issue messages feed inline QA.
- Keep tags atomic for keyboard operations. When a target capsule is selected, `Alt+Left` and `Alt+Right` call the existing move operation once, retain row activation/focus, and do nothing while composing or locked/signed.
- Preserve the existing F9, copy-tag-structure, and tag navigation command paths; do not reimplement editor command semantics.
- Retain the textarea/draft model. Phase 3 must not replace it with `contenteditable` or an overlay editor merely to interleave capsules with text.

### R4. Roving grid navigation

- Add `apps/desktop/src/renderer/hooks/useRovingGrid.ts` as the single keyboard/focus coordinator for the segment grid.
- Expose the grid as `role="grid"` with rows and cells carrying deterministic IDs and correct row/column metadata.
- The grid occupies one normal Tab stop. On entry, the active row’s target cell is the navigation target.
- Navigation mode:
  - Up/Down moves by row;
  - Left/Right moves by cell;
  - Enter enters target edit mode;
  - navigation can request the existing virtualized seek path when the destination is outside the mounted window.
- Edit mode:
  - focus is on the existing target textarea;
  - Escape returns to grid navigation without discarding the draft;
  - Tab advances to the next editable target cell;
  - Ctrl+Tab exits the grid to the next region.
- IME composition has priority over all roving-grid behavior.
- `aria-activedescendant` must reference a mounted element only; virtual-window navigation must seek/render before updating the reference.

### R5. Multi-selection and batch bar

- Row click outside the target editor selects and activates the row without forcing editor focus.
- Target click selects, activates, and focuses at the clicked caret location.
- Shift+Up/Down and Shift+click extend from an anchor. Ctrl+click toggles individual rows. Text selection within the target remains independent of row-range selection.
- Ctrl+Shift+A selects the current filter scope through the existing data/command capability; no new engine or contract query is introduced.
- Preserve the selection across filter changes and show the localized selected count, including the count hidden by the current filter when applicable.
- Multi-selection keeps the ActiveAxis only on the anchor row; other selected rows use the documented neutral selected treatment.
- Escape clears multi-selection and leaves the Axis on the anchor row.
- When multiple rows are selected, show a 36px plate-style batch bar at the grid top with selected count and the existing Confirm, Clear target, Lock, Pretranslate, Add comment, and Cancel selection actions.
- Batch actions are adapters to existing command/RPC paths. They must honor current enabled/locked/signed rules. Destructive or overwriting actions require the existing confirmation/preview policy and use the existing undo/history path where available.

### R6. Inline QA strip

- Render existing segment QA and tag issues in a plate-style strip below the source/target editing area, not as a card and not as decorative badges.
- Encode severity by icon, localized accessible text, and existing severity token; do not rely on color alone.
- Provide localized Locate and Ignore entry points only where the existing issue callbacks support them. Ignore must retain the existing reason requirement.
- Keep issue identity and messages from the current QA data. Do not evaluate QA rules, synthesize findings, rewrite engine issue text, or remove the current QA Surface/Stack behavior scheduled for later phases.
- QA appearance must not steal editor focus or announce unchanged findings repeatedly.

### R7. Virtualization and performance

- Preserve the existing editor windowing and overscan behavior; never mount all rows for a 10,000-segment document.
- Add row measurement only as needed to reconcile content-sized target cells with virtual spacer and DocumentMatrix viewport calculations. Unknown/unmounted rows continue to use the existing estimated row height.
- Use one shared `ResizeObserver`/measurement cache rather than one observer per row, retain measurements by stable segment identity/ordinal, and avoid synchronous layout reads in each row render.
- Memoize row view models and row components so active, selection, and capsule-pair updates do not rerender the full mounted window unnecessarily.
- Preserve `content-visibility`, intrinsic-size, and containment protections from the approved design where they do not break focus.

### R8. Accessibility, copy, and localization

- Add every new user-facing or accessible string to the existing English and zh-CN message catalogs. Reuse existing strings before adding keys.
- All action buttons have localized accessible names and visible focus treatment. Status lamps have localized names for all eight shapes.
- Forced-colors mode must preserve status/selection distinctions; reduced motion disables row/editor transitions without removing state feedback.
- The Phase 3 grid has no axe serious violations.
- Copy remains concise and operational. Do not add marketing, explanatory subtitles, fake counts, decorative labels, or unsupported claims.

## Acceptance criteria

### AC1 — Geometry and row actions

- [ ] Rows visually form contiguous plates separated by approved seams, with no card gaps, persistent row shadows, or cell decoration.
- [ ] The action rail is absent from pointer interaction when hidden, appears on row hover/focus-within, and is centered on the source/target seam without covering editable text.
- [ ] The rail exposes best match, comment, and More; all existing secondary actions and shortcuts remain available.

### AC2 — Eight status lamps

- [ ] A component test renders all eight states and verifies eight distinct shape hooks plus localized accessible names.
- [ ] Removing color in forced-colors/emulation still leaves each state distinguishable by shape/text.
- [ ] Presentation mapping does not mutate segment, workflow, or QA state.

### AC3 — Target editor and ActiveAxis

- [ ] Multi-line target content grows the editor/row without an internal textarea scrollbar under supported Electron Chromium.
- [ ] Focusing any mounted target sets that segment active and results in exactly one Workbench `[data-axis="active"]`, on the active row.
- [ ] Target focus, confirm, draft update/save, signed disablement, document navigation, and the registered leave guard retain their pre-Phase-3 behavior.

### AC4 — Ten IME checks

The automated/electron test set covers all ten outcomes:

1. [ ] `Ctrl+Enter` does not confirm or advance during composition.
2. [ ] Global/panel shortcuts such as `Ctrl+K`, F8, and view toggles do not open or navigate during composition.
3. [ ] Escape does not exit edit mode, clear selection, or close a layer during composition.
4. [ ] Arrow/Alt navigation does not move the row, cell, selection, or protected tag during composition.
5. [ ] Matrix/automatic seek paths do not move editor focus while composition is active.
6. [ ] The composing target retains focus and caret ownership.
7. [ ] Autocomplete/ghost completion is absent for the composition interval.
8. [ ] Computed target/row transition and animation are disabled for the composition interval.
9. [ ] Input-driven draft persistence is not scheduled until `compositionend` plus the existing 400ms debounce.
10. [ ] The final composed text is preserved exactly and is persisted once through the existing draft path.

### AC5 — Tags

- [ ] Hover/focus on either pair member highlights both source and target members.
- [ ] Missing source tags and target order errors use distinct error/warning shape/style hooks and remain represented in inline QA.
- [ ] `Alt+Left/Right` invokes the existing tag move callback once for the selected capsule, preserves focus/Axis, and is suppressed for composition and locked/signed rows.
- [ ] Raw XML is never displayed, tags remain atomic, and existing F9/copy-structure behavior is green.

### AC6 — Roving grid keyboard flow

- [ ] The grid contributes one normal Tab stop; deterministic row/cell IDs and grid semantics are exposed.
- [ ] Tab entry, four-arrow navigation, Enter edit, Escape navigation, Tab next editor, and Ctrl+Tab exit work through mounted and virtual-window boundaries.
- [ ] `aria-activedescendant` never references an unmounted row/cell.
- [ ] The full keyboard path does not create a second ActiveAxis.

### AC7 — Selection and batch actions

- [ ] Click, Ctrl+click, Shift+click, Shift+Up/Down, Ctrl+Shift+A, and Escape follow the documented selection model.
- [ ] The anchor alone owns the ActiveAxis; other selected rows have the neutral selected treatment.
- [ ] Filter changes retain selection and report visible/hidden selected counts accurately.
- [ ] The localized 36px batch bar appears only for multi-selection, invokes existing action paths, respects disabled states, and confirms destructive/overwriting actions.

### AC8 — Inline QA

- [ ] Existing QA and tag issues render below the affected row editing area with icon, message, severity, and supported actions.
- [ ] Locate and reasoned Ignore use existing callbacks and restore/retain focus correctly.
- [ ] The strip keeps at least 8px candidate-window clearance and does not duplicate QA evaluation logic.

### AC9 — Accessibility and localization

- [ ] New visible and accessible strings exist in English and zh-CN with no hard-coded fallback copy in Phase 3 components.
- [ ] Keyboard-only use reaches every Phase 3 action and returns focus predictably.
- [ ] Targeted axe coverage reports no serious violations.

### AC10 — Large-document aspiration and non-regression

- [ ] A 10,000-segment trace records environment, mounted row count, and P95 frame time with the existing Stack/preview state used by the approved benchmark.
- [ ] The mounted DOM remains bounded by the existing window plus overscan; Phase 3 styling/selection never expands it to all 10,000 rows.
- [ ] The acceptance aspiration is P95 frame time at or below 33ms. Because frame timing is hardware-sensitive, the report must also compare the same-machine pre-change baseline; a material regression (greater than 10%) is a failure even when the absolute aspiration cannot be reproduced on that machine.

## Out of scope

- Reworking Phase 0–2 Shell, Masthead, FilterRail, DocumentMatrix, or ActiveAxis visuals/logic.
- Phase 4 Stack restructuring, match cards, term rows, assistant drawer, Grounding Inspector, or preview dock redesign.
- Engine, preload, RPC, `@translunar/contracts`, editor-command semantics, QA-rule evaluation, tag parsing/mutation semantics, or persistence format changes.
- Replacing textarea editing with `contenteditable`, a custom text engine, or overlay rendering.
- Reworking `useComposition`, draft journaling, `persistAllSegments`, or the leave-guard contract.
- New dependencies, fake telemetry, unbacked match-source data, deep-theme reconciliation, or global CSS redesign.

## Assumptions

- The current windowed loader and overscan are the approved base for the 10,000-segment target; Phase 3 adds measurement/non-regression coverage rather than replacing virtualization.
- Existing segment/workflow/QA/tag data is sufficient to derive the eight visual lamp states and tag error treatments without contract changes.
- Existing command/RPC paths can accept the selected IDs or current-filter scope needed by the documented batch actions; Phase 3 supplies UI adapters only.
- Existing QA callbacks retain locate and reasoned-ignore semantics.
- Electron 41 / Chromium 146 supports `field-sizing: content`; a conservative fallback remains for tests or unsupported runtime contexts.
- No external research is required; any uncertain callback name or test alias can be resolved by implementation-time code reading within the repository.
