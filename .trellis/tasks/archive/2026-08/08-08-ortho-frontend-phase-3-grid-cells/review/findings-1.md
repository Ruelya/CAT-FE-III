# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-3-grid-cells`
- branch: `implement/ortho-frontend` (working tree uncommitted; task branch recorded as implement/ortho-frontend)
- head_sha: `89d8d74` (+ unstaged Phase 3 working tree)
- round: 1
- reviewer: trellis-review
- scope_checked: prd.md · design.md · implement.md · uncommitted apps/desktop Phase 3 files · workbench.css · messages.ts · 09-implementation.md note

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: Static review proved several keyboard/selection/batch defects and could not re-confirm the implement claim of a clean typecheck or green unit suite. Runtime evidence is required before any green/closeout, and to bound residual AC4/AC6/AC7/AC9/AC10 risk after fixes land.
- questions:
  - Q1: Does `pnpm typecheck` (or the repo’s desktop/typecheck alias) pass with the current Phase 3 tree?
  - Q2: Do Phase 3 unit tests plus focused Phase 0–2 workbench tests pass under `apps/desktop` vitest?
  - Q3: After fixes (or if unfixed), does arrow navigation across a virtual window boundary eventually activate the destination row and keep `aria-activedescendant` on a mounted cell only?
  - Q4: Does Ctrl+Shift+A select the full current filter scope (not only the mounted ~100-row window), and does BatchBar count/hidden count match?
  - Q5: Does batch Confirm apply to every selected ID; does batch Lock/Clear honor signed rules without wrongly signing the wrong row or racing `activeId`?
  - Q6: In edit mode, does Tab advance to the next editable target (seeking when needed), and does Escape return to navigation without discarding draft?
  - Q7: Is ActiveAxis count exactly one under single focus and under multi-select (anchor only)?
  - Q8: What residual gaps remain for the ten IME outcomes, axe serious, and 10k mounted-row/P95 trace (expected not fully green this phase if harness gaps)?
- success_criteria:
  - Typecheck exit 0 for the desktop/renderer surface touched by Phase 3.
  - Listed vitest files exit 0 (Phase 3 + ActiveAxis/DocumentMatrix/FilterRail regression).
  - Virtual-boundary keyboard navigation either works end-to-end or fails with a concrete stack/behavior log (not silent no-op).
  - Select-all and batch paths either match PRD R5/AC7 or document a precise missing adapter (no silent window-only select-all).
  - No second ActiveAxis in DOM under multi-select fixtures.
- failure_signals:
  - Type errors in new components/hooks or Workbench integration.
  - Arrow/seek leaves focus stuck; `aria-activedescendant` points at missing IDs.
  - Ctrl+Shift+A selection size equals window size while filter total is larger.
  - Batch lock mutates only one row or sets `signed` for every selected row unexpectedly.
  - Tab in edit mode never leaves the current textarea.
  - Test failures that are product regressions (not environment noise).
- suggested_commands:
  - `pnpm typecheck`
  - `pnpm --dir apps/desktop exec vitest run src/renderer/components/workbench/SegmentStatusLamp.test.tsx src/renderer/components/workbench/TagCapsule.test.tsx src/renderer/components/workbench/segmentTypes.test.ts src/renderer/hooks/useRovingGrid.test.tsx src/renderer/components/workbench/ActiveAxis.test.tsx src/renderer/components/workbench/DocumentMatrix.test.tsx src/renderer/components/workbench/FilterRail.test.tsx`
  - If present after fix: `pnpm --dir apps/desktop exec vitest run src/renderer/components/workbench/SegmentRow.test.tsx src/renderer/components/workbench/SegmentGrid.test.tsx`
  - Optional broader once targeted green: existing desktop unit script only (avoid full monorepo).
  - Do **not** require full 10k/P95 or full Playwright IME matrix in this first verify unless already cheap; log harness gaps instead.
- scope: `apps/desktop` renderer Phase 3 + Workbench orchestration; unit/component tests only unless a tiny existing e2e is free
- avoid: full workspace test matrix; new engine/contracts work; Phase 4 Stack; inventing pretranslate RPC
- related_issues: F1, F2, F3, F4, F5, F8, F16, F17

