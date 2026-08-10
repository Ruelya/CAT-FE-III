# Findings round 3

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (the reviewed P2 implementation remains an uncommitted working-tree diff)
- round: 3

## need_verify
- required: true

### Verify mission
- purpose: After F5–F7 are fixed, prove that the Asset Hub actions now read current controlled state without relying on deferred React state-updater side effects, that destructive rollback really reaches the Engine, and that global editor shortcuts are accepted only in a visible, focus/IME-safe Workbench context. The existing 6/6 Electron result does not exercise these failing branches.
- questions:
  - With non-empty controlled inputs, do TM search, concordance, term search, corpus search, catalog list/filter, alignment link paging, and curation start each issue exactly one expected generated RPC using the current values, while blank/canceled input still issues none?
  - Can each Engine-paged projection move to a later offset and render the authoritative returned page rather than silently clearing, returning early, or retaining page one?
  - Does curation rollback invoke `curation.rollback` with the current run/library revisions and reason, keep the Cancel-first dialog and typed error on failure, block duplicate activation, and close only after success or cancel?
  - Are `Ctrl/Cmd+F`, `Ctrl/Cmd+K`, IME composition, and keyCode/which 229 handled only where a registered visible Workbench command can accept them, with no swallowed or invisible command on Home, Assets, QA, or Export?
  - After these focused fixes, do the scoped typecheck, desktop tests, build, lint, static appearance scan, and real-Engine P0/P1/P2 Electron lanes remain green with no skips or renderer errors?
- success_criteria:
  - Renderer integration tests record the exact typed invocations and params for the four searches, catalog filters/page offset, alignment link page offset, curation run, and rollback; each non-empty action settles to an authoritative ready/result state and each blank/duplicate/stale path is suppressed deliberately.
  - Catalog and curation E2E assertions observe Engine-backed rows or a run snapshot/explicit valid empty result after activation; merely clicking a control or checking that the form exists is insufficient.
  - Rollback failure visibly retains its dialog/reason/error and success closes it after the Engine response; no valid rollback activation resolves `false` before an RPC.
  - Shortcut tests prove registered Workbench behavior plus no interception/invisible dispatch outside the editor and during IME/229.
  - Desktop typecheck, all desktop Vitest tests, scoped ESLint, production build, no-glass/no-Lucide scan, and focused P0/P1/P2 Playwright (`6/6` or more) pass.
- failure_signals:
  - A filled search/start action makes zero RPCs, catalog list catches a null/undefined state read, alignment Next leaves the same page without a request, or later offsets are unreachable.
  - Curation Start or Rollback silently returns, rollback sends stale revisions, duplicate rollback calls reach the Engine, or failure closes/loses the confirmation context.
  - Main prevents `Ctrl/Cmd+F` or `Ctrl/Cmd+K` on a non-Workbench surface, sends an unregistered command, dispatches while composing/229, or opens state that has no visible owning panel.
  - P2 passes while asserting only control presence/click completion for the affected actions, or any P0/P1 regression, skip, console/page error, serious/critical axe finding, or viewport overflow appears.
- suggested_commands:
  - `pnpm --filter @translunar/desktop exec vitest run src/renderer/state/use-asset-controller.test.tsx src/renderer/state/use-editor-operations.test.tsx`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop test`
  - `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts tests/e2e/p2-editor-assets.spec.ts --project=electron`
  - `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
- scope: `apps/desktop/src/main/index.ts` shortcut boundary, `apps/desktop/src/renderer/state/use-editor-operations.ts`, `use-asset-controller.ts`, focused renderer integration tests, and the existing P0/P1/P2 Electron specs.
- avoid: Do not run the full monorepo/Rust workspace merely to prove these renderer branches; do not widen protocol/main/preload for the accepted TM/TB import blocker; do not accept control-presence assertions as proof of an Engine operation.
- related_issues: F5, F6, F7

