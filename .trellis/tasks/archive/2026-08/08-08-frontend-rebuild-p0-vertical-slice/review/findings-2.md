# Findings round 2

## meta
- task: `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice`
- branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- head_sha: `66252c8f4304bb025538fc5261c0608fa5a9025c` (reviewed current dirty working tree)
- round: 2
- resume_evidence: `review/verify-1.md` read in full; `mission_status: partial`

## reconciliation

| Prior ID | Round-2 judgment | Evidence / disposition |
| --- | --- | --- |
| F1 | reopened — open | V2 exposed missing deferred-confirm proof; spot-check found a remaining confirm/flush generation race described below. |
| F2 | needs_evidence | Domain save timer and keyboard guards are implemented and partly unit-proven, but AC7's component-level confirm/focus lifecycle proof is still absent. |
| F3 | reopened — open | Segment/revision classification is fixed, but multiple valid recovered records are still not retained/applied beyond the first active record. |
| F4 | needs_evidence | Reconnect/retry code and shell rows are corrected; V3 confirms no renderer-layer dirty reconnect test or manual runtime proof. |
| F5 | fixed | QA entry now loads `qa.issue.list` and renders empty only after `issuesLoaded`; deferred integration test passes. |
| F6 | fixed | Inactive segment keyboard activation is integration-proven and Recovery code implements primary focus/trap/Escape/restore; residual Recovery test gap promoted to F14. |
| F7 | reopened — open | V1: honest real-Engine E2E now fails at a blocked gate because the multi-segment fixture translates/confirms only one segment. |
| F8 | fixed | Exact-TM body stays mounted and is made inert/`aria-hidden`; E2E exercised collapse/expand before the later export failure. |
| F9 | fixed | Verify reports scoped Prettier green; next verification must include `pnpm-lock.yaml` as in the frozen command. |
| F10 | fixed | Success/warning tokens were darkened; toolchain/axe stages completed before export failure without a matching finding. |
| F11 | fixed | Guiding export/import microcopy identified in round 1 is removed. |
| F12 | fixed | Project Open has a pending guard/op ID; unit integration and real-Engine Project Home Open pass. |
| F13 | needs_evidence | Real-Engine clear-gate/export/file/relaunch-resume and AC17 remain incomplete because the first E2E stops at Blocked. |
| V4 | promoted to F14 | Recovery dialog keyboard behavior is code-only and required by AC14/WP6. |
| V5 | promoted to F15 | Journal clear-failure visibility remains untested. |
| V6 | retained under F2 | Product guards look correct, but AC7 explicitly requires zero confirm/focus side-effect proof through a composition lifecycle. |

## need_verify
- required: true

### Verify mission
- purpose: After the next focused fix, prove that confirm serializes the latest draft without loss, every valid recovered draft remains recoverable, reconnect and IME behavior satisfy their interaction contracts, and the real Engine completes the previously blocked export/resume chain; the current partial report cannot support closeout.
- questions:
  - If target text changes while the confirm command is flushing an older `segment.updateTarget`, does confirm either flush the newest generation or safely abort, with the newer draft/journal retained and no focus advance?
  - Across `compositionstart` → input lasting beyond debounce → blocked Ctrl/Cmd+Enter/229 → `compositionend`, are `segment.updateTarget`, `segment.confirm`, active selection, and focus unchanged until composition ends, followed by a successful normal confirm?
  - When the journal contains two or more valid segment records, can each draft be reached and restored without silently dropping non-active records, and is each record cleared only after its matching save or explicit Discard?
  - Does a rejected `clearDraftJournal` after successful Engine save produce visible/retryable journal state without falsely rolling back the Engine mutation?
  - When fake Engine status emits reconnecting/failed/reconnected with a dirty target, does Workbench stay mounted, retain the draft, disable mutations during revalidation, re-enable only after hydrate, and refresh QA issues when QA is active?
  - Does Recovery initially focus Recover/Retry, trap Tab and Shift+Tab, keep Escape non-destructive, and restore prior focus after unmount?
  - With the corrected deterministic fixture/workflow, does the real Engine show a clear gate, create the export file, pass Export axe/console checks, close/relaunch, and resume the same project/document? Does Project Home Open remain green?
  - Does the focused manual `pnpm dev:desktop` sequence cover real OS IME and Engine restart/reconnect with no renderer console errors, or explicitly document any remaining unperformed manual acceptance item?
  - Do desktop unit tests, typecheck, touched-path ESLint/Prettier (including lockfile), desktop build, Engine build, and the focused Electron spec all pass?
