# Implementation Plan — ORTHO Phase 3 Grid and Cells

## Guardrails

- Work on `implement/ortho-frontend` as directed for this phase.
- Implement Phase 3 only. Do not rework completed Phase 0–2 components or start Phase 4 Stack/preview work.
- Do not change engine, preload, RPC/contracts, editor-command semantics, QA evaluation, draft persistence format, `useComposition`, or the leave-guard contract.
- Keep `Workbench.tsx` as orchestrator. New files target 400 lines or fewer.
- Reuse existing tokens, helpers, callbacks, strings, and tests before adding equivalents.
- Keep every intermediate step typecheck/testable; do not land a window that mounts the full document.

## Ordered checklist

### 1. Establish invariants and callback inventory

- [ ] Read the complete existing definitions used by the current row block: status/tag render helpers, target/composition handlers, navigation/window loader, Matrix seek/scroll, editor command adapters, issue actions, and batch-capable operations.
- [ ] Record the current window size/overscan, mounted row count, active/Axis count, target focus behavior, and draft-save timing before extraction.
- [ ] Confirm the exact English/zh-CN message catalog structure and existing reusable keys.
- [ ] Confirm which existing command/RPC adapter accepts explicit selected IDs or current-filter scope for Confirm, Clear target, Lock, Pretranslate, and Add comment. If any documented action lacks an existing path, stop widening and report the exact missing adapter to the Orchestrator.
- [ ] Add/retain characterization tests for target `onChange`, composition start/end, 400ms save scheduling, confirm/advance, signed disablement, Matrix focus retention, and leave-guard persistence before moving markup.

**Risk checkpoint:** no component extraction starts until Workbench’s existing handlers and batch adapters are identified. This is repository reading, not external research.

### 2. Build the presentational row projection in Workbench

- [ ] Add a memoized join that maps each loaded `editorRow`/segment to one Phase 3 row view, avoiding per-row `findIndex`/`find` scans inside render.
- [ ] Derive the eight-state lamp presentation from existing workflow/QA data with precedence: error, warning, locked, signed, reviewed, confirmed, draft, untranslated.
- [ ] Normalize existing source/target pair identity and tag-issue presentation without parsing text/XML.
- [ ] Normalize existing QA/tag issues into display-only finding views with supported action flags.
- [ ] Wrap existing activation, draft, composition, tag, menu, QA, and batch handlers in stable callbacks; do not move their effects into components.
- [ ] Keep `axisResidence`, DocumentMatrix state projection, leave guard, drafts, pending saves, and command dispatch in Workbench.

**Validation:** existing Workbench tests remain green before replacing the inline row block.

### 3. Extract SegmentGrid and SegmentRow without semantic changes

- [ ] Create `SegmentGrid.tsx` with the existing header, current four columns, window offset/total, top/bottom spacers, loading/empty integration, forwarded grid ref, and row mapping.
- [ ] Create `SegmentRow.tsx` and initially move the existing ID/status/source/target/textarea/tag/issue/action markup with callback behavior unchanged.
- [ ] Replace the inline Workbench table/render block with `SegmentGrid` while leaving surrounding FilterRail, DocumentMatrix, preview, plugins, SuggestionsPanel, and Workbench orchestration untouched.
- [ ] Ensure each new production file remains under the 400-line target; split pure lamp/tag/QA/batch responsibilities rather than moving Workbench effects.
- [ ] Add component characterization tests proving extracted callbacks fire exactly as before.

**Validation:** typecheck and targeted Workbench/component tests after the extraction, before visual/keyboard changes.

### 4. Apply plate/seam row geometry and eight status lamps

- [ ] Convert the extracted grid DOM to one semantic `role="grid"`, one header row, deterministic row/cell IDs, correct row/column metadata, and CSS-grid row layout.
- [ ] Apply contiguous plate/seam styling using existing tokens: no row gaps, card radii, persistent shadows, literal colors, or cell decoration.
- [ ] Create `SegmentStatusLamp.tsx` as a pure eight-state renderer with one localized accessible name and one distinct CSS shape per state.
- [ ] Add forced-colors rules that retain hollow/half/solid/clipped/framed/cross/slash/bar distinctions.
- [ ] Move the active-row action rail to the source/target seam; hidden state must remove pointer interaction.
- [ ] Limit the visible rail to best match, comment, and More, reusing current handlers/menu/shortcuts for all secondary commands.
- [ ] Verify the rail does not cover source/target text at supported densities and widths.

**Validation:** lamp matrix test, row geometry hooks, focus-within action availability, forced-colors inspection, and no duplicate/hard-coded accessible copy.

### 5. Add target field sizing while preserving IME/drafts

- [ ] Add `field-sizing: content`, approved minimum block size, 14px-or-greater editable text, and `scroll-margin-block: 96px` to the target editor.
- [ ] Keep the current textarea `value`, placeholder, disabled state, focus activation, draft update, composition callbacks, target key dispatcher, autocomplete acceptance, and save scheduling.
- [ ] Add the existing design’s `html[data-composing]` rule to disable transition/animation on the target and row.
- [ ] Ensure autocomplete is not rendered/updated for a composing segment.
- [ ] Ensure target focus activates the segment before dependent UI and that only the row renders ActiveAxis.
- [ ] Ensure candidate-window clearance is at least 8px before interactive QA actions.
- [ ] Do not introduce `contenteditable`, overlay editing, a second draft timer, or a second composition singleton.

