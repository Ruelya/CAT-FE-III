# Findings round 3

## meta
- task: `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice`
- branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- head_sha: `66252c8f4304bb025538fc5261c0608fa5a9025c` (reviewed the current dirty working tree)
- round: 3
- resume_evidence: `review/verify-2.md` read in full, including mission answers, A1–A8, V1–V8, unanswered items, and `mission_status: partial`

## final_status

| Finding | Round-2 severity/status | Final status | Evidence and disposition |
| --- | --- | --- | --- |
| F1 | major / open | fixed | Verify-2 V1 and A1/A8 show `flush()` serializing until the edit and saved generations are stable, a controller-side stability guard before confirm, and passing coordinator/App tests for typing a newer draft during a deferred update flush. The tested invariant prevents stale confirmation and focus advance. A separately deferred `segment.confirm` test would add depth but is not evidence of a remaining defect. |
| F2 | major / needs_evidence | fixed | Verify-2 V2 proves the complete component/controller composition lifecycle: zero update/confirm side effects through composition and 229 guards, followed by a successful update and confirm after `compositionend`. Pure guards also pass. This satisfies AC7; the unperformed real-OS IME walkthrough belongs only to the waived AC17 residual below. |
| F3 | major / open | fixed | Verify-2 V3 proves two valid recovered records remain pending, are applied when each segment is visited, and clear only through each matching domain-save path. The controller retains all validated maps. |
| F4 | major / needs_evidence | fixed | Verify-2 V4 and A1/A8 prove the primary AC12 path: a dirty Workbench remains mounted, retains its draft, disables mutation through deferred rehydration, and re-enables only after hydration. QA issue refresh and failed-status handling are present in the controller. Their lack of separate dedicated assertions is a non-blocking test-depth note, not a demonstrated major defect. The live Engine-kill portion is included in the waived AC17 residual. |
| F5 | major / fixed | fixed | Findings-2 already closed authoritative QA entry/list behavior; verify-2 reports no contradictory result and the 144-test suite remains green. |
| F6 | major / fixed | fixed | Findings-2 already closed keyboard segment activation and promoted only Recovery-specific test evidence to F14; F14 is now fixed below. |
| F7 | major / open | fixed | Verify-2 V5/A7 reports real-Engine Playwright 2/2: clear-gate export reaches `export-result`, the destination file exists, Export axe/console checks pass, relaunch resumes the same Workbench document, and Project Home Open remains green. |
| F8 | minor / fixed | fixed | Findings-2 closed mounted/inert exact-TM collapse behavior; verify-2 real-Engine E2E still exercises TM collapse/expand without a new finding. |
| F9 | minor / fixed | fixed | Verify-2 A4 runs the exact touched-path Prettier gate including `pnpm-lock.yaml`; it exits 0. |
| F10 | minor / fixed | fixed | Findings-2 closed semantic contrast; verify-2 reports no matching axe/static regression and the focused suite/E2E are green. |
| F11 | minor / fixed | fixed | Findings-2 closed the prohibited guiding-copy instances; verify-2 reports no regression. |
| F12 | minor / fixed | fixed | Findings-2 closed Project Open operation guarding; verify-2 real-Engine Project Home Open passes. |
| F13 | major / needs_evidence | waived | The major automated acceptance gap is fixed: real-Engine export/file/resume, Project Home Open, quality commands, axe, and console evidence are green. Verify-2 remains partial only for the manual AC17 real-OS IME and live Engine-kill walkthrough. That manual-only remainder is downgraded to an accepted minor residual risk and waived for closeout rather than causing another verification loop. |
| F14 | minor / open | fixed | Verify-2 V7/A1 proves Recovery initial focus, Tab/Shift+Tab containment, non-destructive Escape, and prior-focus restoration through passing RTL component tests. |
| F15 | minor / open | fixed | Verify-2 V7/A1 proves a rejected journal clear remains visible as `journal-error` while the successful Engine target update remains authoritative; coordinator and App integration tests pass. |

## need_verify
- required: false