## contract_boundary_check
- engine / preload / RPC / `@translunar/contracts` packages: **no product changes** observed in this working tree (only renderer + docs + i18n + CSS).
- `useComposition` global guard: **not rewritten**; Phase 3 imports `shouldIgnoreKey` / `isComposing`.
- leave guard / `persistAllSegments`: **preserved** (registration path unchanged).
- draft model remains textarea + Workbench `updateDraft` / `scheduleSave`; no contenteditable.
- BatchBar / InlineQaStrip / TagCapsule emit **intent only**; mutations stay in Workbench (boundary OK).
- Residual product-level adapter gaps: batch pretranslate deferred (documented); inline ignore does not call `qa.issue.waive` (see F6).
- Presentation helper `segmentTypes.ts` imports **types** from `@translunar/contracts` only — consistent with other renderer modules; no contract shape change.

## issues

### F1
- severity: blocker
- files: `apps/desktop/src/renderer/hooks/useRovingGrid.ts:142-170`, `apps/desktop/src/renderer/hooks/useRovingGrid.ts:158-170`
- problem: Virtual seek handshake is incomplete. `ensureMounted` awaits `onSeekOrdinal` then returns `null`; `moveToListIndex` returns without setting focus/activation after seek. Arrow navigation to rows outside the mounted window is a silent no-op, and `aria-activedescendant` never gets a post-mount update. Violates PRD R4/AC6 (mounted-descendant invariant + virtual boundary navigation).
- minimal_fix: After seek, re-resolve the destination from updated `rows`/`offset` (effect or callback when window changes and `pendingSeekRef` matches), then `setFocusSegmentId` / `onActivate` / update descendant only when `document.getElementById(cellId(...))` exists. Never point `aria-activedescendant` at unmounted IDs.
- status: open

### F2
- severity: blocker
- files: `apps/desktop/src/renderer/Workbench.tsx:2949`, `apps/desktop/src/renderer/hooks/useRovingGrid.ts:297-311`
- problem: Ctrl+Shift+A uses `allFilteredIds={visibleSegments.map(...)}` where `visibleSegments` is only the loaded editor window (`editorRows`, limit 100). Select-all therefore selects the mounted window, not the current filter scope. Violates PRD R5/AC7.
- minimal_fix: Supply true filter-scope IDs from an existing list/query already used by Workbench (or select-all intent descriptor that Workbench expands via existing `segment.editor.list` / filter metadata). Do not mount all rows. If no adapter exists for full-scope IDs, disable Ctrl+Shift+A and report the missing adapter — do not ship window-sized select-all as full scope.
- status: open

### F3
- severity: blocker
- files: `apps/desktop/src/renderer/Workbench.tsx:2623-2629`, `apps/desktop/src/renderer/Workbench.tsx:1863-1882`
- problem: Batch **Lock** loops `setActiveId(id); await setWorkflowState("signed")`, but `setWorkflowState` always mutates `activeEditorRow` from React state. State updates do not apply mid-loop, so the action races and typically re-applies sign-off to the **same** active row, not each selected ID. Additionally, “Lock” is mapped to workflow **signed**, conflating signed lamp/state with lock (collab lock / locked lamp are separate concepts). Violates PRD R5/AC7 and risks incorrect destructive workflow transitions.
- minimal_fix: Invoke workflow/lock per **explicit segmentId** (same pattern as `confirmSegment(id)`), not via `activeId` side effects. Map batch Lock to the existing lock/workflow path that product already uses for a single segment; if only signed exists and lock is unavailable, disable the action and surface deferred (like pretranslate) rather than bulk-signing.
- status: open

### F4
- severity: major
- files: `apps/desktop/src/renderer/hooks/useRovingGrid.ts:327-336`
- problem: In edit mode, Tab handling returns immediately whenever `event.target` is the target textarea (`dataset.editorFor`), so Tab never advances to the next editable target. PRD R4/AC6 requires Tab → next editable target (with seek when needed).
- minimal_fix: On Tab in edit mode (when not accepting autocomplete — autocomplete already handled on textarea first via `onTargetKeyDown`), preventDefault and run the same “next editable” walk used in navigation mode, including seek past window end. Coordinate with Workbench autocomplete Tab so only one consumer handles the key.
- status: open

