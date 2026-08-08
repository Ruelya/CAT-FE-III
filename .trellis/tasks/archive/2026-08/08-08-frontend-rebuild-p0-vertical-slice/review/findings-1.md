# Findings round 1

## meta
- task: `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice`
- branch: `task/08-08-frontend-rebuild-p0-vertical-slice`
- head_sha: `66252c8f4304bb025538fc5261c0608fa5a9025c` (implementation is in the current staged/untracked working tree)
- round: 1

## need_verify
- required: true

### Verify mission
- purpose: Static review found data-loss, IME, recovery, reconnect, and acceptance-test gaps that the current 24 unit tests do not exercise; selective runtime evidence is required to confirm the failure modes and, after fixes, establish AC7/AC8/AC11/AC12/AC15–AC17 without treating a merely exiting test process as product proof.
- questions:
  - During a real composition lifecycle that lasts beyond the save debounce, do `segment.updateTarget`, `segment.confirm`, and focus/selection movement remain at zero until composition ends, including `isComposing`, `keyCode === 229`, and `which === 229` paths?
  - If the user changes the target while `segment.confirm` is deferred/in flight, is the newer draft retained and journaled, does the stale confirm avoid advancing focus, and can the newer text still be saved without an obsolete-revision overwrite?
  - After confirm and authoritative rehydration, can a later clean flush/row selection regress the confirmed row, revision, or counts from a stale prior `segment.updateTarget` response?
  - Are missing-segment and stale-revision journal records classified as stale rather than recovered, and do journal write/clear failures remain visible and retryable without silently discarding or replaying a draft over newer Engine state?
  - On Engine failure/reconnect with a dirty target, does the current surface stay visibly mounted, does the draft survive, are mutations disabled until validation/rehydration completes, and are QA issues refreshed when reconnecting on QA?
  - Can a keyboard-only user activate every segment editor, and does Recovery initially focus a non-destructive action, contain focus, avoid Escape-discard, and restore focus where applicable?
  - Does the real-Engine P0 run prove authoritative confirm, exact TM, QA, a deterministically passing gate and produced export file, restart/resume, and Project Home Open while reporting no renderer/page console errors and no serious/critical axe violations?
  - Do desktop typecheck, touched-path ESLint, Prettier, build, focused unit/component tests, and the focused real-Engine Electron spec all pass after the fixes?
- success_criteria:
  - No Engine target mutation, confirmation, selection change, or focus advance occurs during IME composition or a 229 keyboard event; normal save/confirm works after composition ends.
  - A draft created after a confirm command starts remains visible and recoverable, and stale asynchronous responses never replace newer local text or authoritative confirmed state.
  - Save-before-leave failure keeps Workbench and its draft mounted with an actionable typed error; reconnect keeps the same projection/draft visible and re-enables actions only after successful authoritative hydration.
  - Recovery validates every referenced segment and revision policy before offering Recover; valid recovery works, stale recovery cannot overwrite newer Engine content, and journal lifecycle errors are surfaced.
  - Keyboard traversal can reach and activate all segment editors; Recovery focus behavior satisfies the dialog contract.
  - The real Engine reaches a passing QA gate, creates the destination file, resumes the same document after relaunch, opens an existing project from Project Home, exercises exact TM, and emits no renderer/page errors or serious/critical axe findings.
  - All listed focused quality commands pass, including Prettier.
- failure_signals:
  - Any `segment.updateTarget`/`segment.confirm` call or focus movement before composition end; a prevented/default-consuming 229 shortcut that disrupts composition.
  - New text disappears or focus advances when an older confirm resolves; a confirmed row later renders as draft or with an older revision/count.
  - A stale journal is labelled recoverable, silently bypasses its recorded revision, or a write/clear rejection is swallowed.
  - Reconnect/retry replaces valid content with Boot, hides/displaces Workbench under the status banner, loses the dirty target, enables actions before hydration, or leaves QA projections stale.
  - Inactive rows are pointer-only; focus escapes Recovery or starts on Discard.
  - The Electron test accepts `Blocked` as equivalent to successful export, produces no output, omits Project Home Open/TM/authoritative confirmation, logs renderer/page errors, or reports serious/critical axe violations.
  - Any touched-scope type/lint/format/build/test command fails.
