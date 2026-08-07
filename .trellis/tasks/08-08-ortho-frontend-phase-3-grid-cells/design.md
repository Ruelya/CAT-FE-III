# Design — ORTHO Phase 3 Grid and Cells

## 1. Design stance

This document curates the approved Phase 3 design from `docs/design-ii/09-implementation.md` §4 and `docs/design-ii/screens/workbench.md` §3. It does not introduce a replacement interaction model.

The implementation is a surgical presentational extraction:

- `Workbench.tsx` remains the orchestration owner.
- Existing engine, RPC, contracts, editor commands, draft journal, composition guard, and leave guard remain authoritative.
- New components receive view data and callbacks; they do not acquire or mutate business state independently.
- Existing Phase 0–2 components remain intact except for narrow integration props/tests.
- New files target 400 lines or fewer. If a file approaches the limit, split by approved visual responsibility rather than moving orchestration out of `Workbench`.

## 2. Current-state evidence

The current Workbench already provides the required business paths:

- `Workbench.tsx` owns drafts, pending saves, per-segment composition tracking, loaded editor rows, active segment, issues, tag data, command handlers, and the registered leave/persist behavior.
- The existing windowed grid renders top and bottom virtual spacers and only `visibleSegments`; Phase 3 must retain that bounded rendering.
- The current target is a textarea wired to existing `updateDraft`, `scheduleSave`, composition handlers, focus activation, and target key dispatch.
- Existing protected tags already have stable IDs/display values/positions, selection, insertion/copy/move affordances, and `tagIssues`.
- Existing issue and tag-issue messages are already available at row render time.
- Phase 2 already projects loaded state into DocumentMatrix ordinal space and keeps one row-or-chip ActiveAxis residence.

The extraction therefore moves the current render block and presentation helpers; it does not invent a second source of truth.

## 3. File plan

### 3.1 Modify

| File | Responsibility after Phase 3 |
| --- | --- |
| `apps/desktop/src/renderer/Workbench.tsx` | Keep loading, filtering, window orchestration, drafts, saves, composition handlers, existing command/RPC calls, issue/tag data, active ID, leave guard, and assembly of memoized row view models/callbacks. Replace the inline segment table block with `SegmentGrid`. |
| `apps/desktop/src/renderer/components/workbench/ActiveAxis.test.tsx` | Extend only as needed to prove Phase 3 still renders one row Axis under focus and selection. `ActiveAxis.tsx` itself should remain unchanged unless a narrow typed prop adjustment is unavoidable. |
| `apps/desktop/src/renderer/styles/30-surfaces/workbench.css` | Add/replace Phase 3 row, cell, seam, status-lamp, tag, selection, batch-bar, inline-QA, forced-colors, composition, and content-visibility rules using existing tokens. Do not revive legacy unlayered styling. |
| `apps/desktop/src/renderer/i18n/messages.ts` | Reuse existing keys and add matched English/zh-CN keys for new status names, grid/selection announcements, batch actions/prompts, tag state labels, and QA actions. |
| `apps/desktop/tests/e2e/workbench.spec.ts` | Add keyboard, focus/Axis, IME, axe, virtual-window, and 10,000-segment trace coverage using existing fixtures/harnesses. |

### 3.2 Add

