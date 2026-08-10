# Findings round 1

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p3-interop-pdf`
- branch: `task/08-10-frontend-rebuild-p3-interop-pdf`
- head_sha: `04a515ff34227f4025cda58ffcc57fbd39198041` (base; P3 product files still uncommitted in working tree)
- round: 1
- method: static review of prd/design/implement + P3 pure helpers, controllers, Insights/Workbench UI, fake DesktopApi, e2e sketch; no product edits; tests not executed this round

## need_verify
- required: false

### Verify mission (defer to post-fix re-review)
- purpose: After F1–F2 (and any F* accepted) are fixed, prove unit/typecheck green and document residual E2E fixture gaps for AC1–AC6.
- questions:
  - Do pure + controller vitest suites under `apps/desktop/src/renderer/state/*{pdf,interop,task-package,reimport}*` pass?
  - Does `tsc -p apps/desktop --noEmit` (or package typecheck script) pass for desktop?
  - Does `p3-interop-pdf.spec.ts` pass for chrome reachability; which AC paths remain fixture-gated?
  - Static: no `lucide-react` in renderer, no `backdrop-filter` in product CSS?
- success_criteria:
  - Unit green for new P3 modules; typecheck clean
  - E2E: Insights interop/task sections + reimport dialog cancel + non-PDF hides PDF chrome
  - Residual risks for PDF/real interop apply listed with skip reasons
- failure_signals:
  - Any failing P3 unit or type error in new controllers/panels
  - Console/page errors on Insights reachability path
- suggested_commands:
  - `pnpm exec vitest run apps/desktop/src/renderer/state --reporter=dot`
  - `pnpm exec tsc -p apps/desktop --noEmit`
  - `rg -n "lucide-react" apps/desktop/src/renderer && exit 1 || true`
  - `rg -n "backdrop-filter" apps/desktop/src/renderer --glob '*.css' && exit 1 || true`
  - `pnpm exec playwright test apps/desktop/tests/e2e/p3-interop-pdf.spec.ts` (env-dependent)
- scope: `apps/desktop` renderer state/UI + desktop e2e p3 (and focused p0–p2 only if time)
- avoid: full monorepo / unrelated packages
- related_issues: F3, F6 (evidence); residual AC gaps after F1–F2 fixed

## issues

### F1
- severity: major
- files:
  - `apps/desktop/src/renderer/state/use-reimport-controller.ts` (apply catch → `status: "error"`)
  - `apps/desktop/src/renderer/state/reimport-view.ts` (`canConfirmReimportApply` only allows `planReady`)
- problem: Failed `document.reimport.apply` sets `status: "error"` while keeping `preview`. `canApply` / `canConfirmReimportApply` only accept `planReady`, and the hook maps non-`planReady` to effectively closed for apply. User cannot retry Apply without re-picking/re-previewing. Violates PRD AC6 / design error matrix (failed apply retains open plan for retry) and interop’s better pattern (error + retained preview/selection).
- minimal_fix: On apply catch, keep `preview`/`path`, set `error` from `toUiError`, restore `status: "planReady"` (and `pending: false`). Optionally allow `canConfirmReimportApply` to treat `error` + `hasPreview` as retriable if you prefer an explicit `"error"` UI state.
- status: open

### F2
- severity: major
- files:
  - `apps/desktop/src/renderer/state/use-interop-controller.ts` (`preview` success branches)
- problem: Every interop review/table `preview(offset)` replaces `selectedRowIds` with `initialSelectionFromEligible(eligible)` for the **current page only**. Paging therefore drops prior-page selections. Task package correctly uses `mergePageSelection`. PRD R2.3 requires explicit selected IDs; panels already expose Previous/Next when `total > limit`, so multi-page apply is broken by construction.
- minimal_fix: Mirror task package: first open (no `previewId` / new preview) seed eligible on page; subsequent page loads use `mergePageSelection(current, pageRowIds, selectedOnPage)` and only auto-select newly eligible rows on first load. On terminal status, clear selection (already done).
- status: open

### F3
- severity: minor
- files:
  - `apps/desktop/src/renderer/workbench/PdfPageReview.tsx` (`if (!hasPages) return null`)
  - `apps/desktop/src/renderer/state/use-pdf-review.ts` (list error → `pages: []`)
- problem: When `pdf.page.list` fails, pages stay empty so the dock never mounts and `listError` is never shown. Non-PDF empty list is correctly hidden; failed list for a PDF-backed doc is silent.
- minimal_fix: Render a thin error chrome when `listStatus === "error"` even if `pages.length === 0` (still no fake page chrome). Keep hide-on-empty-ready for non-PDF.
- status: open

### F4
- severity: minor
- files:
  - `apps/desktop/src/renderer/surfaces/Workbench.tsx` (reimport entry present)
  - `apps/desktop/src/renderer/surfaces/ProjectHome.tsx` (no reimport action)
- problem: PRD R4 / design A4 allow Project Home **and/or** Workbench entry. Only Workbench has Reimport. Acceptable if intentional, but AC6 “document lifecycle entry” is incomplete for Home-only workflows.
- minimal_fix: Either add a document-scoped Reimport action on Project Home when a document context exists, or document residual risk as “Workbench-only entry” in closeout if product accepts.
- status: open

### F5
- severity: minor
- files:
  - `apps/desktop/src/renderer/insights/TaskPackagePanel.tsx`
  - design.md §7.2
- problem: Design calls for confirm dialogs on apply/discard; task package Apply/Import/Discard fire RPC immediately. Reimport uses preview-then-Apply as soft confirm (OK). Risk of accidental discard/apply.
- minimal_fix: Wrap discard (and optionally apply/import) with existing `ConfirmDialog` + actor/reason already on form.
- status: open

### F6
- severity: major
- files:
  - `apps/desktop/tests/e2e/p3-interop-pdf.spec.ts`
  - PRD AC1–AC6, AC10
- problem: E2E only proves Insights section reachability, non-PDF hides PDF dock, reimport open/cancel. No real-Engine export→preview→apply for review/table/task; PDF path is fully env-gated skip. Matches implement “p3 e2e partial” claim but leaves AC3–AC5 unproven at E2E layer (unit covers happy paths with fakes only).
- minimal_fix: Expand e2e when fixtures exist (export path env, DOCX/XLSX/.tltask under test data); keep explicit `test.skip` with reason otherwise. Ensure unit suites stay green as primary proof for selection/ops until fixtures land.
- status: open

### F7
- severity: nit
- files:
  - `apps/desktop/src/renderer/state/use-pdf-review.ts` (`void desktopApi()` in `submitCorrect`)
- problem: Dead harness call; noise only.
- minimal_fix: Remove the no-op line.
- status: open

### F8
- severity: minor
- files:
  - `apps/desktop/src/renderer/state/use-pdf-review.ts` (list effect deps on `documentId` only)
  - `apps/desktop/src/renderer/App.tsx` (generation invalidate without re-list)
- problem: On `featureGeneration` reconnect invalidation, in-flight PDF ops are dropped but list/get is not re-issued (unlike Asset Hub reload-on-generation). User can keep stale empty/error dock until document switch.
- minimal_fix: When generation changes and `documentId` is set, re-run `listPages` after invalidate (same pattern as asset controller section reload).
- status: open

### F9
- severity: nit
- files:
  - `apps/desktop/src/renderer/state/use-interop-controller.ts` (`toggleRow`)
- problem: `toggleRow` does not re-check disposition eligibility (only terminal). UI checkboxes disable non-eligible rows, so product path is OK; defensive filter would match task package `isSafeSelectableRow`.
- minimal_fix: When selecting, require row disposition `changed` (review) / `valid` (table).
- status: open

## assumptions
- Engine methods + DesktopApi dialogs already exist (A1); static types and fake stubs align with `protocol.generated.ts` for `pdf.*`, `interop.*`, `taskPackage.*`, `document.reimport.*`.
- Feature-op pattern via local `opRef` + `featureGeneration` invalidate matches P2 asset/editor practice sufficiently for R5.4 (not shared `beginOp` tokens).
- No glass/Lucide found in grepped product CSS/renderer for this change set (static sample only; verify post-fix).
- Working tree has large uncommitted P3 surface; review is of that tree, not a commit.
- Unit “green” claim is trusted only after verify; not re-run here.

## residual risks
- Real PDF E2E depends on Poppler/Tesseract + `TRANSLUNAR_TEST_PDF` (PRD A6).
- Interop/table/task real-Engine e2e fixtures may be absent on CI agents.
- Insights document identity for review export uses `project.get` + first document fallback when Insights has no workbench document — correct for multi-doc projects only if Engine/document picker is enough; no document picker on Insights review panel beyond export using resolved document.

## summary_for_orchestrator
P3 shape is largely complete: pure helpers, four controllers, Insights interop/task sections, Workbench PDF dock + OCR dialog, reimport modal, fake DesktopApi P3 methods, and a partial e2e. **Two majors block green:** (F1) reimport apply failure disables retry despite retained plan; (F2) interop preview paging wipes cross-page selection. **F6** is acceptance risk (E2E partial). Ship path: **fix F1+F2** (and ideally F3/F8), then re-review with **need_verify** running unit + typecheck + p3 e2e + static greps. Do not closeout on chrome-only e2e alone.

## Review Complete
### Findings file
- `.trellis/tasks/08-10-frontend-rebuild-p3-interop-pdf/review/findings-1.md`
### Verdict
- need_fix
### Verify mission
- none this round (defer post-fix; draft mission recorded under need_verify for next review)
### Open counts
- blocker: 0
- major: 3 (F1, F2, F6)
- minor: 4 (F3, F4, F5, F8)
- nit: 2 (F7, F9)
- needs_evidence: 0
### Blocked for re-plan
- none
### resume_hint
- Spawn trellis-fix for F1 (reimport status on apply error) and F2 (interop selection merge on page). Optionally F3/F8. Then re-review → verify mission (vitest state, tsc desktop, p3 e2e, static greps).
