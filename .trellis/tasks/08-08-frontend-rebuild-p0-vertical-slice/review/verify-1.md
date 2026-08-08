# Verify report round 1

## mission_echo
- purpose: After claimed F1–F12 fixes, establish runtime/static evidence for IME, save/confirm concurrency, recovery, reconnect, keyboard a11y, and real-Engine export/resume — without treating process exit codes alone as product proof. F13 remains `needs_evidence` until this report.
- related_issues: F1, F2, F3, F4, F6, F7, F13 (plus quality gates F8–F12 collateral)
- questions_addressed:
  - Q1 (IME composition beyond debounce): **partial pass (unit + static)** — `segment.updateTarget` is blocked while composing past debounce; confirm/focus blocked by pure IME guards + controller guards; no real-browser multi-key composition lifecycle and no assert that confirm/focus call counts stay zero under composition.
  - Q2 (typing during confirm): **partial (code + update-path unit)** — generation-bound confirm retains newer draft and skips focus advance when generation changes; deferred-confirm integration test is missing.
  - Q3 (stale updateTarget after confirm rehydration): **partial pass (unit + code)** — one-shot `takeLastUpdatedSegment` / flush ack proven; full update→confirm→clean row-selection regression suite not present.
  - Q4 (journal classify + write/clear failures): **partial pass** — missing-segment/stale-revision classification unit-tested; journal write failure surfaced; journal clear failure coded but not auto-tested; Recover UI path not exercised.
  - Q5 (Engine failure/reconnect dirty target): **partial (static + main-process)** — controller snapshots draft, disables mutations, refreshes QA; no renderer integration proof of dirty survival / layout retention under reconnect.
  - Q6 (keyboard segment + Recovery a11y): **partial pass** — inactive segment keyboard activation integration-tested; Recovery focus/trap/Escape/restore implemented in component code, not automated.
  - Q7 (real-Engine P0 acceptance): **failed on export gate** — Project Home Open e2e passed; main vertical slice reached confirmed + QA + Export UI then **Gate: Blocked · 2 errors**; no export file; resume after export not reached.
  - Q8 (quality commands): **partial** — typecheck, eslint, prettier, build, cargo engine build, and desktop unit suite all pass; focused real-Engine e2e is **1 passed / 1 failed**.

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- head_sha (git): `66252c8f4304bb025538fc5261c0608fa5a9025c` (working tree dirty with rebuild; implementation not fully committed at verify time)
- OS: Windows (MINGW64_NT-10.0-26200)
- node: v22.19.0
- pnpm: 10.18.3
- package under test: `@translunar/desktop`
- deviations:
  - Suggested Prettier path included `pnpm-lock.yaml`; used `apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json` (renderer/e2e/package scope). Passed.
  - `pnpm --filter @translunar/desktop test` runs the full desktop vitest package (main + renderer), not only the 24 renderer tests from findings round 1 — **135/135** passed.
  - Did **not** run `pnpm dev:desktop` manual IME/recovery/reconnect walkthrough; automation + static code review used instead. Residual risk called out under unanswered.
  - Playwright finished with 1 fail / 1 pass; pnpm wrapper also printed `Command "playwright" not found` after the run (secondary packaging noise; the Electron worker did execute).

## actions

### A1 — unit/component tests
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- duration_note: ~17s
- log_excerpt: |
    Test Files  18 passed (18)
    Tests  135 passed (135)
    ✓ save-coordinator.test.ts (4)
    ✓ draft-recovery.test.ts (7)
    ✓ ime.test.ts (4)
    ✓ App.integration.test.tsx (10)
- interpretation: Focused product regressions claimed by F1–F12 that have unit/integration coverage are green. Does not prove real-Engine gate/export or live IME/reconnect.

### A2 — typecheck
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.renderer.json && tsc -p tsconfig.e2e.json
- interpretation: Electron, renderer, and e2e TS projects typecheck clean after fixes.

### A3 — ESLint (touched paths)
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 0
- interpretation: No lint errors on renderer + e2e scope.