**Validation:** target growth test plus IME checks 1–3, 6–10; existing draft, confirm, signed, and leave-guard tests remain green.

### 6. Implement protected-tag capsule expression

- [ ] Create/reuse a `TagCapsule` component with approved compact geometry, existing display text, atomic button semantics, pair identity, and localized accessible labels.
- [ ] Share one highlighted pair key within `SegmentRow`; hover/focus from either source or target applies highlight state to both members.
- [ ] Map existing missing issues to error treatment on the corresponding source capsule.
- [ ] Map existing order issues to warning treatment on affected target capsules.
- [ ] Keep target capsules as ordered sibling controls in the target cell so the textarea/IME/draft model is unchanged.
- [ ] Route Alt+Left/Right on a selected target capsule to the existing move callback exactly once; retain focus/Axis after reorder.
- [ ] Return before tag navigation/move when global/native/keyCode composition guards apply or the row is locked/signed.
- [ ] Keep existing F9, copy-tag-structure, insertion, and Ctrl tag-navigation handlers reachable; do not duplicate their mutation logic.
- [ ] Ensure no raw XML or literal angle-bracket tag markup is generated.

**Validation:** pair highlight from both sides, missing/order style, Alt movement, lock/composition suppression, and existing tag command tests.

### 7. Add `useRovingGrid.ts`

- [ ] Implement navigation coordinates, edit mode, active descendant ID, and focus restoration in the hook without importing engine/contracts or executing business commands.
- [ ] Make the grid root the only normal Tab stop; set the active row’s target as entry destination.
- [ ] Add Up/Down/Left/Right navigation and Enter-to-edit.
- [ ] Add Escape-to-navigation preserving the draft, Tab-to-next-editable-target, and Ctrl+Tab-to-next-region.
- [ ] Skip locked/signed targets for edit advancement while retaining navigation/readability.
- [ ] Add a virtual seek handshake: request the existing Workbench seek, wait for destination mount, then update `aria-activedescendant`/focus.
- [ ] Guarantee `aria-activedescendant` references a mounted node only.
- [ ] Put the composition-first guard before preventDefault or any roving/edit/selection action.

**Validation:** hook/component tests across normal and virtual boundaries, including IME checks 3–5 and a single ActiveAxis assertion.

### 8. Add multi-selection and BatchBar

- [ ] Add explicit-ID and current-filter selection intent with a stable anchor; do not render hidden rows to represent selection.
- [ ] Implement plain row click, target click, Ctrl+click toggle, Shift+click range, Shift+Up/Down range, Ctrl+Shift+A current-filter selection, and Escape clear.
- [ ] Keep target text selection independent from row-range selection.
- [ ] Preserve selection on filter change and derive localized visible/hidden counts from existing filter data.
- [ ] Keep ActiveAxis on the anchor only; apply neutral selected treatment to all other mounted selected rows.
- [ ] Create `BatchBar.tsx` as a 36px ink plate at the grid top, visible only for multi-selection.
- [ ] Wire localized Confirm, Clear target, Lock, Pretranslate, Add comment, and Cancel through Workbench’s existing adapters.
- [ ] Reflect current enablement/locked/signed rules and existing progress/error feedback.
- [ ] Route destructive/overwriting actions through existing confirmation/preview and undo/history paths; do not implement mutation loops inside BatchBar.

**Validation:** selection model tests, filter retention/hidden count, anchor Axis, action enablement/callback payloads, confirmation handoff, and bounded render counts.

### 9. Add InlineQaStrip

- [ ] Create `InlineQaStrip.tsx` to render normalized existing QA and tag findings under the source/target area.
- [ ] Use plate/seam geometry, severity icon/text, existing message, and localized region/action names; do not use cards or decorative badges.
- [ ] Render all supplied findings without silently truncating their identity/message.
- [ ] Wire Locate and reason-required Ignore only when existing callbacks advertise support.
- [ ] Preserve editor focus or return it through the existing focus path after an action.
- [ ] Avoid assertive repeated announcements and do not run/rewrite QA rules.
- [ ] Leave current QA Surface/Stack behavior untouched for later phases.

**Validation:** finding/severity/action component tests, focus retention, 8px editor clearance, and no duplicate QA evaluation.

### 10. Reconcile variable row heights with existing virtualization and Matrix

- [ ] Confirm whether the current window loader already has measured-height support; reuse it if present.
- [ ] Otherwise add one shared observer/cache at SegmentGrid: unknown rows use the existing estimate; measured deltas adjust virtual spacers.
- [ ] Use the same offset/ordinal mapping for scroll loading, seek, active-row scrolling, and DocumentMatrix viewport reporting.
- [ ] Batch observer updates in `requestAnimationFrame`; update only changed measurements.
- [ ] Retain measurements by stable identity/ordinal when rows unmount.
- [ ] Preserve existing window/overscan limits and content-visibility/containment where focus tests remain green.
- [ ] Verify 10,000 logical rows never become 10,000 mounted DOM rows.
- [ ] Remove row-render O(n²) scans and verify selection/pair highlighting only rerenders affected mounted rows.