## issues
### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts:262-308`, `apps/desktop/src/renderer/state/use-editor-operations.ts:478-569`
- problem: Round-1 undo/redo busy-token defect is statically corrected: history now has an independent read token and undo/redo settle their mutation-owned busy ref/state in `finally`.
- minimal_fix: None. Preserve the separate mutation/read authority and keep the residual real-Engine undo/redo settle matrix recorded below.
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts:888-967`
- problem: Round-1 stale merge payload is statically corrected: merge captures stable IDs, flushes, re-reads current context, verifies document/selection/adjacency, and only then sends current revisions.
- minimal_fix: None. Preserve the post-flush re-read sequence and selection/document guards.
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:30-279`, `apps/desktop/src/renderer/state/use-app-controller.ts:991-1078`
- problem: Round-1 cross-domain token and reconnect-revalidation defect is statically corrected: every asset domain now has independent list/mutation counters and a synchronous mutation-pending ref, and Assets reconnect keeps mutations disabled through project/session plus active-section validation.
- minimal_fix: None for the original defect. Preserve per-domain counters/guards; focused deferred/reconnect runtime depth remains an accepted evidence risk rather than an observed product failure.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/shell/AppChrome.tsx:54-74`, `apps/desktop/src/renderer/state/use-app-controller.ts:1364-1388`, `apps/desktop/src/renderer/state/use-app-controller.ts:2728-2751`
- problem: Round-1 dead/session-unsafe Assets chrome is corrected: QA/Export/Insights are hidden on Assets, Home clears a Workbench-origin session, and Back rehydrates the stored Workbench identity. Verify-2 retained the green hidden-chrome and back-to-Workbench path.
- minimal_fix: None. Preserve the lifecycle branches; Home-from-Assets relaunch remains an accepted evidence risk.
- status: fixed

### F5
- severity: major
- files: `apps/desktop/src/main/index.ts:424-437`, `apps/desktop/src/renderer/App.tsx:30-47`, `apps/desktop/src/renderer/state/editor-operations.ts:169-305`, `apps/desktop/src/renderer/state/use-editor-operations.ts:571-638`
- problem: The editor keyboard contract still has real dead/global behavior. Main intercepts `Ctrl/Cmd+K` and `Ctrl/Cmd+F` for every surface and prevents the default before renderer acceptance; `editor.palette` is not a registered command at all, while `editor.findReplace` is considered available without an active row/context. The always-mounted hook therefore either swallows `Ctrl/Cmd+K` outright or can open invisible find/panel state on Home/Assets/QA/Export. The listener checks composition but not Workbench ownership, target focus, or keyCode/which 229, and registry dispatch is still duplicated by a hook switch rather than owned by the registry. Overflow and comment update/delete are fixed, but the required visible focus/IME-safe keyboard path is not.
- minimal_fix: Make command acceptance Workbench- and focus-aware before `preventDefault`: preferably dispatch renderer-side from the owning editor/command layer, or add a bounded accepted-command handshake/route guard. Register and render a real palette for `editor.palette` or stop intercepting `Ctrl/Cmd+K`. Add `editorOnly`/focus metadata and registry-owned dispatch, preserve composition plus 229 guards, and test Workbench acceptance and non-Workbench non-interception.
- status: open

### F6
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:487-553`, `apps/desktop/src/renderer/state/use-asset-controller.ts:763-858`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1106-1162`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1932-1988`, `apps/desktop/src/renderer/state/use-asset-controller.ts:2105-2157`, `apps/desktop/src/renderer/state/use-asset-controller.ts:2192-2220`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:278-377`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:524-560`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1060-1097`
- problem: Core non-import Asset Hub actions still use the exact deferred-`setState` side-effect pattern that verify-1 proved made TM Create a production no-op. TM search, concordance, term search, and corpus search initialize their query as blank, assign it only inside a state updater, then immediately take the blank-return path; catalog initializes filters as `null`, assigns inside an updater, then dereferences before the updater is guaranteed to run; alignment link paging similarly returns on its initially-null session; curation Start initializes library/reason blank and returns before `curation.run`. The P2 E2E clicks Catalog List but does not assert a response/error, and only checks that the curation policy form exists, so verify-2 can pass while these paths remain broken. TM/concordance/term/corpus result areas also expose no later-page controls despite generated offsets.
- minimal_fix: Read every command snapshot from the existing `stateRef.current` before any state patch, then set loading/pending independently; remove every updater side effect used as a synchronous getter. Add deterministic Previous/Next controls for all paged search projections. Add typed renderer tests that assert exact RPCs, controlled params, blank suppression, stale results, and later offsets; strengthen P2 to assert an Engine-backed catalog result/valid empty state and a curation run snapshot rather than presence/click only.
- status: open

### F7
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:1990-2027`, `apps/desktop/src/renderer/state/use-asset-controller.ts:2500-2562`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1483-1541`
- problem: Corpus removal now correctly returns a success boolean and retains its confirmation on failure, and curation rollback now has a Cancel-first confirmation. However rollback itself is still dead: it initializes `snapshotHolder.value` to `null`, assigns the snapshot only inside a deferred state updater, immediately observes `null`, and returns `false` before `beginMut` or `curation.rollback`. A valid confirmation therefore performs no Engine mutation and exposes no typed failure; the dialog merely stays open. This is an observed-pattern product defect, not only the residual real-Engine evidence gap noted by verify-2.
- minimal_fix: Snapshot `stateRef.current.curation.snapshot` directly, validate it, then begin the guarded curation mutation and invoke rollback with exact run/library revisions. Keep the current dialog close-on-true behavior, preserve reason/error on false, and add cancel, duplicate, Engine failure-retention, and success-close integration tests plus one real-Engine rollback path when seedable.
- status: open

### F8
- severity: major
- files: `apps/desktop/tests/e2e/p2-editor-assets.spec.ts:1-245`
- problem: Round-1 unusable browser-only P2 spec is fixed as a real isolated Electron/Engine lane with console, axe, overflow, editor, Asset Hub, TM Create, and return coverage. Verify-2 reports all focused P0/P1/P2 tests green. Its depth does not close F5–F7 branches it never asserts.
- minimal_fix: No harness-shape fix remains. Extend assertions only as required by F5–F7; do not revert to presence-only acceptance.
- status: fixed

## assumptions
- The entire `verify-1.md` and `verify-2.md` reports were read. Verify-2's mission is accepted as `satisfied`: V1/V2 TM Create are fixed, Playwright is 6/6, desktop Vitest is 199/199, and its listed typecheck/lint/build/static/Engine gates are green.
- The remaining updater-side-effect findings are not speculative scheduling concerns: verify-1 directly demonstrated in this React 19 production bundle that the same pattern left the local variable unchanged and issued zero RPCs. Only TM/TB Create were converted to `stateRef`; the affected F6/F7 paths remain on the proven pattern.
- `WP0-TM-TB-IMPORT-FILTER` remains an accepted scoped omission: no TM/TB import controls or renderer/main/preload bypass are required for this task.
- Deeper real-Engine dirty-merge, undo/redo, per-domain deferred/reconnect, Home-from-Assets relaunch, and broad Asset Hub matrices are accepted residual evidence risks for F1–F4 after their static corrections and the green P0/P1/P2 lanes. F7 cannot be accepted as evidence-only because rollback has a concrete pre-RPC return.
- No `findings-2.md` exists; round 3 is written at the user's requested sequence number after both verify reports.
- File/line references describe the uncommitted working tree at the recorded HEAD SHA.

## summary_for_orchestrator
- Verdict is `need_fix`, not green for closeout. Verify-2 validly clears the TM Create blockers and all listed gates, and F1–F4/F8 are closed with residual depth documented. Three major product defects remain: F5 globally swallowed/invisible editor shortcuts, F6 multiple core Asset Hub searches/catalog/paging/curation actions that still depend on the already-proven deferred updater anti-pattern, and F7 a curation rollback confirmation that returns before any Engine call. Apply the bounded fixes above, then run the focused Verify mission; no re-plan or new research is required.
