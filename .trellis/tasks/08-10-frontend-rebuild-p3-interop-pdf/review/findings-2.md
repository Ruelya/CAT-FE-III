# Findings round 2

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p3-interop-pdf`
- branch: `task/08-10-frontend-rebuild-p3-interop-pdf`
- head_sha: `04a515f` (P3 product files still largely uncommitted in working tree)
- round: 2
- method: disposition of verify-2 mission (typecheck, unit 244, build, p0–p3 Playwright, static greps) + closure of verify-1 V1 / F1–F2 / F3 non-PDF mount

## need_verify
- required: false

## issues

### F1
- severity: major
- problem: Reimport apply failure set `status: "error"` so Apply could not retry with retained plan.
- status: fixed
- evidence: `use-reimport-controller` restore `planReady` on apply catch; unit “failed apply keeps planReady so Apply can retry”; verify-2 V3.

### F2
- severity: major
- problem: Interop preview paging replaced selection with current-page eligible only (lost cross-page IDs).
- status: fixed
- evidence: `use-interop-controller` uses `mergePageSelection` on subsequent pages; unit suite green; verify-2 V3.

### F3
- severity: minor
- problem: Failed `pdf.page.list` left empty pages and never mounted error chrome; non-PDF InvalidRequest risked wrong chrome.
- status: fixed (product intent closed by verify-2)
- evidence: `isNonPdfDocumentListError` + `shouldMountPdfDock`; non-PDF → hide; real list error → thin chrome; Playwright `pdf-page-review` count 0 on txt fixture; unit non-PDF list mapping.

### F4
- severity: minor
- problem: Reimport entry is Workbench-only (no Project Home action).
- status: wontfix
- note: PRD R4 allows Home **and/or** Workbench. Waived as residual; Workbench document-scoped entry satisfies lifecycle path.

### F5
- severity: minor
- problem: Task package Apply/Import/Discard fire RPC without extra ConfirmDialog.
- status: wontfix
- note: Soft guards (actor/reason, selection, terminal disable) remain; explicit confirm polish deferred.

### F6
- severity: major (acceptance risk)
- problem: E2E only proves chrome reachability; real PDF/interop/table/task Engine paths fixture-gated.
- status: wontfix (waived for closeout)
- note: Honest `test.skip` when `TRANSLUNAR_TEST_PDF` / `TRANSLUNAR_TEST_INTEROP_REVIEW` / `TRANSLUNAR_TEST_INTEROP_TABLE` / `TRANSLUNAR_TEST_TASK_PACKAGE_INPUT` unset. Unit + fake DesktopApi remain primary proof for selection/ops. Track fixtures separately if product needs full AC3–AC5 E2E.

### F7
- severity: nit
- problem: Dead `void desktopApi()` harness call in PDF correct path (if still present historically).
- status: wontfix
- note: Non-blocking noise; not in mission success bar.

### F8
- severity: minor
- problem: Feature-generation invalidate may not re-list PDF pages until document switch.
- status: wontfix
- note: Optional polish; reconnect drops in-flight ops (existing feature-op contract). Follow-up if stale empty dock appears in field.

### F9
- severity: nit
- problem: Interop `toggleRow` relies on UI disable rather than disposition re-check.
- status: wontfix
- note: Product path OK; defensive parity with task package optional.

## verify disposition
- verify-1 V1 (non-PDF mounts `pdf-page-review`): **closed** — verify-2 A5 + pure helpers.
- verify-2 mission_status: **satisfied**
- Typecheck desktop: green
- Unit: **244/244**
- Build desktop: green
- Playwright: p0–p2 **6/6** green; p3 reachability green; **4** fixture skips (honest)
- Static: `lucide-react` = 0, `backdrop-filter` = 0 in product renderer CSS

## residual risks (waived for green_for_closeout)
- Real-Engine PDF/OCR and interop/table/task apply E2E require env fixtures + Poppler/Tesseract where applicable.
- Monorepo eslint test-stub `require-await` debt and unrelated engine `declarative_toolkit` failure are out of desktop P3 product scope (verify-1 noise).

## assumptions
- Orchestrator mission bar was “p0–p2 green and p3 e2e reachability fixed” — met.
- Fixture-gated AC3–AC5 accepted as residual with unit proof (PRD A6 / implement WP6).

## summary_for_orchestrator
Round-2 review accepts verify-2 evidence. Majors F1/F2 fixed; non-PDF PDF-dock V1 fixed; F6 fixture residual waived. Optional minors F4/F5/F8 and nits waived. **Verdict: green_for_closeout.** Proceed to closeout (specs + closeout-summary); Orchestrator owns commit/merge/archive.

## Review Complete
### Findings file
- `.trellis/tasks/08-10-frontend-rebuild-p3-interop-pdf/review/findings-2.md`
### Verdict
- green_for_closeout
### Verify mission
- none (verify-2 already satisfied)
### Open counts
- blocker: 0
- major: 0 open (F1/F2 fixed; F6 waived residual)
- minor: 0 open blocking (F4/F5/F8 waived)
- nit: 0 open blocking
### Blocked for re-plan
- none
### resume_hint
- Closeout: update `.trellis/spec/frontend` for P3 PDF dock / interop / task package / reimport; write `closeout-summary.md`. No further quality loop.
