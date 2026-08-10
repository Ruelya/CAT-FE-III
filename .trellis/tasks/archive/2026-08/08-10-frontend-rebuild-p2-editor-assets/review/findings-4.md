# Findings round 4

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (reviewed the current uncommitted/untracked task working tree)
- round: 4
- resume_evidence: `review/findings-3.md` and the complete `review/verify-3.md` were read, including mission answers, A1–A8, V1–V6, unanswered items, and `mission_status: partial`

## verdict
- green_for_closeout
- reason: F5–F7 are fixed by targeted source evidence and 16 new focused renderer tests within a green 215/215 desktop suite. The production desktop build, desktop typecheck, Engine build, static appearance scan, and real-Engine P0/P1/P2 Playwright matrix are green (`6/6`). Verify-3 is partial only because scoped ESLint reports 13 `require-await` errors confined to the new test files and the P2 catalog/curation E2E remains shallower than the round-3 mission requested. Both are explicitly accepted below as minor residual risks; neither is a remaining product defect or evidence-waiting major.

## need_verify
- required: false

### Verify mission
- none. Verify-3 supplies sufficient static, renderer-unit, build, and real-Engine regression evidence to close F5–F7. Repeating verification solely for the waived test-only lint hygiene or optional catalog/curation E2E depth would create another quality-loop round without changing the product judgment.

## final_status

| Finding | Round-3 severity/status | Final status | Evidence and disposition |
| --- | --- | --- | --- |
| F1 | major / fixed | fixed | The independent history read token and mutation-owned undo/redo settlement remain in place. Verify-3 reports 215/215 desktop tests and no new F1 failure signal. Deeper real-Engine undo/redo sequencing remains an already accepted test-depth risk. |
| F2 | major / fixed | fixed | Merge still captures stable IDs and re-reads authoritative rows/revisions after flush. Verify-3 reports no dirty-merge regression in the green P0/P1/P2 lanes. |
| F3 | major / fixed | fixed | Per-domain asset tokens, synchronous mutation guards, and reconnect revalidation remain the accepted correction. Verify-3 found no contradictory stale/duplicate/reconnect result. |
| F4 | major / fixed | fixed | Assets chrome and return hydration remain corrected; the P2 real-Engine lane still proves hidden dead chrome and return to Workbench. |
| F5 | major / open | fixed | Main no longer intercepts or prevents editor chords. Renderer acceptance now requires a registered command, a current Workbench session/focus context, availability, and no composition/229 event. Focused hook/pure tests prove Workbench Ctrl+F, inactive/outside-focus suppression, IME/229 suppression, and unregistered Ctrl+K suppression. |
| F6 | major / open | fixed | The affected TM, concordance, term, corpus, catalog, alignment, and curation actions now snapshot `stateRef.current` before pending/loading patches. Nine asset-controller tests prove current params, blank suppression, catalog filters, later TM/catalog/alignment offsets, and curation start. Search/paging controls exist for the affected paged projections. |
| F7 | major / open | fixed | Rollback snapshots the current curation run directly, sends exact run/library revisions, uses the domain duplicate guard, returns success only after the Engine response, and retains `actionError` on failure. Tests prove success, missing-snapshot suppression, exact params, duplicate suppression, and error retention; the surface keeps a Cancel-first `ConfirmDialog` open unless the controller resolves `true`. |
| F8 | major / fixed | fixed | The P2 spec remains a real isolated Electron/Engine lane and passes with P0/P1 (`6/6`). Its remaining catalog/curation depth is recorded separately as an accepted residual rather than reopening the harness finding. |
| F9 | new minor | waived | Scoped ESLint is red only for 13 `@typescript-eslint/require-await` findings in the two new focused test files. Typecheck, all 215 tests, build, and runtime sources are green. Accepted as test-hygiene debt for closeout. |
| F10 | new minor | waived | The real-Engine P2 flow proves Asset Hub navigation, all six sections, TM creation, catalog/curation controls, and Workbench return, but catalog results and curation run/rollback remain presence-only in E2E. The corrected controller branches are covered by typed unit/fake-Engine invocation assertions. This is accepted as residual E2E depth. |

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts`
- problem: Round 1 found that history refresh could invalidate undo/redo ownership and leave the editor command surface busy.
- minimal_fix: None required; preserve the independent read token and mutation-owned `finally` settlement.
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts`
- problem: Round 1 found that merge could send pre-flush row revisions.
- minimal_fix: None required; preserve stable-ID capture followed by post-flush context, selection, adjacency, and revision re-read.
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts`, `apps/desktop/src/renderer/state/use-app-controller.ts`
- problem: Round 1 found shared asset operation authority, duplicate-write exposure, and premature mutation enablement during reconnect.
- minimal_fix: None required; preserve per-domain list/mutation counters, synchronous pending guards, and reconnect project/section revalidation.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/shell/AppChrome.tsx`, `apps/desktop/src/renderer/state/use-app-controller.ts`
- problem: Round 1 found dead Assets chrome actions and session-unsafe Home/back behavior.
- minimal_fix: None required; preserve hidden invalid actions, intentional session clearing, and authoritative Workbench hydration on return.
- status: fixed