### F5
- severity: major
- files: `apps/desktop/src/renderer/components/workbench/SegmentGrid.tsx:142-157`, `apps/desktop/src/renderer/Workbench.tsx:478-483`
- problem: Shared `ResizeObserver` writes a measure cache, but spacer metrics ignore measured heights (loop voids id/height; top spacer is always `offset * rowHeight`). Matrix viewport still uses fixed `EDITOR_ROW_HEIGHT` division. Variable-height `field-sizing: content` will desync spacers/seek/Matrix — PRD R7.
- minimal_fix: Use cache for known IDs when computing top/bottom spacers and expose measured first/last ordinals (or scroll offset mapping) to Workbench’s `syncMatrixViewport`. Keep estimate for unknown rows; rAF-batch only on height change (already partially present).
- status: open

### F6
- severity: major
- files: `apps/desktop/src/renderer/Workbench.tsx:2730-2737`, `apps/desktop/src/renderer/components/workbench/InlineQaStrip.tsx:69-79`
- problem: Inline QA **Ignore** only opens Stack QA + toast (`workbench.qaIgnoreHint`); it does not run the existing reason-required waive path (`qa.issue.waive` used on QaReviewPage). PRD R6/AC8 requires Ignore retain reason requirement via existing callbacks.
- minimal_fix: Wire Ignore to the existing waive UI/RPC (prompt reason then `qa.issue.waive`) when `canIgnore`, or hide the Ignore control until that handoff exists. Do not show a live Ignore button that only toasts if AC8 is in scope for this task.
- status: open

### F7
- severity: minor
- files: `apps/desktop/src/renderer/Workbench.tsx:2418-2422`, `apps/desktop/src/renderer/components/workbench/segmentTypes.ts:222-240`
- problem: `deriveLampState` supports `locked`, and CSS/tests cover eight shapes, but Workbench never passes `locked: true`. The locked lamp is unreachable in the product path (signed/error/etc. only).
- minimal_fix: Feed lock from existing collab/lock or workflow fields if present; otherwise document locked as presentation-only until data exists and keep the pure mapper tested.
- status: open

### F8
- severity: major
- files: design.md §3.2 / implement.md §3–8 validation; missing `SegmentGrid.test.tsx`, `SegmentRow.test.tsx`
- problem: Design required integrated grid/row tests (selection, Axis, batch bar, virtual boundary, IME contract hooks). Only lamp, TagCapsule, segmentTypes, and thin useRovingGrid tests exist. Coverage gap for the highest-risk extraction surface.
- minimal_fix: Add minimal characterization tests for SegmentGrid (role=grid, batch bar ≥2 selected, one tabIndex 0) and SegmentRow (lamp + rail + QA render + draft change callback). Expand useRovingGrid tests for Tab-advance and composition Escape.
- status: open

### F9
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/SegmentGrid.tsx:199-201`
- problem: Column header text `"ID"` is hard-coded English; PRD R8/AC9 forbids hard-coded user-visible copy in Phase 3 components.
- minimal_fix: Add en/zh-CN catalog keys (or reuse an existing ID/segment-number key) and pass via `labels`.
- status: open

### F10
- severity: nit
- files: `apps/desktop/src/renderer/hooks/useRovingGrid.ts` (435 lines)
- problem: New-file target is ≤400 lines; hook exceeds it (selection + navigation co-located).
- minimal_fix: Split selection helpers vs navigation/edit mode into a small pure module or second hook without changing behavior.
- status: open

### F11
- severity: nit
- files: `apps/desktop/src/renderer/components/workbench/segmentTypes.ts:205`, `SegmentGrid.tsx` (prop unused)
- problem: `SegmentGridProps.isComposing` is required in the type and passed from Workbench but never used by SegmentGrid (roving uses `useComposition` directly). Dead contract surface.
- minimal_fix: Use the injected predicate in roving options **or** remove the prop from the grid contract.
- status: open

### F12
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/SegmentRow.tsx:88`, `TagCapsule.tsx:80-83`
- problem: Pair highlight clears on any mouseleave/blur; design §9.2 says clear only when the counterpart does not own focus. Rapid hover between pair members can flicker and lose highlight.
- minimal_fix: Track focus ownership on pair key; clear only when neither side is hovered/focused.
- status: open