### A4 — Prettier
- command: `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json`
- exit_code: 0
- log_excerpt: |
    Checking formatting...
    All matched files use Prettier code style!
- interpretation: F9 formatting gate is green on the rebuild paths.

### A5 — desktop build
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    ✓ built in 925ms
    dist/renderer/assets/index-Dse-UqyX.js   258.38 kB │ gzip: 77.26 kB
    vite build && tsc -p tsconfig.electron.json
- interpretation: Production renderer + electron compile succeeds.

### A6 — Engine crate build
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.92s
- interpretation: Real Engine binary available for Electron e2e.

### A7 — real-Engine Playwright P0
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts`
- exit_code: 1
- duration_note: ~51s
- log_excerpt: |
    [1/2] welcome → create → import → edit/confirm → QA → export → resume  FAILED
      Error: expect(locator).toBeVisible() failed
      Locator: getByTestId('export-result')
      Timeout: 45000ms
    [2/2] project home Open resumes an existing project  PASSED
    1 failed, 1 passed
- artifact: `apps/desktop/test-results/p0-vertical-slice-P0-verti-45adb-firm-→-QA-→-export-→-resume-electron/error-context.md`
- error-context observation: |
    Export surface visible with:
      Gate: Blocked · 2 errors · 0 warnings
      Open QA button present
    No export-result node (document.export never succeeded / not reached).
- interpretation: Failure is **product/fixture acceptance**, not a hang or missing picker. The fixture path reaches Workbench, confirms at least one segment (status-chip assertion passed), runs QA UI, then `qa.gate.check` returns **not clear** with 2 errors. E2E correctly refuses to treat `Blocked` as success (F7 intent). Root cause: welcome `source.txt` has multiple paragraphs/segments; the spec only fills/confirms the first target (`欢迎使用 Translunar。`); remaining empty targets produce Engine empty-target-style QA errors that block the gate. Project Home Open path is proven.

### A8 — static/code evidence review (no extra process)
- files: `save-coordinator.ts`, `use-app-controller.ts` (confirm/reconnect/recover), `TargetEditor.tsx`, `RecoveryDialog.tsx`, `SegmentGrid.tsx`, `ime.ts`, `draft-recovery.ts`, tests listed above
- interpretation: Used to answer concurrency/IME/recovery/reconnect questions where tests are incomplete.

## answers_to_mission_questions

### Q1 — IME composition beyond debounce: zero update/confirm/focus until composition ends?
- result: **Mostly evidenced at unit/static layer; residual real-IME risk**
- evidence:
  - `save-coordinator.test.ts`: composing + draft `"中"` + advance 500ms → **0** `segment.updateTarget`; after `setComposing(false)` update fires; draft retained.
  - `save-coordinator.ts` `setComposing(true)` clears save timer; `#saveNow`/`flush`/`#scheduleSave` refuse domain mutation while composing.
  - `ime.test.ts`: `isComposing`, `keyCode === 229`, `which === 229` all block confirm via `shouldBlockConfirm`.
  - `TargetEditor.tsx`: Ctrl/Cmd+Enter returns **before** `preventDefault`/`onConfirm` when any of the three IME signals is set.
  - `confirmSegment`: early-return on `shouldBlockConfirm` and `saveCoordinator.active?.isComposing`.
- residual_risk:
  - No test that composition-start cancels an **already-scheduled** save that was armed pre-composition and then asserts zero Engine calls (timer cancel is coded; only post-composition-start schedule path is covered).
  - No automated assert that `segment.confirm` call count and focus/selection stay zero across a multi-event composition lifecycle (only pure confirm-block predicates).
  - No real OS IME (Chinese/Japanese) manual session in this verify pass.

