# Verify report round 2

## mission_echo
- purpose: After focused fix round 2, prove that confirm serializes the latest draft without loss, every valid recovered draft remains recoverable, reconnect and IME behavior satisfy their interaction contracts, and the real Engine completes the previously blocked export/resume chain; partial verify-1 cannot support closeout.
- related_issues: F1, F2, F3, F4, F7, F13, F14, F15
- questions_addressed:
  - Q1 (confirm during older `segment.updateTarget` flush): **pass (unit + App integration)** — `SaveCoordinator.flush()` loops until `editGeneration === savedGeneration` (or compose/error); `confirmSegment` aborts without focus advance when flush is not generation-stable; App test defers first `updateTarget`, types `second-draft` mid-flush, retains draft; coordinator unit proves second generation is the saved payload.
  - Q2 (IME composition lifecycle): **pass (App integration + pure guards)** — compositionstart → input past debounce → Ctrl+Enter with 229/`isComposing` → Confirm click produce zero `segment.updateTarget` / `segment.confirm`; after compositionend, update then confirm succeed. Real OS IME remains unanswered (manual).
  - Q3 (multi-record recovery): **pass (App integration + controller maps)** — journal with two valid records: Recover applies seg-1, visit seg-2 applies pending draft-two; each record cleared only after its domain save path; `pendingRecoveredRef` retains all validated maps.
  - Q4 (`clearDraftJournal` reject after Engine save): **pass (SaveCoordinator unit + App integration)** — Engine target remains `engine-kept` / `kept-on-engine`; `journal-error` UI and coordinator `journalError` surface clear failure without rolling back domain save.
  - Q5 (reconnect dirty Workbench): **pass for Workbench dirty path (App integration + code)** — reconnecting disables editor, Workbench stays mounted, draft retained through deferred rehydrate, re-enabled after hydrate. `failed` status disable and **QA-surface issue refresh on reconnect** are implemented in controller but not separately integration-asserted.
  - Q6 (Recovery keyboard): **pass (RTL component tests)** — Recover/Retry first focus, Tab/Shift+Tab trap, Escape non-destructive, prior focus restored on unmount.
  - Q7 (real-Engine export/resume + Project Home Open): **pass (Playwright 2/2)** — single-segment fixture; clear gate path yields `export-result`, real export file via `access(exportPath)`, Export axe + console empty, close/relaunch resumes Workbench for `P0 Demo`; Project Home Open resumes `Listed`.
  - Q8 (manual `pnpm dev:desktop` AC17): **unanswered** — real OS IME and live Engine kill/restart not executed in this verify pass; not green-washed.
  - Q9 (focused quality commands): **pass** — unit 144/144, typecheck, eslint, prettier (incl. lockfile), desktop build, Engine build, Playwright 2/2 all exit 0.

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- head_sha (git): `66252c8f4304bb025538fc5261c0608fa5a9025c` (working tree still broadly dirty with rebuild; implementation not fully committed at verify time)
- OS: Windows (MINGW64_NT-10.0-26200)
- node: v22.19.0
- pnpm: 10.18.3
- package under test: `@translunar/desktop`
- fixture: `apps/desktop/tests/e2e/fixtures/single-segment-source.txt` (1 line; deterministic single segment)
- deviations:
  - Did **not** run `pnpm dev:desktop` manual IME / live Engine restart walkthrough (AC17). Documented under `unanswered`.
  - Playwright worker completed both cases in ~5.7s (Engine already warm from prior cargo build).
  - Full monorepo / Rust workspace suite / packaging intentionally avoided per mission.
  - Prettier command **included** `pnpm-lock.yaml` as required by F9 / frozen command (verify-1 had omitted it).

## actions

### A1 — desktop unit / integration tests
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- duration_note: ~17.3s
- log_excerpt: |
    Test Files  19 passed (19)
    Tests  144 passed (144)
    ✓ save-coordinator.test.ts (6)
    ✓ RecoveryDialog.test.tsx (2)
    ✓ ime.test.ts (4)
    ✓ draft-recovery.test.ts (7)
    ✓ App.integration.test.tsx (15)
         ✓ keeps newer draft when typing during deferred update flush under confirm
         ✓ blocks confirm and focus side effects during composition lifecycle
         ✓ restores every valid multi-record journal draft when visiting segments
         ✓ retains dirty draft and disables mutations across reconnect rehydrate
         ✓ shows journal clear failure without losing Engine save
- interpretation: Claimed fix-round-2 evidence tests are present and green. Count moved 135→144 vs verify-1. Covers F1/F2/F3/F4/F14/F15 product paths that have automated harnesses.

