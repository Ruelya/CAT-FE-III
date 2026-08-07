# Findings round 2

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-3-grid-cells`
- branch: `implement/ortho-frontend` (uncommitted working tree)
- head_sha: `89d8d74` (+ Phase 3 working tree after fix)
- round: 2
- resume_from: findings-1.md after trellis-fix claim F1–F6, F8, F9, F11, F13
- reviewer: trellis-review

## need_verify
- required: false

### Verify mission
- none (static re-review + unit coverage closed prior blockers/majors; live IME/axe/10k accepted residual for this task)

## issues

### F1
- severity: blocker
- files: `apps/desktop/src/renderer/hooks/useRovingGrid.ts` (pending seek + completeMove effect), `useRovingGrid.test.tsx`
- problem: (round 1) Virtual seek left focus stuck after arrow past window.
- minimal_fix: —
- status: fixed
- evidence: `pendingSeekRef` + `useEffect` on `offset`/`rows` calls `completeMove` after mount; `activeDescendant` gated by `rowIndexById.has`; unit test “seeks when ArrowDown leaves the mounted window and completes after rows update” green (reviewer re-ran).

### F2
- severity: blocker
- files: `Workbench.tsx` `ensureFilterScopeIds` / `handleSelectAllFilterScope`, `useRovingGrid.ts` select-all path
- problem: (round 1) Ctrl+Shift+A selected mounted window only.
- minimal_fix: —
- status: fixed
- evidence: Select-all uses `allFilteredIds` when present, else `onSelectAllFilterScope` → paged `segment.editor.list` (limit 200) without mounting grid rows; **no** window-only fallback. Unit tests cover both paths.

### F3
- severity: blocker
- files: `Workbench.tsx` batch lock descriptors + `handleBatchAction`
- problem: (round 1) Batch lock raced `setActiveId` and bulk-signed.
- minimal_fix: —
- status: fixed
- evidence: Lock action `enabled: false`; handler toasts `workbench.batch.lockDeferred` and does not call `setWorkflowState("signed")`. Pretranslate remains deferred (F14). Confirm still loops `confirmSegment(id)`.

### F4
- severity: major
- files: `useRovingGrid.ts` `advanceToNextEditable` + edit-mode Tab
- problem: (round 1) Tab in edit mode never advanced.
- minimal_fix: —
- status: fixed
- evidence: Tab (when not `defaultPrevented`) preventDefault + next editable / seek with `enterEdit: true`. Unit test “Tab in edit mode advances to the next editable target” green.

### F5
- severity: major
- files: `SegmentGrid.tsx` spacerMetrics / heightByListIndex, `Workbench.tsx` `editorRowStride`
- problem: (round 1) Measure cache unused; Matrix used fixed height only.
- minimal_fix: —
- status: fixed
- evidence: Top/bottom spacers sum `heightByListIndexRef` with estimate fallback; `onRowStrideChange` feeds `editorRowStrideRef` used by `syncMatrixViewport` and `onEditorScroll`. Shared ResizeObserver retained.

### F6
- severity: major
- files: `Workbench.tsx` `handleIgnoreFinding`
- problem: (round 1) Ignore only toasted without reason/waive.
- minimal_fix: —
- status: fixed
- evidence: Non-tag findings: `window.prompt` reason → `qa.issue.waive` with actor/reason → `refreshOpenIssues`. Empty reason toast. Tag findings `canIgnore: false` and early-return on `tag:` ids. (Docs `09-implementation.md` residual line still describes old toast-only path — F18.)

### F8
- severity: major
- files: `SegmentGrid.test.tsx`, `SegmentRow.test.tsx`, expanded `useRovingGrid.test.tsx`
- problem: (round 1) Missing grid/row characterization tests.
- minimal_fix: —
- status: fixed
- evidence: Grid role/tabIndex/batch bar/single axis; Row lamp/QA/draft callbacks; roving seek/select-all/Tab/Escape. Reviewer re-ran the three new suites: 11/11 pass.

### F9
- severity: minor
- files: `SegmentGrid.tsx`, `messages.ts` `workbench.grid.idColumn`
- problem: (round 1) Hard-coded `"ID"` header.
- minimal_fix: —
- status: fixed
- evidence: Header uses `labels.idColumn`; en “ID” / zh “编号”.

### F11
- severity: nit
- files: `SegmentGrid.tsx`, `useRovingGrid.ts`
- problem: (round 1) `isComposing` prop unused.
- minimal_fix: —
- status: fixed
- evidence: Prop forwarded into `useRovingGrid` as composition predicate before `isGlobalComposing()`.

### F13
- severity: major
- files: `useRovingGrid.ts` range helpers, `Workbench.tsx` `handleRangeSelect`
- problem: (round 1) Shift-range limited to mounted window.
- minimal_fix: —
- status: fixed
- evidence: Range expansion prefers `allFilteredIds`; else `onRangeSelect(from,to,anchor)` → `ensureFilterScopeIds` slice. Shift+click and Shift+arrow share this path.

### F14
- severity: nit
- files: batch pretranslate
- problem: No selected-ID pretranslate adapter.
- minimal_fix: —
- status: wontfix
- residual: Disabled + deferred toast → AI Control; matches implement escalation / PRD out-of-scope engine work.

### F7
- severity: minor
- files: lamp `locked` derivation
- problem: Locked lamp still not fed from product lock data (no collab lock projection into row view).
- minimal_fix: Wire when collab/lock state is available on editor rows; pure mapper already tested.
- status: open
- residual_accepted: yes (presentation shape ready; data not on Phase 3 surface)

### F10
- severity: nit
- files: `useRovingGrid.ts` (~635 lines)
- problem: Exceeds new-file ≤400 target after fix growth.
- minimal_fix: Optional split selection vs navigation in a follow-up; not blocking.
- status: open
- residual_accepted: yes

### F12
- severity: minor
- files: `TagCapsule` / `SegmentRow` pair highlight
- problem: Clear-on-leave can flicker between pair members.
- minimal_fix: Clear only when neither side owns hover/focus.
- status: open
- residual_accepted: yes

### F15
- severity: minor
- files: `TaggedText` vs `TagCapsule` source pair
- problem: Full bidirectional source-in-text pair highlight incomplete; missing tags use capsules.
- minimal_fix: Phase 4+ or optional TaggedText highlight prop.
- status: open
- residual_accepted: yes

### F16
- severity: major
- files: typecheck claim
- problem: (round 1) needs_evidence
- minimal_fix: —
- status: fixed
- evidence: Fix agent reports typecheck + **217** desktop tests pass. Reviewer re-ran Phase 3 suites (useRovingGrid + SegmentGrid + SegmentRow): **11 passed**. No static type red flags in fixed surfaces.

### F17
- severity: major
- files: AC4 IME e2e / AC9 axe / AC10 10k P95
- problem: Live Electron IME matrix, axe serious, and 10k same-machine baseline not run in this loop.
- minimal_fix: —
- status: wontfix
- residual_accepted: yes — environment/harness residual for this task; unit/static cover composition-first guards and keyboard paths; full e2e/perf tracked as follow-on quality, not Phase 3 closeout blockers per Orchestrator fix claim + plan residual notes.

### F18
- severity: nit
- files: `docs/design-ii/09-implementation.md` Phase 3 residual list
- problem: Residual bullet still says inline Ignore only opens Stack QA + toast; code now prompts reason and calls `qa.issue.waive`.
- minimal_fix: Update residual note on closeout/spec pass.
- status: open
- residual_accepted: yes (docs drift only)

## contract_boundary_check
- Still no engine/preload/contracts package product changes.
- Filter-scope expansion uses existing `segment.editor.list` only (UI adapter).
- Ignore uses existing `qa.issue.waive`.
- Leave guard / drafts / textarea / `useComposition` intact.
- Batch lock/pretranslate intentionally non-mutating when adapters missing.

## assumptions
- Fix agent’s full 217-test pass is trustworthy; spot-check of critical Phase 3 files is sufficient for green.
- Batch Lock disabled is preferred over incorrect bulk-sign (PRD intent preserved without inventing collab batch RPC).
- IME/axe/10k remain product aspirations but are accepted residual for **this** task’s quality exit per job guidance.

## summary_for_orchestrator
Round-1 blockers/majors (F1–F6, F8, F13) and easy items (F9, F11) are **fixed** with code + unit evidence (reviewer re-ran 11 Phase 3 tests green). Deferred **pretranslate** and **live IME/axe/10k** are accepted residuals (F14/F17). Remaining open items are **minor/nit only** (locked lamp data, hook line count, pair-highlight polish, TaggedText sync, docs drift). **No open blocker/major that blocks green.** Contract boundaries clean. **Verdict: ready_for_closeout** — dispatch `trellis-closeout` (and commit/merge on Orchestrator). No further verify mission required for this task.