### Verify mission
- none. Verify-2 provides sufficient code, integration, focused quality, and real-Engine E2E evidence for every previously open blocker/major product concern. The only remaining acceptance item is the explicitly waived pure-manual AC17 residual; another verify mission would create an unbounded loop without changing the automated product judgment.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/save-coordinator.ts`, `apps/desktop/src/renderer/state/save-coordinator.test.ts`, `apps/desktop/src/renderer/state/use-app-controller.ts`, `apps/desktop/src/renderer/App.integration.test.tsx`
- problem: Round 2 found that a newer edit created while confirm awaited an older target update could be dropped or confirmed out of order.
- evidence: Verify-2 Q1/V1; App test `keeps newer draft when typing during deferred update flush under confirm`; coordinator tests for serializing and retaining newer generations; code evidence for the flush loop and `flushStable` guard.
- minimal_fix: none required; the generation-stability recipe is implemented and verified.
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/lib/ime.ts`, `apps/desktop/src/renderer/lib/ime.test.ts`, `apps/desktop/src/renderer/workbench/TargetEditor.tsx`, `apps/desktop/src/renderer/App.integration.test.tsx`
- problem: Round 2 lacked component/controller proof that the shared confirm path produces zero update, confirm, selection, and focus side effects through a composition lifecycle.
- evidence: Verify-2 Q2/V2; App integration test `blocks confirm and focus side effects during composition lifecycle`; pure composition and 229 guards pass; normal post-composition update/confirm succeeds.
- minimal_fix: none required for AC7. A real OS IME walkthrough remains only under the waived AC17 residual.
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts`, `apps/desktop/src/renderer/state/draft-recovery.ts`, `apps/desktop/src/renderer/App.integration.test.tsx`
- problem: Round 2 found that only the active record from a valid multi-record recovery journal was reachable, leaving other valid drafts inaccessible.
- evidence: Verify-2 Q3/V3; `pendingRecoveredRef` retains every validated record; App integration visits two segments, restores both drafts, and observes per-record clearing through matching saves.
- minimal_fix: none required; multi-record retention and application are implemented and verified.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts`, `apps/desktop/src/renderer/App.integration.test.tsx`, `apps/desktop/src/renderer/styles.css`
- problem: Round 2 lacked renderer evidence that reconnect preserves a dirty mounted Workbench and disables unsafe mutations until rehydration completes.
- evidence: Verify-2 Q5/V4; App integration `retains dirty draft and disables mutations across reconnect rehydrate`; controller inspection confirms QA relisting and failed-status disabling; explicit shell banner row remains in place.
- minimal_fix: none required for the primary AC12 contract. A dedicated QA-active reconnect assertion would be optional test depth.
- status: fixed

### F7
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, `apps/desktop/tests/e2e/fixtures/single-segment-source.txt`
- problem: Round 2's real-Engine workflow stopped at a blocked gate and therefore did not prove export output, Export axe/console checks, or relaunch resume.
- evidence: Verify-2 Q7/V5/A7; both focused Playwright cases pass; export result is required, the output file is accessed, Export axe/console checks complete, relaunch resumes `P0 Demo`, and Project Home Open resumes `Listed`.
- minimal_fix: none required; the deterministic fixture/workflow now proves the complete acceptance chain without weakening Engine gate rules.
- status: fixed

### F13
- severity: minor (residual risk only; the original major automated gap is fixed)
- files: `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/implement.md:426-442`, `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/review/verify-2.md:153-160`, `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/review/verify-2.md:177-180`
- problem: The manual AC17 session with a real Chinese/Japanese OS IME and an unexpected live Engine process kill/reconnect was not executed. Automated composition, fake-status dirty reconnect, main-process reconnect, full focused quality, and real-Engine workflow evidence are green, so this is an OS/manual observation residual rather than an open product defect.
- evidence: Verify-2 Q8/V6 and `unanswered`; automated evidence includes 144/144 tests, desktop typecheck, touched-path ESLint, exact Prettier including lockfile, desktop build, Engine build, and real-Engine Playwright 2/2 with export/file/resume.
- minimal_fix: Optional post-closeout human smoke: run `pnpm dev:desktop`, compose with a real OS IME, force-kill/restart the Engine while a draft is dirty, and record banner/draft/console observations. This is not required to re-enter the quality loop unless project policy explicitly revokes the waiver or a real regression is observed.
- status: wontfix (waived for closeout)