### A2 — typecheck
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.renderer.json && tsc -p tsconfig.e2e.json
- interpretation: Electron, renderer, and e2e TS projects typecheck clean.

### A3 — ESLint (touched paths)
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 0
- interpretation: No lint errors on renderer + e2e scope.

### A4 — Prettier (incl. lockfile)
- command: `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json pnpm-lock.yaml`
- exit_code: 0
- log_excerpt: |
    Checking formatting...
    All matched files use Prettier code style!
- interpretation: Formatting gate green including lockfile (F9 residual).

### A5 — desktop build
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- duration_note: ~0.85s vite + tsc electron
- log_excerpt: |
    dist/renderer/assets/index-CSpn2zHi.js   259.16 kB │ gzip: 77.48 kB
    ✓ built in 846ms
    vite build && tsc -p tsconfig.electron.json
- interpretation: Production renderer + electron compile succeeds after fix round 2.

### A6 — Engine crate build
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.81s
- interpretation: Real Engine binary available for Electron e2e.

### A7 — real-Engine Playwright P0
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts`
- exit_code: 0
- duration_note: ~5.7s
- log_excerpt: |
    Running 2 tests using 1 worker
    [1/2] welcome → create → import → edit/confirm → QA → export → resume
    [2/2] project home Open resumes an existing project
    2 passed (5.7s)
- interpretation: **F7 unblocked.** Spec uses `fixtures/single-segment-source.txt`, iterates confirm until all segments confirmed, requires `export-result` (not Blocked), `access(exportPath)`, Export axe + console empty, relaunch resumes Workbench with project name; second case proves Project Home Open. Contrast verify-1: 1 fail / 1 pass at Gate: Blocked · 2 errors on multi-segment welcome fixture.

### A8 — static/code evidence for residual contract edges
- command: (read-only inspection; no extra process)
- exit_code: n/a
- evidence:
  - `save-coordinator.ts` `flush()`: for-loop up to 32 iterations until generation stable; does not return after first in-flight save if dirty newer gen.
  - `use-app-controller.ts` `confirmSegment`: `flushStable` requires matching generations, draft===engine, not saving/scheduled/error/composing; aborts with `pendingConfirm: false` when unstable; post-confirm `generationUnchanged` blocks focus advance on newer draft.
  - `pendingRecoveredRef` + `attachSegmentWithPending` + clear-on-clean-save for multi-record retention.
  - Reconnect: `onEngineStatus` disables mutations on reconnecting/failed; `rehydrateHydratedSurface` snapshots dirty draft, re-enters workbench, and on QA surface re-lists `qa.issue.list`.
  - RecoveryDialog RTL: Recover/Retry primary focus, Tab trap, Escape non-destructive, focus restore.
- interpretation: Product code matches claimed recipes. QA-on-reconnect and live `failed` path remain thinner on automated surface than workbench dirty rehydrate.

## findings_for_reviewer

### V1
- severity: info
- related_review_ids: F1
- title: Confirm/flush generation race appears fixed under automated harness
- evidence: `save-coordinator.ts` flush loop; `use-app-controller.ts` confirmSegment flushStable; tests `keeps newer draft when typing during deferred update flush under confirm`, `flush serializes a newer draft typed while updateTarget is in flight`, `preserves newer draft when an older in-flight save resolves`
- detail: Mid-flush typing of `second-draft` retains editor value; coordinator flush saves newest generation. Confirm either aborts while dirty or only proceeds after serialization of latest target — stale first-only confirm without retained draft would fail the App test.
- suggested_next: Review may close F1 if satisfied with integration proof; optional extra test that explicitly defers `segment.confirm` itself (not only updateTarget) remains nice-to-have, not a failure signal observed here.

### V2
- severity: info
- related_review_ids: F2
- title: Composition lifecycle integration proof present
- evidence: `App.integration.test.tsx` `blocks confirm and focus side effects during composition lifecycle`; `ime.test.ts` pure guards
- detail: Zero update/confirm during composition + 229; post-compositionend normal update+confirm. Satisfies AC7 automated component/controller proof that verify-1 lacked.
- suggested_next: Review may mark F2 fixed for automated evidence; real OS IME still V6/unanswered.

### V3
- severity: info
- related_review_ids: F3
- title: Multi-record pending recovery retained and applied per segment
- evidence: `pendingRecoveredRef` in `use-app-controller.ts`; `restores every valid multi-record journal draft when visiting segments`
- detail: Two journal records recovered: seg-1 then seg-2 drafts both shown; journal entries cleared after saves rather than dropped at enterWorkbench for non-active only.
- suggested_next: Review may close F3 on this evidence.

### V4
- severity: info
- related_review_ids: F4
- title: Dirty Workbench reconnect contract integration-proven; QA surface thinner
- evidence: `retains dirty draft and disables mutations across reconnect rehydrate`; controller `rehydrateHydratedSurface` QA branch with `qa.issue.list`
- detail: Workbench dirty path: mounted, draft kept, disabled through deferred list, re-enabled after hydrate. QA-active refresh and explicit `failed` status sequence are code-backed but not mirrored as a dedicated App test case.
- suggested_next: Review can accept F4 as fixed for primary AC12 workbench contract, or keep a minor residual if QA-on-reconnect must be auto-proven before closeout.

### V5
- severity: info
- related_review_ids: F7, F13
- title: Real-Engine P0 export/file/resume and Project Home Open green
- evidence: Playwright 2/2 exit 0; `fixtures/single-segment-source.txt`; export path `access(exportPath)`; relaunch Workbench `P0 Demo`; Open → Workbench `Listed`
- detail: Previously blocked multi-segment welcome gate path is replaced by deterministic fixture + confirm-all loop. Blocked is not accepted (`toHaveCount(0)` for /Blocked/i after export-result). Confirmed chip + TM collapse/expand still exercised.
- suggested_next: Review may close F7; F13 export/resume automated chain is now evidence-complete — residual F13 only if AC17 manual remains required for full acceptance.

### V6
- severity: minor
- related_review_ids: F13, F2, F4
- title: Manual AC17 (real OS IME + live Engine kill/reconnect) not executed
- evidence: No `pnpm dev:desktop` session in this verify; mission Q8 unanswered by design this pass
- detail: Automated composition, fake status reconnect, and main-process engine-client kill tests do not substitute for real OS IME composition or live Engine process death under the Electron shell with human observation of console/banner.
- suggested_next: Orchestrator/reviewer decide whether closeout requires human AC17 walkthrough or waives with residual risk note. Do not treat as green.

### V7
- severity: info
- related_review_ids: F14, F15
- title: Recovery keyboard and journal-clear-failure tests green
- evidence: `RecoveryDialog.test.tsx` (2); `surfaces journal clear failure without rolling back Engine save`; App `shows journal clear failure without losing Engine save` / `journal-error`
- detail: F14/F15 minimal_fix evidence is present and passing.
- suggested_next: Review may close F14/F15.

### V8
- severity: noise
- related_review_ids: new
- title: Git HEAD still equals pre-rebuild SHA with large dirty tree
- evidence: `git rev-parse HEAD` → `66252c8f…`; status shows mass deleted legacy renderer + uncommitted rebuild
- detail: Verify ran against dirty working tree (same situation as verify-1). Not a product defect; Orchestrator must stage/commit intended task scope before merge.
- suggested_next: out_of_scope for product fix; Orchestrator git hygiene.

## unanswered
- Real OS IME composition (Chinese/Japanese IME engine) under `pnpm dev:desktop` with no renderer console errors (AC17).
- Live Engine unexpected-exit / force-kill while Workbench is dirty, observing banner stage layout, draft retention, and re-enable under the packaged Electron shell (AC17). Not the same as main-process unit reconnect tests.
- Dedicated App integration assertion that QA surface after reconnect calls `qa.issue.list` and refreshes issues (code path exists; only workbench dirty rehydrate is auto-tested).
- Explicit deferred-`segment.confirm` mid-flight typing test (updateTarget deferral + generation post-check cover the primary F1 race; confirm-RPC deferral not separately timed).

## overall
- mission_status: **partial**
- summary_for_reviewer: Fix round 2's automated contracts largely hold. Focused quality gates are all green (144 unit tests, typecheck, eslint, prettier+lockfile, desktop build, Engine build). Real-Engine Playwright is **2/2** with clear-gate export, real file, axe/console, relaunch resume, and Project Home Open — the verify-1 export blocker is gone. F1 flush-until-clean + confirm abort, F3 multi-record pending maps, F2 composition lifecycle, F4 dirty reconnect (workbench), F14 Recovery keyboard, and F15 journal-clear failure all have passing automated evidence. Remaining risk is honest residual: **manual AC17** (real OS IME + live Engine kill) was not run, and QA-surface reconnect refresh is code-only. Mission is partial solely for those unperformed/manual edges — not because automated product paths still fail.
- recommended_review_focus:
  1. Reconcile F1–F4, F7, F13–F15 statuses against V1–V7 evidence (likely fixed / fixed-with-residual-manual).
  2. Decide if AC17 human walkthrough is required before closeout or remains accepted residual risk.
  3. Do not re-open F7 on fixture grounds unless a new real-Engine failure appears; current e2e is green with single-segment fixture + confirm-all.
  4. Orchestrator: commit scoped dirty tree before merge.