- success_criteria:
  - Deferred update/confirm integration tests prove that a generation created at any point before confirm settlement cannot be dropped, confirmed stale, or followed by focus advance; only the latest serialized target is confirmed.
  - A component/controller composition test proves zero update/confirm/focus/selection side effects for all IME signals and normal behavior after composition ends.
  - Multi-record recovery preserves every valid draft until matching save/discard, while stale records remain explicitly classified; journal clear failure is visible and tested.
  - Renderer reconnect tests prove retained surface/draft, disabled mutations during rehydrate, authoritative row/QA refresh, and safe re-enable; Recovery keyboard tests pass.
  - The real-Engine E2E reaches `Gate: Clear`, invokes export, finds the destination file, performs Export axe and console assertions, relaunches with the same data, and resumes Workbench; both focused Playwright cases pass.
  - The manual real-IME/reconnect walkthrough is completed without console errors, or any unperformed AC17 step remains explicitly unanswered rather than implied green.
  - All focused static/unit/build commands pass.
- failure_signals:
  - Confirm is sent while `editGeneration !== savedGeneration`, a draft typed during flush/confirm disappears, an older target becomes confirmed, or focus advances after a stale command.
  - Any update/confirm/selection/focus side effect occurs during composition or a 229 event, or post-composition confirm no longer works.
  - Recovery applies only the first of multiple valid records, silently discards another record, rewrites a stale revision, or hides a journal clear failure.
  - Reconnect replaces Workbench, loses draft/error state, exposes enabled mutations before hydration, leaves QA stale, or produces banner/stage layout loss.
  - Recovery starts on Discard when Recover/Retry exists, focus escapes, or Escape discards.
  - The E2E reports Blocked, produces no file, skips Export axe/console checks or relaunch/resume, accepts loose QA text as end-to-end success, or either Playwright case fails.
  - Any required focused command exits nonzero.