**Validation:** variable-height virtual-boundary navigation, Matrix viewport/seek alignment, mounted row count, scroll stability, and same-machine trace.

### 11. Complete localization and accessibility

- [ ] Reuse existing catalog entries before adding keys.
- [ ] Add matched English and zh-CN values for every new visible string, title, tooltip, aria-label, selected-count message, hidden-selection message, status name, batch confirmation, tag state, and QA action.
- [ ] Verify no hard-coded user-visible English/Chinese remains in new components, including disabled reasons.
- [ ] Verify minimum target text size, visible focus, grid row/column metadata, correct button names/states, and non-color status distinctions.
- [ ] Verify reduced-motion and forced-colors behavior.
- [ ] Run targeted axe with active edit, tag error/order issue, multi-selection/batch bar, and inline QA visible; resolve all serious findings.

### 12. Final regression and evidence pass

- [ ] Run formatting/lint and TypeScript checks.
- [ ] Run all new Phase 3 unit/component tests plus existing ActiveAxis, DocumentMatrix, FilterRail, Workbench, editor command, workbench utility, draft persistence, and composition tests.
- [ ] Run the ten IME outcomes in Electron/Playwright, including key code 229 coverage where the harness supports it.
- [ ] Run the keyboard flow through a virtual boundary and verify exactly one Workbench ActiveAxis.
- [ ] Run targeted axe and contrast checks.
- [ ] Capture a 10,000-segment performance trace with environment, baseline, mounted row count, and P95 frame time. Target ≤33ms; fail a same-machine regression greater than 10%.
- [ ] Manually inspect 1250, 1680, and 1920 widths for seam/action placement, target growth, batch bar, QA clearance, and no Phase 0–2 regressions.
- [ ] Confirm touched production files stay within the new-file 400-line target or document why a narrower approved split was used.

## Validation commands

Use the repository’s existing script aliases when they differ; the expected targeted invocations are:

1. Typecheck:
   - `pnpm typecheck`
2. Lint/format gate:
   - `pnpm lint`
3. Phase 3 unit/component tests:
   - `pnpm --dir apps/desktop exec vitest run src/renderer/components/workbench/SegmentStatusLamp.test.tsx src/renderer/components/workbench/TagCapsule.test.tsx src/renderer/components/workbench/SegmentRow.test.tsx src/renderer/components/workbench/SegmentGrid.test.tsx src/renderer/hooks/useRovingGrid.test.tsx`
4. Existing Phase 0–2 focused regression:
   - `pnpm --dir apps/desktop exec vitest run src/renderer/components/workbench/ActiveAxis.test.tsx src/renderer/components/workbench/DocumentMatrix.test.tsx src/renderer/components/workbench/FilterRail.test.tsx`
5. Workbench Electron/E2E mission:
   - `pnpm --dir apps/desktop exec playwright test tests/e2e/workbench.spec.ts --grep "Phase 3|IME|roving grid|multi-select|inline QA"`
6. Accessibility/contrast:
   - `python scripts/check-contrast.py`
   - run the targeted axe case in `apps/desktop/tests/e2e/workbench.spec.ts`
7. Performance mission:
   - run the 10,000-segment Workbench Playwright trace case with trace enabled; record P95 frame time, environment, mounted row count, and pre/post same-machine comparison in the review evidence.

Do not substitute a full monorepo test run for the targeted loop while iterating. A broader existing desktop test script may be run once after targeted checks are green.

## Acceptance mapping

| PRD acceptance | Implementation steps |
| --- | --- |
| AC1 geometry/actions | 3–4, 12 |
| AC2 eight lamps | 2, 4, 11 |
| AC3 target/Axis | 3, 5, 7 |
| AC4 ten IME checks | 1, 5, 6–7, 12 |
| AC5 tags | 2, 6, 9 |
| AC6 roving grid | 3, 7, 10–12 |
| AC7 selection/batch | 7–8, 10–12 |
| AC8 inline QA | 2, 5, 9, 11 |
| AC9 accessibility/i18n | 4–11 |
| AC10 performance | 2–3, 10, 12 |

## Implementation blockers to report, not work around

- A documented batch action has no existing command/RPC path for selected IDs/current filter.
- Existing tag metadata lacks a stable source/target pair identity and would require XML/text parsing.
- Variable-height offset mapping would require an engine/preload/contract change rather than a renderer-only adaptation.
- The existing E2E fixture cannot construct a large document or dispatch composition events; report the exact harness gap rather than weakening acceptance silently.
- Any proposed fix requires changing `useComposition`, draft journal semantics, editor-command semantics, or the leave guard.

These are technical escalation points, not research requests. `research_needed` remains empty.