| File | Boundary |
| --- | --- |
| `apps/desktop/src/renderer/components/workbench/SegmentGrid.tsx` | Grid semantics, header, virtual spacers/window host, batch-bar placement, shared row measurement, and integration with `useRovingGrid`. It owns no drafts or business commands. |
| `apps/desktop/src/renderer/components/workbench/SegmentRow.tsx` | One CSS-grid row plate: ID, lamp, source, target, seam action rail, selected/active state, and inline QA placement. It forwards user intent through callbacks. |
| `apps/desktop/src/renderer/components/workbench/SegmentStatusLamp.tsx` | Pure mapping/rendering of the approved eight presentational states with localized accessible names. |
| `apps/desktop/src/renderer/components/workbench/TagCapsule.tsx` | Atomic source/target capsule rendering, pair-highlight hooks, error/order hooks, and keyboard move intent. Existing tag mutation remains outside. |
| `apps/desktop/src/renderer/components/workbench/BatchBar.tsx` | Localized 36px selected-count/action plate. Calls supplied actions and reflects supplied enablement/confirmation state. |
| `apps/desktop/src/renderer/components/workbench/InlineQaStrip.tsx` | Pure rendering of supplied segment/tag findings and supported Locate/Ignore callbacks. |
| `apps/desktop/src/renderer/hooks/useRovingGrid.ts` | Navigation/edit-mode/selection focus coordinator with composition-first guards and virtualization handoff. No engine calls. |
| `apps/desktop/src/renderer/components/workbench/SegmentGrid.test.tsx` | Integrated grid semantics, focus, selection, ActiveAxis, batch bar, and virtual-boundary behavior. |
| `apps/desktop/src/renderer/components/workbench/SegmentRow.test.tsx` | Row geometry state hooks, target callback/IME contract, action-rail availability, tag and inline-QA integration. |
| `apps/desktop/src/renderer/components/workbench/SegmentStatusLamp.test.tsx` | Eight-shape and localized-name matrix. |
| `apps/desktop/src/renderer/components/workbench/TagCapsule.test.tsx` | Pair highlight, missing/order state, atomic focus, Alt movement, lock/composition suppression. |
| `apps/desktop/src/renderer/hooks/useRovingGrid.test.tsx` | Hook-level navigation, edit mode, selection, Escape, Ctrl+Tab, and composition priority. |

Tests may be consolidated when the repository convention favors fewer files, but production responsibilities must stay below the new-file size target.

## 4. Component contracts

### 4.1 Workbench → SegmentGrid

`Workbench` constructs a memoized presentational row for each loaded editor row. The row contains only existing data needed to render:

- stable segment ID and authoritative ordinal;
- source text and current target draft value;
- derived presentational lamp state and localized/accessibility inputs;
- current workflow lock/signed state;
- existing source tags, target tags, selected target tag ID, and tag issues;
- existing open QA issue(s) and comment count;
- active, selected, anchor, autocomplete, and transient flash flags;
- enablement values already determined by existing commands/business state.

`SegmentGrid` receives:

- the loaded row window, total logical count, window offset, and current estimated row height;
- current active ID and filter identity/counts;
- editor loading/empty state;
- refs/callbacks needed by DocumentMatrix scrolling and viewport reporting;
- intent callbacks for activate, edit, draft input, composition start/end, target keydown, tag selection/move/insert/copy, best-match insertion, comments, More, QA actions, and batch actions;
- localized labels assembled through the existing `t` function.

Callbacks are stable (`useCallback` or existing stable dispatch) so memoized rows do not all rerender when one row changes.

### 4.2 SegmentGrid → Workbench

`SegmentGrid` reports only view/focus facts:

- active row/cell intent;
- first/last visible authoritative ordinals after row measurement;
- requests to seek an ordinal outside the mounted window;
- explicit selection or current-filter selection intent;
- batch action intent plus the current selection descriptor.

`Workbench` resolves those intents through existing loaders, commands, RPC, persistence, and editor mutation helpers. `SegmentGrid` never writes drafts, changes server state, evaluates QA, or persists a selection.

### 4.3 Selection descriptor

The UI selection model needs to support virtualized and filtered documents without mounting all rows. Represent selection intent as either:

- explicit stable segment IDs with an anchor ID; or
- the existing current-filter scope plus exclusions, selected count, and anchor ID when Select All is used.

This descriptor is presentational. Workbench must adapt it to an existing batch-capable path; Phase 3 must not add a new contract/query. Filter changes preserve the descriptor and derive visible/hidden counts from existing filter metadata. The anchor remains stable while it exists in the document; if deletion removes it, choose the nearest surviving selected row and announce the change.