- suggested_commands:
  - `pnpm --filter @translunar/desktop test`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
  - `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json pnpm-lock.yaml`
  - `pnpm --filter @translunar/desktop build`
  - `cargo build -p translunar-engine`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts`
  - `pnpm dev:desktop` for the bounded real OS IME + Engine restart/reconnect + console walkthrough required by AC17.
- scope: `apps/desktop/src/renderer/state/save-coordinator*`, `state/use-app-controller.ts`, recovery/IME/workbench components and focused tests, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, one deterministic source fixture, and the existing real stdio Engine path.
- avoid: Do not run the full monorepo or Rust workspace suite, restore archived legacy Electron specs, modify Engine QA/domain rules to make the gate pass, add a renderer/preload fake, or broaden into out-of-scope CAT surfaces. Fix the test workflow/fixture, not the authoritative gate.
- related_issues: F1, F2, F3, F4, F7, F13, F14, F15

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:1003-1127`, `apps/desktop/src/renderer/state/save-coordinator.ts:180-220`, `apps/desktop/src/renderer/state/save-coordinator.ts:321-367`, `apps/desktop/src/renderer/App.integration.test.tsx:40-360`
- problem: The fix handles text typed after `segment.confirm` is bound, but a newer draft can still be lost when it arrives while the confirm command's preceding flush has an older `segment.updateTarget` in flight. `flush()` returns after that submitted generation resolves even if the coordinator is now dirty with a newer generation. `confirmSegment` then binds the already-newer generation without checking `isDirty()`/`savedGeneration`, confirms the older Engine revision, sees the bound generation unchanged, advances, and `attachSegment` clears the scheduled save for the newer draft. Depending on timing, the rescheduled update can instead race the confirm and conflict. V2's missing deferred-confirm test therefore masks a remaining R10/AC6 data-loss bug rather than only a coverage gap.
- minimal_fix: Make the confirm precondition generation-stable: either have `flush()` loop/serialize until the active submitted generation equals the current edit generation, or have `confirmSegment` detect any generation change/dirty state during flush and abort without confirming or moving focus. Bind both saved and edit generation only after that invariant holds. Add an App/controller test that defers `segment.updateTarget`, types a second value while confirm is awaiting the first save, then proves the second value remains and no stale confirm/focus advance occurs; also defer `segment.confirm` and type during it.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/save-coordinator.test.ts:49-68`, `apps/desktop/src/renderer/lib/ime.test.ts:11-47`, `apps/desktop/src/renderer/workbench/TargetEditor.tsx:57-84`, `apps/desktop/src/renderer/state/use-app-controller.ts:972-999`
- problem: The product guards now pause target persistence and cover all 229 fields, but verification remains partial against AC7: no component/controller test drives a real composition lifecycle and counts update, confirm, selection, and focus side effects through composition end. Pure predicates plus a SaveCoordinator timer test do not prove the explicit control and shortcut share the guarded action without focus movement.
- minimal_fix: Add a focused TargetEditor/App integration test using composition events and fake timers. Assert zero `segment.updateTarget`, zero `segment.confirm`, unchanged active editor/focus for composition plus `isComposing`/`keyCode`/`which` 229, then assert one normal serialized update/confirm and successful focus advance after composition ends.
- status: needs_evidence

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:221-274`, `apps/desktop/src/renderer/state/use-app-controller.ts:730-771`, `apps/desktop/src/renderer/state/draft-recovery.ts:78-128`, `apps/desktop/src/renderer/state/draft-recovery.test.ts:75-96`
- problem: Segment identity/revision classification is fixed, but recovery still does not fulfill the original multi-record safety recipe. `recoverDraft` builds maps for every valid record, while `enterWorkbench` consumes only the map entry for the single active/focused segment and does not retain the maps for later segment activation. Other valid journal records are labelled recoverable yet are not shown/applied and remain outside the Workbench interaction state. This can silently leave valid crash-recovery text inaccessible.
- minimal_fix: Retain validated recovered drafts/revisions as pending Workbench/controller state and attach the matching record whenever its segment becomes active, clearing each only after its own successful save; alternatively implement an explicit no-loss recovery selection flow. Add an integration test with at least two valid records that visits/saves both and verifies per-record journal clearing. Do not clear or ignore unvisited valid records.
- status: open

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:440-586`, `apps/desktop/src/renderer/styles.css:61-69`, `apps/desktop/src/renderer/App.integration.test.tsx:40-360`
- problem: The reconnect implementation now snapshots the dirty target, keeps an explicit banner row, rehydrates session rows, and refreshes QA, but V3 confirms the renderer contract remains unproven. No test emits the fake status/reconnect callbacks while a dirty Workbench is mounted, so AC12's draft retention, disabled-mutation window, safe re-enable, QA refresh, and layout retention still depend on static inspection.
- minimal_fix: Add App integration coverage that emits `reconnecting`/`failed`/`reconnected` with a dirty target and deferred hydration. Assert Workbench/draft remain mounted, controls disable before and stay disabled during hydrate, rows/QA refresh authoritatively, then controls re-enable. Add a supported-viewport assertion or focused manual observation for banner/stage retention.
- status: needs_evidence

### F7
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:112-238`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:166-207`, `apps/desktop/resources/examples/welcome/source.txt:1-8`, `apps/desktop/test-results/p0-vertical-slice-P0-verti-45adb-firm-→-QA-→-export-→-resume-electron/error-context.md:29-47`
- problem: The test is now honest about the gate, but the required real-Engine path is still red. The imported welcome fixture contains multiple segments while the test fills/confirms only the first; real QA returns `Gate: Blocked · 2 errors`, so no path selection/export file, Export axe/console assertion, or restart/resume occurs. This is a major fixture/workflow gap under AC15/G4b, not an Engine failure to waive.
- minimal_fix: Use a deterministic single-segment supported fixture, or iterate through every imported segment and provide/confirm valid targets according to Engine policy before QA. Keep the separate blocked-gate/no-export component test. In E2E, require an authoritative clear gate, output file existence, Export axe/console checks, close/relaunch, and resumed project/document.
- status: open

### F13
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:112-238`, `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/review/verify-1.md:171-204`, `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/implement.md:299-359`
- problem: F13 remains open for evidence. Verify mission Q7 failed at export and did not reach export-surface axe/console checks or relaunch/resume; the real OS IME, live dirty Engine reconnect, Recovery interaction, and complete `pnpm dev:desktop` AC17 walkthrough were also unanswered.
- minimal_fix: After F1/F3/F7 and the focused tests are fixed, complete the fresh Verify mission above and write a rich `verify-2.md` answering every mission question, including the passing real-Engine output/relaunch path and explicit manual AC17 result or remaining unanswered risk.
- status: needs_evidence