### Q2 — Typing during confirm: newer draft retained; stale confirm no focus advance; no obsolete revision overwrite?
- result: **Code path present; deferred-confirm product test missing**
- evidence:
  - `confirmSegment` binds `boundGeneration` / `postFlushGeneration`; if `!generationUnchanged` after confirm + rehydrate → merges rows/counts, **does not** advance `activeSegmentId`/`focusSegmentId`, re-applies engine segment under retained draft via `applyEngineSegment` (which keeps newer local draft when dirty).
  - `save-coordinator.test.ts` “preserves newer draft when an older in-flight save resolves” (update path, not confirm path).
- residual_risk:
  - No deferred-`segment.confirm` integration test typing mid-flight and asserting journal + draft + no focus advance + no obsolete revision attach.
  - Reviewer should treat F1 fix as **implemented, incompletely proven**.

### Q3 — After confirm rehydration, can stale updateTarget regress confirmed row/counts?
- result: **Primary sticky-ack path fixed and unit-tested; full row-selection scenario untested**
- evidence:
  - `takeLastUpdatedSegment()` is one-shot; test expects second `flush()` returns `updatedSegment: null`.
  - `flushOrStay` applies only that one-shot ack (“never sticky reapplication”).
  - Confirm rehydrates from `listAllEditorRows` for authoritative rows/counts after confirm.
- residual_risk:
  - No automated update→confirm→select-clean-row sequence asserting confirmed chip/revision/counts cannot regress from a late update response.

### Q4 — Journal missing-segment / stale-revision classified; write/clear failures visible?
- result: **Classification + write-failure yes; clear-failure + Recover UI partial**
- evidence:
  - `draft-recovery.test.ts`: missing segment → `stale`; revision mismatch → `stale`; extra missing segment isolated into `staleRecords` while matching remains recoverable.
  - `recoverDraft` re-runs `classifyDraftJournal` with live probes before applying; non-recoverable flips surface to stale mode.
  - Journal write reject → `result.journalError` set; domain save still succeeds; `Workbench` renders `editState.journalError`.
  - Clear failure sets `journalError` with message “Draft journal clear failed” without rolling back Engine save.
- residual_risk:
  - No unit/integration test for clear-failure visibility or retry UX.
  - No App-level Recover/Discard/stale dialog interaction test.

### Q5 — Engine failure/reconnect with dirty target?
- result: **Designed in controller; not renderer-proven**
- evidence:
  - On `reconnecting`/`failed`: `mutationsEnabled = false`.
  - On rehydrate of workbench: `snapshotActiveDraft` → `enterWorkbench` with `recoveredDrafts`.
  - QA reconnect path re-invokes `qa.issue.list` with loading true (not invented empty success).
  - `retryBoot` on hydrated surfaces calls rehydrate, not `BOOT_START`.
  - Main-process `engine-client.test.ts` proves child restart + `onReconnected` with new PID.
  - Integration: save-failure keeps Workbench + draft (`keep-me`) when leaving is attempted.
- residual_risk:
  - No test that injects Engine status `reconnecting`/`reconnected` while dirty and asserts draft text + mounted workbench + disabled controls + re-enable after hydrate.
  - Banner/grid layout retention not measured in this pass (static CSS change not re-validated visually).

### Q6 — Keyboard-only segment activation; Recovery focus/trap/Escape/restore?
- result: **Segment activation proven; Recovery a11y code-only**
- evidence:
  - `App.integration.test.tsx`: `segment-activate-seg-2` focused + Enter → `target-editor-seg-2` appears.
  - `SegmentGrid.tsx` exposes native button per inactive row (`segment-activate-*`).
  - `RecoveryDialog.tsx`: initial focus on `primaryRef` (Recover or Retry); Tab/Shift+Tab wrap within dialog; Escape `preventDefault` without discard; unmount restores prior focus.
- residual_risk:
  - No RTL/user-event test for Recovery initial focus, trap, Escape, or focus restore.
  - Escape “non-destructive” is implemented as no-op close (dialog stays open) — confirm product intent if Escape should dismiss without discard.