### F13
- severity: major
- files: `apps/desktop/src/renderer/hooks/useRovingGrid.ts:224-239`, `apps/desktop/src/renderer/hooks/useRovingGrid.ts:174-188`
- problem: Shift+click / Shift+Arrow range selection only enumerates **mounted** `rows` indices. Ranges that cross the virtual window cannot include off-window segment IDs (related to F2 filter-scope model).
- minimal_fix: Represent range by ordinal/filter index via Workbench-owned ID list or range descriptor; expand using existing data without mounting all rows.
- status: open

### F14
- severity: nit
- files: `apps/desktop/src/renderer/Workbench.tsx:2592-2594`, docs Phase 3 note
- problem: Batch Pretranslate is intentionally disabled with deferred toast. Matches implement escalation path when adapter is missing; not a contract violation if labeled disabled.
- minimal_fix: none for this task; keep disabled + localized deferred copy.
- status: wontfix

### F15
- severity: minor
- files: `apps/desktop/src/renderer/components/workbench/SegmentRow.tsx:149-168`, docs residual note
- problem: Source pair highlight is incomplete: non-missing source tags rely on `TaggedText` without capsule pair sync; only missing source tags render as `TagCapsule`. Documented residual; pair hover from target may not light source in-text tags.
- minimal_fix: Optional: pass `pairHighlight` into `renderSource` / TaggedText if an existing hook exists; else accept residual with note for follow-up (not silent claim of full AC5 pair highlight).
- status: open

### F16
- severity: major
- files: implement claim (typecheck)
- problem: Review did not execute typecheck; implement claims pass. Judgment on compile health is **needs_evidence**.
- minimal_fix: n/a — verify mission Q1.
- status: needs_evidence

### F17
- severity: major
- files: prd AC4 / AC9 / AC10; implement claim (IME/e2e/axe/10k not run)
- problem: Ten IME Electron checks, axe serious, and 10k mounted-row/P95 baseline are not evidenced. Partial unit tests only. These ACs remain open risk.
- minimal_fix: After F1–F5/F8 fixes, verify mission Q2–Q8; schedule full IME/axe/10k as follow-on quality rounds if harness allows, else document exact harness gap (implement.md blocker list).
- status: needs_evidence

## assumptions
- Pre-existing `scheduleSave` default 650ms / compositionend 80ms is out of Phase 3 scope; PRD “400ms” is treated as design aspiration relative to existing Workbench, not a new Phase 3 regression.
- Window size 100 + overscan 18 remains the approved virtualization base.
- Batch pretranslate deferral is accepted residual when no selected-ID adapter exists.
- Review did not run tests or the app; static reading is authoritative for F1–F5/F13.

## what looks solid (credit)
- File plan largely landed: SegmentGrid/Row, lamp, TagCapsule, SeamActionRail, BatchBar, InlineQaStrip, useRovingGrid, segmentTypes mappers.
- Workbench remains orchestrator; drafts, leave guard, composition handlers, DocumentMatrix, FilterRail, Masthead not reworked into new ownership.
- Lamp pure mapper + unit test for precedence; eight CSS shapes + forced-colors rules present.
- Plate/seam CSS: no row card margin/radius/shadow; `field-sizing: content`; `scroll-margin-block: 96px`; `html[data-composing]` disables transitions; QA strip `margin-block-start: 8px`.
- i18n: new lamp/batch/selection/QA/tag keys appear paired en + zh-CN.
- Target remains textarea; tags are atomic buttons without raw XML.
- New production files (except useRovingGrid) under ~400 lines.

## summary_for_orchestrator
Phase 3 extraction is real and directionally aligned (grid host, lamps, tags, batch bar, inline QA, roving hook, Workbench view-model join), with healthy contract boundaries (no engine/contracts edits). It is **not green**: four high-severity defects are statically proven — broken virtual seek (F1), window-only select-all (F2), batch lock race/wrong signed mapping (F3), and Tab-never-advances in edit mode (F4) — plus major gaps in measured virtualization (F5), range selection across the window (F13), Ignore-without-reason (F6), and missing grid/row tests (F8). Pretranslate deferral is acceptable residual. **Dispatch trellis-fix for F1–F6, F8, F13 (and easy F9/F11)**; do not close out. After fix, **trellis-verify must run the mission above** (typecheck + desktop unit suite + targeted behavior Qs) before another review can clear F16/F17 and residual AC4/AC9/AC10 risk.