### F5
- severity: major
- files: `apps/desktop/src/main/index.ts:424-428`, `apps/desktop/src/renderer/state/editor-operations.ts:352-378`, `apps/desktop/src/renderer/state/use-editor-operations.ts:634-668`, `apps/desktop/src/renderer/state/editor-operations.test.ts`, `apps/desktop/src/renderer/state/use-editor-operations.test.tsx`
- problem: Round 3 found that main globally swallowed Ctrl/Cmd+F/K while renderer dispatch could open invisible state outside a valid Workbench or during IME/229.
- evidence: Verify-3 Q4/A2/A8/V3. Main has removed the `before-input-event` interception. `resolveAcceptedEditorShortcut` checks composition, keyCode/which 229, Workbench focus/session, registry membership, and availability before the listener calls `preventDefault`. Focused tests cover accepted Workbench Ctrl+F and every reported suppression branch, including unregistered Ctrl+K.
- minimal_fix: None required; keep keyboard acceptance renderer-owned and never reintroduce a main-level unregistered/prevent-default path.
- status: fixed

### F6
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:487-553`, `apps/desktop/src/renderer/state/use-asset-controller.ts:759-882`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1094-1147`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1917-1970`, `apps/desktop/src/renderer/state/use-asset-controller.ts:2087-2134`, `apps/desktop/src/renderer/state/use-asset-controller.ts:2170-2268`, `apps/desktop/src/renderer/state/use-asset-controller.test.tsx`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx`
- problem: Round 3 found core Asset Hub actions reading form/query values through deferred `setState` updater side effects, causing valid actions to return before RPC and preventing reliable later-page requests.
- evidence: Verify-3 Q1–Q2/A2/A8/V1. Each affected command now reads the current query/filter/session/library/reason/policy from `stateRef.current` before setting pending state. Nine focused tests record exact typed calls for TM search/concordance, term search, corpus search, catalog filters, alignment paging, and curation start; blank actions issue no RPC; later TM/catalog/alignment offsets settle into authoritative ready state. Source re-check confirms deterministic paging controls for the affected search/link projections.
- minimal_fix: None required; preserve direct current-state snapshots and keep pending-state updates side-effect free.
- status: fixed

### F7
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:2469-2524`, `apps/desktop/src/renderer/state/use-asset-controller.test.tsx:196-295`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1638-1730`
- problem: Round 3 found that valid curation rollback returned `false` before beginning a mutation or invoking `curation.rollback`.
- evidence: Verify-3 Q3/A2/A8/V2. `rollbackCuration` reads `stateRef.current.curation.snapshot`, enters `beginMut("curation")`, invokes the generated rollback method with exact run/library revisions and trimmed reason, returns `true` only on a current success, and retains typed action error on failure. Focused tests prove exact params, missing-snapshot suppression, and one-RPC duplicate guarding. Static surface evidence shows the Cancel-first `ConfirmDialog` and close-only-when-`ok` behavior.
- minimal_fix: None required; preserve the current snapshot/guard/boolean contract and dialog close-on-success rule.
- status: fixed

### F8
- severity: major
- files: `apps/desktop/tests/e2e/p2-editor-assets.spec.ts`
- problem: Round 1 found that the P2 acceptance spec was not a usable Electron/real-Engine lane.
- minimal_fix: None required for harness shape. The real isolated lane is green; its catalog/curation assertion depth is tracked under F10.
- status: fixed

### F9
- severity: minor
- files: `apps/desktop/src/renderer/state/use-asset-controller.test.tsx`, `apps/desktop/src/renderer/state/use-editor-operations.test.tsx`
- problem: Verify-3 A4 reports 13 `@typescript-eslint/require-await` errors in newly added test callbacks/stubs. The errors do not occur in product runtime sources and do not affect TypeScript compilation or the 215 passing tests.
- minimal_fix: Optional post-closeout hygiene: remove unnecessary `async` from synchronous `act` callbacks and fake methods, or make the fake methods await a real promise boundary. Do not change product behavior merely to satisfy this rule.
- status: wontfix (waived for closeout)