### Q7 — Real-Engine P0 (confirm, TM, QA, clear gate + export file, resume, Project Home Open, console/axe)?
- result: **Failed overall for export/resume acceptance; partial progress**
- evidence table:

  | Checkpoint | Result | Notes |
  | --- | --- | --- |
  | Create → import → workbench | pass | e2e reached workbench |
  | Exact TM collapse body mounted | pass (conditional) | exercised when collapse control visible |
  | Authoritative confirm UI | pass | `.status-chip--confirmed` visible |
  | QA surface + Run QA | pass to UI | list/run interactions; issues text matched loose regex |
  | Clear gate + export file | **fail** | `Gate: Blocked · 2 errors · 0 warnings`; no `export-result`; `access(exportPath)` not reached |
  | Resume after export | **not reached** | app closed only in failure teardown |
  | Project Home Open | **pass** | second test; Open → workbench + shell name |
  | Console errors (full path) | incomplete | first test failed before final console assert; no failure attributed to console |
  | axe serious/critical | partial | welcome/workbench/qa stages ran before export fail; export axe not reached; no serious reported on completed stages |

- failure_diagnosis:
  - Welcome fixture `apps/desktop/resources/examples/welcome/source.txt` is multi-paragraph (≥3 logical paragraphs / multiple Engine segments).
  - Spec confirms only the first editor value.
  - Engine quality (`semantic.empty_target` / empty targets) blocks gate with **2 errors** — matches remaining empty segments.
  - This is exactly the failure signal called out in findings: *“The Electron test accepts Blocked as equivalent to successful export”* was fixed; the run now **honestly fails** instead of false-green. Fixture/spec still does not deterministically clear the gate (F7/F13 product proof incomplete).

### Q8 — typecheck, eslint, prettier, build, focused unit, focused e2e all pass?
- result: **All static/unit/build gates pass; e2e not all green**

| Command | Exit |
| --- | --- |
| desktop test | 0 (135/135) |
| desktop typecheck | 0 |
| eslint renderer+e2e | 0 |
| prettier check (scoped) | 0 |
| desktop build | 0 |
| cargo build -p translunar-engine | 0 |
| playwright p0-vertical-slice | **1** (1 fail / 1 pass) |

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F7, F13
- title: Real-Engine P0 export gate blocked (2 errors); no export file / resume proof
- evidence: Playwright failure at `export-result`; error-context shows `Gate: Blocked · 2 errors · 0 warnings`; fixture multi-segment + single-segment confirm in `p0-vertical-slice.spec.ts:166-174`; `source.txt` multi-paragraph
- detail: Post-fix e2e correctly rejects Blocked-as-success, but the deterministic passing-gate + file + relaunch/resume chain is still red. Likely fix: confirm/fill **all** fixture segments (or use a single-segment fixture) so `qa.gate.check` is clear under real Engine before asserting export path.
- suggested_next: fix_recipe_hint — make e2e (or fixture) multi-segment complete; optionally assert issue codes on QA before export; re-run only `p0-vertical-slice.spec.ts`

### V2
- severity: major
- related_review_ids: F1
- title: Confirm-in-flight typing / focus-advance not covered by deferred tests
- evidence: generation logic in `use-app-controller.ts` confirmSegment ~1025–1099; no matching deferred-confirm test under `App.integration.test.tsx` / save-coordinator
- detail: Save in-flight generation retention is unit-tested; confirm path relies on static review of generationUnchanged. Residual data-loss risk if binding logic regresses.
- suggested_next: fix_recipe_hint — deferred Promise around `segment.confirm` + type during flight + assert draft + no focus advance

### V3
- severity: major
- related_review_ids: F4, F13
- title: Dirty reconnect / mutations-disabled / QA refresh unproven at renderer layer
- evidence: controller rehydrate block ~470–545; no App.integration reconnect simulation; only main-process engine-client reconnect tests
- detail: Implementation matches R3/R4 intent; AC12 runtime evidence still open without status-event injection tests or manual demo.
- suggested_next: fix_recipe_hint — fake API emits reconnecting/reconnected with dirty draft assertions; optional manual `pnpm dev:desktop` note