## 5. DOM and layout

### 5.1 Grid structure

Use a semantic grid composed of CSS-grid rows rather than retaining table layout constraints that prevent the approved row anatomy:

- one grid root with `role="grid"`, row/column counts, and one normal Tab stop;
- one header row with four current columns;
- virtual top spacer;
- mounted `SegmentRow` elements with `role="row"`;
- each ID/status/source/target element uses `role="gridcell"` or `columnheader` and a deterministic ID;
- virtual bottom spacer.

The row uses the current four data columns. Do not add the optional match-source column unless Workbench already supplies truthful data through an existing presentation field; it is not required by the dispatch scope.

The source and target cells are adjacent plates. The 24px action rail is positioned on their shared seam, above row content only while visible. Its hidden state uses visibility/pointer-event suppression, not opacity alone.

The inline QA area is part of the same row and spans the source/target columns below the editing plates. It begins at least 8px after the target editor’s candidate-window area.

### 5.2 Variable height and virtual spacers

`field-sizing: content` makes row height data-dependent, while the current virtual spacers use a fixed estimate. Preserve the current window loader and add a view-only measurement layer:

1. Unknown/unmounted rows use the existing `EDITOR_ROW_HEIGHT` estimate.
2. One shared `ResizeObserver` observes mounted row roots.
3. Measurements are cached by stable segment ID plus ordinal and retained when a row leaves the window.
4. Top/bottom spacers use estimated heights plus known measured deltas.
5. Scroll-to-ordinal and scroll-offset-to-ordinal use the same cache, avoiding disagreement between navigation and DocumentMatrix.
6. A viewport callback supplies first/last visible ordinals to Workbench; Matrix no longer needs to divide by a fixed height for measured rows.
7. Measurement updates are batched in `requestAnimationFrame` and applied only when a height changed.

If the existing loader already exposes measured offset helpers, reuse them rather than creating a second cache. The implementation checkpoint is to confirm and extend the current path, not replace it.

### 5.3 Performance containment

- Keep the current window size/overscan and server/window request boundaries.
- Keep one shared observer and one scroll listener.
- Remove render-loop `findIndex`/`find` scans by joining row view models once in `Workbench`.
- Memoize `SegmentRow`; pass primitive flags and stable callbacks.
- Update pair highlight only for the affected row/pair.
- Update selection through membership checks, not by copying large row objects.
- Apply `content-visibility: auto`, `contain-intrinsic-size`, and `contain: layout style` where focus and measurement tests show no regression.
- Never render hidden selected rows solely to style or count them.

## 6. Focus and ActiveAxis

### 6.1 Navigation mode

The grid root is the single Tab stop and uses `aria-activedescendant` to identify the current cell. On Tab entry, it chooses the active segment’s target cell. Arrow keys change the logical row/column. If a destination is outside the mounted window, the hook requests the existing seek path, waits for the row to mount, then updates `aria-activedescendant`; it never points at missing DOM.

### 6.2 Edit mode

Enter on an editable target calls the existing focus path and focuses the textarea. Non-editable source/status/ID cells remain navigation targets but do not create new edit semantics.

- Escape returns focus to the grid root and preserves the current draft.
- Tab advances through existing editable target cells and invokes seek when needed.
- Ctrl+Tab exits to the next Workbench region.
- Locked/signed rows are skipped for edit entry/Tab advancement but remain navigable and readable.

### 6.3 Axis ownership

Target `focus` first calls the existing activation callback. Workbench sets `activeId`; only the active row mounts the existing `ActiveAxis` component. Multi-selection never renders additional axes. Non-anchor selected rows use neutral seam/background treatment.

DocumentMatrix keeps its Phase 2 behavior: navigation can activate/seek without stealing an already-focused target. This is separate from target focus owning row activation.

## 7. IME sequencing