### F10
- severity: minor
- files: `apps/desktop/tests/e2e/p2-editor-assets.spec.ts:220-231`, `apps/desktop/src/renderer/state/use-asset-controller.test.tsx`
- problem: Catalog List and curation policy are still presence/click assertions in the real-Engine P2 test; a returned catalog page, curation run snapshot, rollback success, and rollback failure-retention dialog are not asserted end to end.
- minimal_fix: Optional future depth: seed a deterministic catalog/curation case through public Engine methods and assert either authoritative returned rows/explicit empty state, a run snapshot, exact rollback outcome, and retained dialog/error on failure. Keep the existing typed controller tests as the fast branch matrix.
- status: wontfix (waived for closeout)

## accepted_residual_risk

### RR1 — Test-only `require-await` lint debt
- severity: minor / residual_risk
- related_issues: F9
- accepted: true for closeout
- scope: 13 scoped ESLint findings confined to `use-asset-controller.test.tsx` and `use-editor-operations.test.tsx`.
- rationale: Verify-3 reports no lint finding in product runtime files; desktop typecheck, 215/215 Vitest, production build, Engine build, appearance scan, and Playwright are green. The findings are mechanical async-test style debt, not evidence that F5–F7 remain broken.
- failure_trigger_after_closeout: Reopen as a quality issue if the lint errors spread into product code, hide a floating-promise/misused-promise defect, or a required merge/CI gate rejects the task because of them.

### RR2 — Catalog/curation real-Engine E2E depth
- severity: minor / residual_risk
- related_issues: F6, F7, F8, F10
- accepted: true for closeout
- scope: P2 E2E does not assert Engine-returned catalog rows/explicit empty result, a curation run snapshot, or curation rollback success/failure retention; these branches are covered primarily by typed fake-Engine controller tests plus source inspection.
- rationale: The exact F6/F7 pre-RPC defects are directly refuted by invocation-recording tests and corrected code, while the real-Engine Electron lane remains green for the broader editor/Asset Hub/P0/P1 workflow. No verify evidence reports a contradictory product failure. Verify-3's `partial` status is therefore accepted with this explicit residual rather than treated as an unmet major.
- failure_trigger_after_closeout: Reopen if a real Engine catalog activation fails to settle to returned/empty/error state, curation start fails to produce a run for valid inputs, rollback sends wrong revisions/duplicates calls, or its confirmation closes on Engine failure.

## assumptions
- Verify-3 is accepted as the fresh execution record; this review did not rerun its already-recorded commands.
- Verify-3's partial mission is explicitly accepted under the documented RR1/RR2 residuals. No mission question remains that blocks the product judgment for F5–F7.
- The complete prior `findings-1.md`, `verify-1.md`, `verify-2.md`, `findings-3.md`, and `verify-3.md` history was considered. F1–F4/F8 remain fixed because the latest report found no contradictory signal.
- `check.jsonl` lists no research artifact; no re-plan or research is required.
- `WP0-TM-TB-IMPORT-FILTER` remains the accepted scoped omission: TM/TB import controls are absent without a renderer/main/preload bypass.
- The task implementation and review artifacts remain largely uncommitted/untracked at the recorded base HEAD, and the repository also contains unrelated dirty paths. This is closeout staging hygiene, not a product finding; the Orchestrator must stage only task-owned changes.

## open_counts
- blocker: 0
- major: 0
- minor: 0
- needs_evidence: 0

## summary_for_orchestrator
- Final disposition is **green_for_closeout**. Mark F5, F6, and F7 fixed from Verify-3's targeted static/unit evidence; retain the prior closure of F1–F4 and F8. Verify-3's two incomplete formal criteria are accepted as bounded minor residual risks: test-only `require-await` lint hygiene (F9/RR1) and presence-only catalog/curation E2E depth (F10/RR2). There are no open blocker, major, minor, or evidence-waiting findings, no new Verify mission, and no re-plan. Proceed directly to closeout with selective staging of task-owned files.

## Review Complete
### Findings file
- `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets/review/findings-4.md`

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
- Proceed to closeout. Do not schedule another Verify/Fix round for RR1/RR2 unless the waiver is revoked, a required merge gate rejects the lint debt, or an actual catalog/curation/rollback regression is observed.