### F14
- severity: minor
- files: `apps/desktop/src/renderer/shell/RecoveryDialog.tsx:22-149`, `apps/desktop/src/renderer/App.integration.test.tsx:40-360`
- problem: V4 found no automated coverage for Recovery's required initial focus, Tab/Shift+Tab containment, non-destructive Escape, or focus restoration. The code appears aligned with the design, but AC14/WP6 specifically require these focus actions rather than only static implementation.
- minimal_fix: Add RTL/user-event tests for recoverable and stale modes: focus Recover/Retry first, wrap both Tab directions, verify Escape neither discards nor escapes the modal, and verify prior focus restoration on unmount.
- status: open

### F15
- severity: minor
- files: `apps/desktop/src/renderer/state/save-coordinator.ts:321-351`, `apps/desktop/src/renderer/state/save-coordinator.test.ts:122-136`
- problem: V5 confirmed only journal write failure is tested. A `clearDraftJournal` rejection after successful Engine save is coded to set `journalError`, but its visibility and non-rollback behavior can regress without evidence.
- minimal_fix: Add a SaveCoordinator/component test that rejects `clearDraftJournal`, proves the Engine segment update remains successful, `journalError` reports the clear failure, and the Workbench exposes the retryable recovery-state error.
- status: open

## assumptions
- The prompt's contract correction remains authoritative: `segment.updateTarget` and `segment.confirm` are the correct canonical mutation names despite stale task-artifact wording.
- I accepted verify-1's successful command evidence: desktop typecheck, touched-path ESLint, scoped Prettier, desktop build, Engine build, and 135/135 desktop unit tests are green. I did not rerun those commands in this review round.
- I read `verify-1.md` in full, including all mission answers, V1–V7, unanswered items, and the partial overall status. I also inspected the current save/confirm, recovery, reconnect, IME, a11y, QA, CSS, and E2E code plus the Playwright error context where verification was ambiguous.
- F5, F6 product behavior, and F8–F12 are accepted fixed. F2/F4 remain `needs_evidence` because their acceptance contracts explicitly require interaction/runtime proof, not because a new static product defect was found in those fixes.
- The current task branch HEAD still equals the base SHA and the implementation remains staged/untracked in a broad dirty tree; Orchestrator must preserve intended task scope when staging/committing.

## summary_for_orchestrator
- Verdict is **need_fix**. Reopen F1 for a remaining confirm-during-flush generation/data-loss race, F3 for inaccessible additional valid recovery records, and F7 for the real-Engine multi-segment fixture blocking export. F2, F4, and F13 remain `needs_evidence`; promote V4/V5 as minor F14/F15 test gaps. Fix these selectively, then run the fresh Verify mission. Do not close out while the real-Engine E2E is 1/2 and the clear-gate/export/file/resume chain has not executed.