Every new keyboard entry point begins with the existing composition predicate: global `isComposing`, native `event.isComposing`, and key code 229. The predicate precedes preventDefault, selection changes, action dispatch, and overlay changes.

Target event order remains:

1. `compositionstart` records the segment and global document state through existing handlers.
2. `input/change` updates the local displayed value, but no draft write/autocomplete/QA reflow is scheduled while composing.
3. CSS under `html[data-composing]` disables target and row transition/animation.
4. `compositionend` records the final DOM value through the existing handler.
5. Existing 400ms draft scheduling resumes once.

The extraction passes existing handlers through unchanged. It must not add a second timer, write queue, or composition singleton. The leave guard continues to call Workbench persistence, not a grid method.

## 8. Status lamp derivation

`Workbench` or a pure presentation helper derives one of eight visual states from existing data. No stored state is changed.

Precedence is deterministic:

1. open QA error;
2. open QA warning;
3. locked;
4. signed;
5. reviewed;
6. confirmed;
7. draft/non-empty unconfirmed;
8. untranslated.

Each state provides a `data-state`, a localized accessible name, and a CSS shape. Pseudo-elements may draw cross/slash/bar/clip details. Forced-colors rules use borders/currentColor so shape survives color substitution. Do not use lucide icons as the primary 8px lamp shape.

## 9. Protected tags

### 9.1 Rendering trade-off

The approved Phase 3 behaviors are implemented without changing the proven textarea/IME/draft model. Source tags remain rendered in source text through the existing tagged-text path. Target capsules remain atomic sibling controls in the target cell, ordered by their existing positions. Phase 3 does not introduce `contenteditable` or a text-overlay editor.

### 9.2 Pair highlight

`SegmentRow` holds only the current highlighted pair key. Source and target capsules receive the same normalized pair key from existing metadata. Hover/focus sets it; pointer/focus exit clears it only when the counterpart does not own focus. Both members receive `data-paired-highlight` from the shared key.

### 9.3 Errors and movement

Existing `tagIssues` map to presentation hooks:

- missing pair: source capsule gets error/dashed treatment and issue remains in InlineQaStrip;
- order mismatch: affected target capsule gets warning treatment;
- no raw XML is generated or exposed.

A selected target capsule receives Alt+Left/Right. The component checks composition and supplied lock/signed state, prevents default only when it will act, calls the existing move callback once, and restores/retains the capsule/row focus after rerender. F9, copy structure, and Ctrl tag navigation continue through existing target/editor-command handlers.

## 10. Multi-selection and batch actions

`useRovingGrid` owns ephemeral focus coordinates, edit mode, selection descriptor, and anchor. Workbench remains the source of active segment and action capability.

- Plain row click replaces row selection and activates without editor focus.
- Target click activates/focuses and preserves caret behavior; modifier keys alter row selection without hijacking text selection.
- Shift navigation extends from the stable anchor; Ctrl click toggles.
- Ctrl+Shift+A creates the existing-filter selection intent.
- Escape clears multi-selection first and retains/re-activates the anchor.
- Filter changes preserve the descriptor; BatchBar reports total and hidden count.
- Axis stays on the anchor while range selection grows.

`BatchBar` receives action descriptors (`id`, label, enabled, destructive/overwriting) and callbacks. Confirmation, preview, undo, progress, and errors stay in the existing command layer. The bar never loops over engine mutations itself.

## 11. Inline QA

`InlineQaStrip` receives normalized views over existing segment issues and tag issues: stable ID/code, severity, message, and supported action flags/callbacks.

- It renders below source/target as a contiguous frame plate with severity-leading seam, icon, message, and supported Locate/Ignore actions.
- Multiple findings remain individually identifiable; compact wrapping is allowed, silent truncation is not.
- Ignore dispatches the existing reason-required flow. The component does not collect a reason unless the current flow already delegates that UI to the caller.
- The strip does not run QA and does not remove existing QA Surface/Stack behavior in Phase 3.
- Use a labelled region/list rather than assertive live output. Only a newly changed issue count may be politely announced.