### F14
- severity: minor
- files: `apps/desktop/src/renderer/shell/RecoveryDialog.tsx`, `apps/desktop/src/renderer/shell/RecoveryDialog.test.tsx`
- problem: Round 2 had code-only Recovery keyboard behavior with no interaction test.
- evidence: Verify-2 Q6/V7/A1; two RecoveryDialog tests prove safe initial focus, bidirectional focus trap, non-destructive Escape, and focus restoration.
- minimal_fix: none required; the required keyboard behavior is verified.
- status: fixed

### F15
- severity: minor
- files: `apps/desktop/src/renderer/state/save-coordinator.ts`, `apps/desktop/src/renderer/state/save-coordinator.test.ts`, `apps/desktop/src/renderer/App.integration.test.tsx`
- problem: Round 2 lacked proof that journal-clear failure is visible without rolling back a successful Engine target save.
- evidence: Verify-2 Q4/V7/A1; coordinator and App integration tests reject clear, retain the Engine-saved target, and render `journal-error`.
- minimal_fix: none required; visibility and non-rollback are verified.
- status: fixed

## accepted_residual_risk

### RR1 — Manual AC17 OS/process walkthrough
- severity: minor / residual_risk
- related_issues: F2, F4, F13
- accepted: true for closeout
- scope: Real OS IME composition and a human-observed unexpected live Engine process kill/reconnect under `pnpm dev:desktop`, including console/banner observation.
- rationale: AC7's required unit/component composition proof is green; dirty reconnect retention/disable/rehydrate is integration-proven; main-process reconnect behavior is covered; the focused real-Engine workflow, export file, resume, axe, and console assertions pass. The missing evidence is manual OS/process observation only, not a failing automated or static product signal.
- failure_trigger_after_closeout: Reopen if a real OS IME produces an update/confirm/focus move before composition ends, or if a live Engine exit loses the dirty draft, replaces the mounted Workbench, enables mutations before hydration, or emits a renderer console error.

## assumptions
- Verify-2 command results and interpretations are accepted as the fresh execution record; this review did not rerun the already-green focused suite.
- No product-code spot-check was needed because verify-2 answered every round-2 open finding with named tests, code evidence, or real-Engine E2E evidence, and reported no new product V* finding.
- Verify-2's QA-active reconnect and separately deferred `segment.confirm` notes are optional test-depth opportunities. The primary generation and reconnect invariants have code plus passing integration evidence, so those notes do not remain open major findings.
- The working tree remains broad and dirty at the base HEAD. Verify-2 V8 is git-hygiene noise rather than a product defect; the Orchestrator must stage and commit only the intended task scope before merge.
- The F13 waiver is explicit and limited to manual AC17. It does not waive a failing unit, type, lint, format, build, Engine build, Playwright, axe, console, export-file, resume, or Project Home Open result; all of those are green in verify-2.

## summary_for_orchestrator
- Verdict: **green_for_closeout**. F1, F2, F3, F4, F7, F14, and F15 are fixed by verify-2's code/test evidence; F5, F6, and F8–F12 remain fixed. F13's original major automated acceptance gap is fixed, and only the unperformed manual AC17 real-OS IME/live-Engine-kill walkthrough remains; it is explicitly accepted as a minor residual risk and waived for closeout. There are no open blockers, majors, minors, or `needs_evidence` findings, and no new Verify mission is required. Proceed to closeout, with careful task-scoped staging/commit hygiene.

## Review Complete
### Findings file
- `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/review/findings-3.md`

### Verdict
- green_for_closeout

### Verify mission
- none

### Open counts
- blocker: 0
- major: 0
- minor: 0
- needs_evidence: 0

### Blocked for re-plan (if any)
- none

### resume_hint
- Proceed to closeout. Do not schedule another Verify round for the waived manual-only AC17 residual; reopen review only if the waiver is revoked or an actual IME/reconnect regression is observed.