### V4
- severity: minor
- related_review_ids: F6
- title: Recovery dialog keyboard contract untested
- evidence: `RecoveryDialog.tsx` implements primary focus, trap, Escape no-discard, restore; zero component tests reference `recovery-dialog` / `recovery-primary`
- detail: Segment keyboard path is proven; Recovery path is code-only. Escape currently does not close or discard (stay open).
- suggested_next: fix_recipe_hint — RTL tests for focus target, Tab cycle, Escape, restore

### V5
- severity: minor
- related_review_ids: F3
- title: Journal clear-failure visibility not auto-tested
- evidence: clear catch in `save-coordinator.ts` ~344–351; only write-failure test exists
- detail: Write failure path is green; clear failure may still silently fail UX if UI binding regresses.
- suggested_next: fix_recipe_hint — unit test rejecting `clearDraftJournal` after successful save

### V6
- severity: info
- related_review_ids: F2
- title: IME confirm/focus zero-side-effect not fully asserted under composition lifecycle
- evidence: updateTarget-zero proven; confirm/focus zero inferred from pure guards + early returns
- detail: Acceptable residual if review accepts unit+static for AC7; otherwise add composition-event TargetEditor/controller test counting confirm and selection changes.
- suggested_next: re-run_with optional composition event harness; or accept with residual risk

### V7
- severity: info
- related_review_ids: F5, F8–F12
- title: Collateral fix evidence from green unit/integration suite
- evidence: QA “No issues” only after list (`App.integration`); blocked-gate branch separate; Project Open works; 135 tests green; prettier/eslint/typecheck/build green
- detail: Supports treating many fixed findings as code-proven even where real-Engine path is still red.
- suggested_next: out_of_scope for further verify unless regressions appear

## unanswered
- Real OS IME composition (Chinese/Japanese) lasting >350ms inside live Electron — not manually executed.
- Live Engine kill/reconnect with dirty target in the product UI — not executed (no safe automated kill hook used beyond main-process unit tests).
- Recovery dialog focus trap / Escape / restore in a real session — not executed.
- Full-path renderer console cleanliness and export-surface axe after a **clear** gate — not available because export failed first.
- Exact Engine issue codes behind the two gate errors (inferred empty_target from multi-segment fixture; not dumped from `qa.issue.list` response in e2e logs).
- Whether every welcome-imported segment must be confirmed vs. draft-filled for gate clear (product rule may accept draft non-empty targets — e2e should match Engine policy explicitly).

## overall
- mission_status: **partial**
- summary_for_reviewer: |
    Quality toolchain for the rebuild (typecheck, eslint, prettier, build, engine build, 135 unit/integration tests) is green and supports much of the F1–F12 fix claim at the unit/static layer: IME blocks Engine update past debounce, flush ack is one-shot, journal classification rejects missing/stale revision, save-failure retains draft, keyboard can activate inactive segments, Project Home Open works on real Engine, and e2e no longer false-greens on Blocked.

    The Verify mission’s product-acceptance core (Q7 / F13 / AC15) is **not** satisfied: real-Engine export reports **Gate: Blocked · 2 errors**, produces no file, and never proves resume-after-export. Concurrently, several high-risk interaction questions (typing during confirm, dirty reconnect, Recovery a11y, journal clear failure, full IME confirm/focus zero-effects) remain only partially evidenced.

    Review should not close on exit-code optimism. Prefer either (a) fix e2e/fixture so the real Engine clears the gate and re-verify Q7, plus fill the deferred-confirm / reconnect / Recovery test gaps for majors, or (b) explicitly waive residual items with documented risk.
- recommended_review_focus:
  1. V1 real-Engine gate/export/resume (blocker to AC15/F13 closure)
  2. V2 confirm-in-flight generation safety proof
  3. V3 reconnect dirty retention proof
  4. Whether V4/V5/V6 residuals are accept-as-code or need tests before closeout
  5. Re-run only `tests/e2e/p0-vertical-slice.spec.ts` after fixture/spec fix — full monorepo suite still unnecessary