## 12. Localization and copy

Reuse existing keys for common actions, status, tags, comments, More, and untranslated text. Add parallel English and zh-CN values for:

- reviewed/signed/warning/locked lamp names if absent;
- grid navigation/edit announcements;
- selected count and hidden selected count;
- batch action labels and destructive confirmation copy;
- pair/missing/order accessible labels;
- inline QA region, Locate, Ignore, and ignore-reason handoff labels.

No component contains hard-coded user-visible English or Chinese, including tooltip/title/aria-label and disabled reasons.

## 13. Test design

### Unit/component

- Eight lamp states: unique state/shape hooks, localized accessible names, precedence, forced-colors-compatible structure.
- Row: plate/seam hooks, one Axis, action rail availability on focus, target activation, signed disablement, callback preservation.
- Tags: pair highlight from either side, missing/order hooks, selected atomic capsule, Alt movement, composition/lock suppression.
- Inline QA: severity/message/action rendering, no action when unsupported, focus retention callback.
- Roving grid: one stop, arrow coordinates, Enter/Escape, Tab/Ctrl+Tab, virtual seek handshake, mounted descendant invariant.
- Selection: click/toggle/range/select-filter/Escape, anchor Axis, hidden count, batch visibility and enablement.
- IME callback contract: no Phase 3 key/action dispatch between composition boundaries and one deferred-save handoff afterward.

### Electron/E2E

- The ten PRD IME outcomes with a real target textarea and synthetic/native composition events accepted by the current harness.
- Complete keyboard journey from FilterRail into grid, across virtual boundary, into/out of edit, tag movement, multi-select, batch cancellation, and out to next region.
- DocumentMatrix navigation retains target focus where required and never creates a second Axis.
- Axe scan with the grid, batch bar, tag error, and inline QA visible; no serious violations.
- 10,000-segment trace records environment, mounted rows, P95 frame time, and same-machine baseline.

## 14. Failure and rollback

- No data migration or contract change exists; rollback is removal of the extracted grid and restoration of the previous inline render block.
- Keep each extraction step behaviorally green so row/status, editor/IME, tags, and selection/QA can be reverted independently.
- CSS is scoped to Phase 3 component classes/data attributes; rollback does not touch Phase 0–2 shell styles.
- If variable measurement destabilizes window loading, retain the new components but temporarily restore the existing fixed-height estimate while fixing the shared mapping before release. Do not ship a path that mounts all rows.
- If roving navigation cannot uphold mounted `aria-activedescendant`, block release rather than falling back to thousands of Tab stops.
- If a documented batch action lacks an existing command/RPC path, do not add engine/contracts logic in this task; report the concrete missing adapter to the Orchestrator as an implementation blocker.

## 15. Technical risks and controls

| Risk | Control |
| --- | --- |
| Content-sized rows disagree with fixed virtual offsets | Shared measured-height cache, estimated unknown rows, one mapping for spacers/seek/Matrix, virtual-boundary tests. |
| `aria-activedescendant` points to an unmounted row | Seek handshake updates descendant only after mount. |
| IME key event leaks through a new handler | One composition-first predicate used before all grid/tag/batch handling; ten Electron checks. |
| ActiveAxis duplicates under multi-selection/focus | Axis remains rendered only from Workbench active/anchor row; E2E count assertion. |
| Selection causes mounted-window rerender storms | Stable selection membership, memoized view models/rows, trace and render-count tests. |
| Pair identity differs between source and target representations | Normalize only from existing pair metadata; no text/XML heuristics. |
| Batch action implies new business semantics | BatchBar emits intent only; Workbench adapts to existing commands. Missing adapter blocks rather than widening scope. |
| QA strip steals focus or candidate-window space | Non-assertive semantics, explicit focus restoration, at least 8px separation, composition E2E. |
| New strings diverge between locales | Paired catalog additions and locale test for every new key. |