- suggested_commands:
  - `pnpm --filter @translunar/desktop test`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
  - `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json pnpm-lock.yaml`
  - `pnpm --filter @translunar/desktop build`
  - `cargo build -p translunar-engine`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts`
  - `pnpm dev:desktop` for the focused manual IME/recovery/reconnect/console walkthrough when automation cannot answer an interaction question.
- scope: `apps/desktop/src/renderer/**`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, the existing DesktopApi/real stdio Engine boundary, and only the targeted S0–S8 workflows above.
- avoid: Do not run the full monorepo/Rust workspace suite, archived legacy Electron specs, packaging/installers, or unrelated CAT feature surfaces. Do not add a renderer/preload fake or a new product-only test bridge; existing main-process picker/crash seams are acceptable when they still call the real Engine.
- related_issues: F1, F2, F3, F4, F6, F7, F13

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:840-894`, `apps/desktop/src/renderer/state/use-app-controller.ts:550-565`, `apps/desktop/src/renderer/state/save-coordinator.ts:43-44`, `apps/desktop/src/renderer/state/save-coordinator.ts:109-117`, `apps/desktop/src/renderer/workbench/TargetEditor.tsx:56-79`
- problem: Save/confirm concurrency is not generation-safe. The target remains editable while confirm is in flight. Confirm captures only the segment/revision, then always rehydrates, advances, and attaches the next segment if the surface still names the same segment; it never checks whether `editGeneration` changed after the flush. Text typed during the confirm request is therefore dropped when `attachSegment` replaces the active edit. Separately, `lastUpdatedSegment` is a sticky global value: it is neither consumed nor reset on attach/clear/confirm, while every later `flushOrStay` reapplies it. A clean row selection after confirmation can consequently replace a fresh confirmed row with the older draft response and recompute regressed counts. These violate R1/R10 and AC5/AC6/AC8 with a direct data-loss/authority risk.
- minimal_fix: Give save and confirm commands explicit session/document/segment/edit generations. Make `flush()` return a one-shot acknowledgement for that exact flush instead of consulting sticky `lastUpdatedSegment`, and consume/clear it immediately. Before applying confirm results or advancing focus, verify that the command identity and edit generation are still current; preserve and reschedule any newer draft instead of attaching over it. Add deferred-promise tests for typing during update/confirm and for update → confirm → clean row selection retaining the authoritative confirmed row/counts.
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/workbench/TargetEditor.tsx:56-79`, `apps/desktop/src/renderer/state/use-app-controller.ts:815-838`, `apps/desktop/src/renderer/state/save-coordinator.ts:102-117`, `apps/desktop/src/renderer/state/save-coordinator.ts:169-174`, `apps/desktop/src/renderer/state/save-coordinator.ts:219-241`
- problem: The IME guard protects only the confirm command. Composition input still calls `updateDraft`, starts the 350 ms save timer, and `#saveNow` never checks `isComposing`; `setComposing(true)` does not cancel or pause an existing timer. A composition lasting beyond the debounce can therefore invoke canonical `segment.updateTarget` with intermediate composition text, violating R10, the design's IME contract, and AC7. The pure `ime.test.ts` predicates do not exercise this mutation path, and the keyboard boundary omits `which === 229` from its pre-`preventDefault` return.
- minimal_fix: Pause/cancel domain-save timers at composition start, retain composition text only as local draft/journal state, and defensively reject `#saveNow`, flush-driven mutation, navigation, and confirm while composing. Resume/schedule the latest draft only after composition end. Check `isComposing`, `keyCode`, and `which` before `preventDefault`. Add a real `TargetEditor`/controller test using composition events plus fake timers and assert zero update/confirm/focus side effects until normal post-composition confirmation.
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/draft-recovery.ts:17-65`, `apps/desktop/src/renderer/state/use-app-controller.ts:289-327`, `apps/desktop/src/renderer/state/use-app-controller.ts:618-628`, `apps/desktop/src/renderer/state/save-coordinator.ts:65-92`, `apps/desktop/src/renderer/state/save-coordinator.ts:188-201`, `apps/desktop/src/renderer/state/save-coordinator.ts:245-257`
- problem: Recovery validates only project/document hydration. It does not prove that every journal segment still exists or that the recorded `expectedRevision` is safe. Recover then attaches only the first focused record using the segment's current revision, so a stale journal can bypass its recorded revision and overwrite newer Engine content; missing or additional records may be labelled recoverable but never applied. Draft-journal write and clear failures are also swallowed, leaving the user unaware that crash recovery is unavailable or that a stale record may replay on restart. This fails R4/AC1 and can turn a previously confirmed Engine row back into a draft.
- minimal_fix: Classify every record against hydrated segment identity/document and a documented revision/conflict rule before offering Recover. Never replace a stale journal revision with the current Engine revision to force acceptance. Recover all valid records or explicitly constrain and validate the one supported active record; classify the rest as stale/actionable. Track journal write/clear state separately from Engine save state and surface retryable errors without falsely failing a successful domain save. Cover missing segment, revision mismatch, multiple records, write failure, clear failure, Recover, and Discard.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:263-377`, `apps/desktop/src/renderer/state/use-app-controller.ts:411-470`, `apps/desktop/src/renderer/state/use-app-controller.ts:589-609`, `apps/desktop/src/renderer/state/app-state.ts:145-154`, `apps/desktop/src/renderer/App.tsx:20-40`, `apps/desktop/src/renderer/styles.css:61-68`
- problem: Reconnect/retry does not preserve a dirty projection. Reconnect rehydrates and calls `enterWorkbench` with only Engine rows, replacing the active SaveCoordinator draft; an update rejected by the disconnect can therefore disappear from the visible editor even if the journal still contains it. QA reconnect replaces only `ctx` and does not refresh `qa.issue.list`. The banner's Retry calls full `boot`, whose `BOOT_START` unconditionally replaces any valid surface with Boot. In addition, `.app-root` defines two grid rows while a non-connected App renders header + status banner + stage, placing the retained stage in an implicit third row and allowing the banner to consume the flexible row. These behaviors contradict R3/R4/AC12's retain-content-and-draft contract.
- minimal_fix: Snapshot the current surface intent and dirty edit generation before reconnect, validate/rehydrate into that retained state, and merge fresh Engine rows without overwriting a newer draft. Refresh QA issues when QA is active, and enable mutations only after all required revalidation completes. Make retry on an already hydrated surface use the same retained-content path rather than `BOOT_START`. Give the shell an explicit banner row (or overlay treatment) so the stage remains the flexible row. Add status/reconnect tests with a rejected in-flight save and a visual/geometry assertion at a supported viewport.
- status: fixed

### F5
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:920-947`, `apps/desktop/src/renderer/surfaces/QaReview.tsx:71-76`
- problem: Entering QA from Workbench/Export initializes `issues: []`, `run: null`, `loading: false`, and immediately renders “No issues” before any `qa.issue.list` response. This invents a successful empty QA projection and can also discard the issues displayed before a QA → Export → QA round trip. It violates Engine authority and R12/AC9's accurate empty/error states.
- minimal_fix: Represent “not loaded/not run” separately, or fetch `qa.issue.list` on entry/re-entry. Render “No issues” only after a successful authoritative list response, preserve or refresh a prior QA projection intentionally, and add entry/re-entry/list-failure tests.
- status: fixed

### F6
- severity: major
- files: `apps/desktop/src/renderer/workbench/SegmentGrid.tsx:73-102`, `apps/desktop/src/renderer/shell/RecoveryDialog.tsx:23-27`, `apps/desktop/src/renderer/shell/RecoveryDialog.tsx:48-75`
- problem: Required keyboard and recovery-dialog accessibility is incomplete. Inactive segment rows are selected only by an `onClick` on `<tr>`; they expose no focusable control or keyboard handler, so keyboard-only users cannot reach arbitrary editors. Recovery places initial focus on Discard in both modes—even when Recover or Retry is the non-destructive action—and implements no focus containment/restoration. This directly fails R14/AC14, and axe on other stable surfaces cannot prove these keyboard behaviors.
- minimal_fix: Expose a native focusable row/editor activation control (or render labelled editable controls per row) with a non-conflicting keyboard contract and visible focus. Implement the Recovery dialog with initial focus on Recover/Retry, contained Tab/Shift+Tab focus, non-destructive Escape behavior, and restoration when applicable. Add keyboard/component tests rather than only axe scans.
- status: fixed

### F7
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:88-177`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:181-210`, `apps/desktop/src/renderer/App.integration.test.tsx:38-115`
- problem: The Electron spec does launch the real Electron/Engine path, but its assertions do not satisfy AC15/G4b. It treats either an exported result or `Blocked` as success, so a run may pass without selecting a destination or producing output. It clicks Confirm without asserting authoritative confirmed state or call ordering, never asserts exact TM/collapse, does not listen for renderer/page console errors, and the Project Home test never clicks Open. The fake-boundary integration suite also has no deferred save/confirm, save-failure retention, recovery, reconnect, stale TM, keyboard, or gate-cancel coverage. Thus “2/2 real-engine E2E” is true as a test count but overstates acceptance coverage.
- minimal_fix: Make the real fixture deterministically reach a passing gate and require the output file; assert confirmed Engine-rendered state, exact TM and accessible collapse/expand, QA completion, relaunch/resume, and Project Home Open. Fail on page/renderer console errors. Retain a separate explicit blocked-gate/no-export component branch. Add focused deferred component tests for the high-risk negative paths before relying on E2E.
- status: fixed

### F8
- severity: minor
- files: `apps/desktop/src/renderer/workbench/TmExactPanel.tsx:22-39`, `.trellis/spec/frontend/component-guidelines.md:43-48`, `.trellis/spec/frontend/electron-workbench.md:82-88`
- problem: Collapsing exact TM conditionally unmounts the panel body. The applicable frontend specs require collapsed content to remain mounted, become inert/`aria-hidden`, and hand focus to the expand control so motion and assistive-technology state remain continuous.
- minimal_fix: Keep the panel body mounted through collapse, apply inert/`aria-hidden`/pointer suppression and the width/opacity transition, and implement tested focus handoff between collapse and expand controls.
- status: fixed

### F9
- severity: minor
- files: `apps/desktop/src/renderer/**`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`
- problem: The implementation-plan Prettier gate is currently red. `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e apps/desktop/package.json pnpm-lock.yaml` exited 1 and reported style issues in 22 files, including controller, save coordinator, shell, surfaces, integration tests, styles, and the E2E spec. AC16 therefore is not currently satisfied even though typecheck, ESLint, and 24/24 unit tests pass.
- minimal_fix: Run Prettier on the touched paths after functional fixes, inspect the resulting diff, and rerun the exact check.
- status: fixed

### F10
- severity: minor
- files: `apps/desktop/src/renderer/tokens.css:29-33`, `apps/desktop/src/renderer/styles.css:548-567`, `apps/desktop/src/renderer/styles.css:646-663`
- problem: The small semantic status text does not consistently meet WCAG AA. Static contrast calculation gives success `#2f7650` on the chip background `#ece6de` about 4.43:1 and warning `#96651c` on that background about 4.06:1, below 4.5:1 for the 12 px normal-weight status text; warning is also below 4.5:1 on the light QA surface. Current axe timing scans Workbench before these draft/confirmed colors are necessarily rendered.
- minimal_fix: Darken the success/warning text tokens for their actual light backgrounds (while keeping them distinct from brown), or use an AA-compliant text treatment, then add token-level contrast assertions and axe a state that renders draft/confirmed/warning statuses.
- status: fixed

### F11
- severity: minor
- files: `apps/desktop/src/renderer/surfaces/ExportReview.tsx:75-92`, `apps/desktop/src/renderer/surfaces/ImportDocument.tsx:21-24`
- problem: The retained UI includes guiding/descriptive microcopy (“Run export to check the QA gate and choose a path”, “Resolve blockers in QA before export”, and the import subtitle) despite the task's locked concise-copy rule forbidding guiding filler text. No prohibited “不是” copy was found.
- minimal_fix: Remove the guidance/subtitle lines and express the same state through the existing heading, gate result, error/status, and labelled actions only.
- status: fixed

### F12
- severity: minor
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:710-737`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:35-55`
- problem: Project Open has no pending state, command-layer duplicate guard, or operation token. All Open buttons remain enabled while `project.get`/`document.list`/hydrate run, so overlapping opens can race and a slower stale response can establish the wrong session. The `loading` prop exists but the controller never sets it, leaving the R6/design async-state contract incomplete.
- minimal_fix: Track one current Open operation with an ID/project ID, set and clear the Project Home pending state, disable duplicate/conflicting opens, and ignore stale results. Add overlapping/deferred Open tests.
- status: fixed

### F13
- severity: major
- files: `.trellis/tasks/08-08-frontend-rebuild-p0-vertical-slice/implement.md:299-359`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:88-210`
- problem: AC17 and the runtime portions of AC7/AC8/AC12 remain unevidenced. There is no prior verify report or manual-demo record for real IME, save failure, draft recovery, Engine reconnect, layout retention, or console cleanliness, and the current automated spec cannot answer those questions. Static review establishes defects but cannot establish the post-fix runtime result.
- minimal_fix: Complete the Verify mission above after the functional/test fixes and attach a rich `verify-1.md` with mission answers, relevant logs, runtime observations, any V* findings, and explicit unanswered items; do not treat exit code alone as acceptance.
- status: needs_evidence

## assumptions
- The prompt's contract correction overrides the stale names in `prd.md`/`design.md`/`implement.md`: canonical mutations are `segment.updateTarget` and `segment.confirm`. The implementation and generated method map use those corrected names; no method-ledger issue is raised for them.
- Review covered the current working tree because the task branch HEAD still equals the recorded base SHA and the rebuilt source is partly untracked while legacy removal is staged. The Orchestrator should stage only the intended task result and triage unrelated dirty files before commit.
- I reran the six renderer test files: 24/24 passed. I also reran desktop typecheck and touched-path ESLint: both passed. The required Prettier check failed as recorded in F9. I did not rerun the expensive desktop build/E2E or perform the manual demo; those belong to the Verify mission.
- Static audit found no renderer `lucide-react` import, no product `backdrop-filter`, no theme/accent settings UI or persistence, no prohibited “不是” copy, and no dead roadmap navigation. Light-first HTML/tokens, advanced-brown interaction colors, fixed semantic tokens, Phosphor imports, and the corrected segment method ledger are present.
- There were no prior `findings-*.md` or `verify-*.md` reports to reconcile.

## summary_for_orchestrator
- Verdict is **need_fix**, not closeout. There are no blockers, but seven open majors cover save/confirm data loss, IME mutation, unsafe recovery/journal lifecycle, reconnect draft/content loss, invented QA-empty state, keyboard/recovery accessibility, and insufficient E2E acceptance coverage; five minors cover TM collapse semantics, formatting, contrast, copy, and Project Open races. One major acceptance gap remains `needs_evidence`. Send this round to `trellis-fix`, then run the selective Verify mission and resume review with the full verify report.
