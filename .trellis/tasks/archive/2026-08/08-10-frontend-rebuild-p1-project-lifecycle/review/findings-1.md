# Findings round 1

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle`
- branch: `task/08-10-frontend-rebuild-p1-project-lifecycle`
- head_sha: `0c2009ace6e1a3d7c7ca6237a1c5079cc762b4f8`
- round: 1
- reviewed_state: dirty working tree; findings cover the current tracked and untracked P1 renderer/E2E changes

## verdict
- need_fix
- reason: The light/brown/no-glass/Phosphor locks and the claimed 178-test/typecheck/lint/format gates are green, but authoritative paging, hydration, stale-operation safety, duplicate mutation protection, dialog behavior, and required P1 E2E coverage have open major defects. Real-Engine P0/P1 evidence is also absent.

## need_verify
- required: true

### Verify mission
- purpose: After the open code/test issues are fixed, prove that the P0 and P1 lifecycle paths work through the production Electron build, trusted picker bridge, real Rust Engine, durable storage, destructive lifecycle operations, and relaunch; renderer-fake unit tests cannot establish those product boundaries.
- questions:
  - Does a fresh `pnpm build:desktop` launch the reviewed renderer and keep the complete P0 boot/recovery/create/import/edit/IME/confirm/TM/QA/export/resume path green with real Engine data and no renderer/page errors?
  - Does the P1 real-Engine flow prove one ordered `bestEffort` multi-file import, dirty save-before-document-switch, active-document retention after Add files, authoritative search result jump, compact insights, and final relaunch into the last hydrated document?
  - Do template create/edit/delete/use and create-from-template diagnostics/import, project update/archive/unarchive, and document/project recycle/restore/purge all complete against isolated real Engine data while failures or cancellation retain their originating context?
  - Are recycled entities absent from normal Home/search, are session-v1 writes/clears delayed until the specified authoritative hydrate/delete commit points, and do failed saves/hydrates leave the prior document/draft/session intact?
  - Are the new stable surfaces and lifecycle dialogs keyboard-operable at 1250x744, with Cancel-first destructive focus, focus restoration, no serious/critical axe findings, no viewport horizontal overflow, and no console/page errors?
- success_criteria:
  - The production desktop build succeeds immediately before Playwright, so neither focused spec runs against stale `apps/desktop/dist` output.
  - The existing P0 real-Engine spec passes its real output-file and relaunch assertions without console/page errors or serious/critical axe violations.
  - The expanded P1 spec passes and asserts actual Engine outcomes for S9-S16, including a real search hit activation, dirty switch persistence, template use/update/delete, update/archive/unarchive, recycle/restore/purge and exclusion, example hydration, and relaunch continuity; merely reaching a surface is insufficient.
  - Native source selections use the existing main-process dialog control/environment seam, all runs use isolated Engine/user data, and no mocked `DesktopApi.invoke`, mocked Engine, or product test bridge is introduced.
  - Product state remains authoritative under the tested transitions: no duplicate batch/destructive mutation, stale navigation resurrection, dangling session, lost draft, or fabricated success/zero state is observed.
- failure_signals:
  - Build failure, Electron launch/asset failure, any P0 regression, renderer/page console error, serious/critical axe violation, viewport-level horizontal overflow, or failed real output/relaunch assertion.
  - A second picker/import/destructive RPC from one activation; navigation or session changing before save/hydration; an older response replacing post-navigation/reconnect state; or a recycled entity remaining in active Home/search/session state.
  - P1 tests accepting empty search, accepting Workbench-or-Import without validating the returned example identity, checking only surface visibility, or omitting any required S9-S16 lifecycle outcome.
  - Test data shared across destructive flows, stale `dist` output, a mocked renderer Engine boundary, or an unanswered mission question.
- suggested_commands:
  - `pnpm build:desktop`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p1-project-lifecycle.spec.ts`
  - `pnpm test:e2e:desktop` (final desktop-wide confirmation only after both focused specs pass)
- scope: `apps/desktop` production build; `tests/e2e/p0-vertical-slice.spec.ts`; the expanded `tests/e2e/p1-project-lifecycle.spec.ts`; isolated real Engine/user-data directories and deterministic existing dialog controls. Capture focused logs for build, P0, and P1 separately.
- avoid: Do not run the full monorepo before the focused desktop paths diagnose cleanly; do not reuse stale build output or shared user data; do not mock `window.translunar.invoke`/the Engine; do not add a test-only product bridge; do not weaken assertions to tolerate empty search, missing lifecycle effects, console errors, accessibility failures, or partial flows.
- related_issues: F1, F4, F5, F7, F8, F9, F11, F12

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:280-290`, `apps/desktop/src/renderer/state/use-app-controller.ts:620-894`, `apps/desktop/src/renderer/state/use-app-controller.ts:1193-1222`, `apps/desktop/src/renderer/state/use-app-controller.ts:1937-1996`, `apps/desktop/src/renderer/state/use-app-controller.ts:2366-2423`, `apps/desktop/src/renderer/state/use-app-controller.ts:2739-2788`
- problem: P1 operation counters are not tied to the global Engine generation or invalidated by unrelated navigation. Reconnect increments only `generationRef`; in-flight search/template/recycle/example/open-project operations retain their local op ID and can still commit after rehydration. Several loaders commit with `SET_SURFACE` without checking that their originating surface/intent still owns the response. For example, Chrome Home remains enabled while Templates/Recycling/Open Project loads, and a late response can replace Home with the old destination or enter an old Workbench. This violates R10/AC16 and can replace a newer surface/session with pre-reconnect or abandoned work.
- minimal_fix: Introduce one shared operation token containing app generation, feature op ID, and expected origin/session; validate all three before every read/mutation continuation and final dispatch. Invalidate applicable feature/navigation tokens when navigation or reconnect begins. Do not use unconditional `SET_SURFACE` from a loader after its destination has been abandoned. Add deferred integration tests for Home-during-load and reconnect-during-search/template/example/open-project so the old completion cannot change surface, projection, or session.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:82-91`, `apps/desktop/src/renderer/state/app-state.ts:68-76`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:209-321`
- problem: Active/archived Project Home requests only `project.list({ limit: 200, offset: 0 })`, discards `total/offset/limit`, and exposes no paging. Projects after the first page are silently unreachable, contrary to R8, the checked Electron lifecycle spec, and the deterministic project paging design. Switching lifecycle also replaces the view with this truncated first page.
- minimal_fix: Carry `total`, `offset`, and `limit` in the Projects surface, render deterministic Previous/Next controls and empty state, and request the selected lifecycle/page through a stale-safe command. Preserve Engine order and returned paging metadata. Add integration coverage with `total > limit`, a later-page project, lifecycle switching, page error retention, and stale page completion.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:89-102`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:250-274`, `apps/desktop/src/renderer/state/use-app-controller.ts:2941-2974`
- problem: Edit opens directly from the `project.list` row and `updateProject` copies revision/configuration from that list cache. It never performs the required authoritative `project.get` before editing. A stale list row can therefore open stale fields and submit an obsolete revision/configuration; although Engine conflict protection may reject the revision, the renderer has not met R8's read-before-edit/config-preservation contract and cannot guarantee it preserves the current complete configuration.
- minimal_fix: Add a guarded edit-start command that invokes `project.get`, opens the dialog only from the returned `Project`, and retains that exact revision and complete configuration with the form. Submit the form-owned fields over that fetched object. On typed get/update conflict, keep form/dialog context and expose the typed error. Test list/get divergence, configuration preservation, conflict retention, and duplicate edit submission.
- status: open

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:315-342`
- problem: `hydrateSession` treats a document missing from authoritative `document.list` as active by executing `documents.unshift(document)`. This fabricates membership in the active document projection and can revive a recycled/filtered document if `document.get` still resolves it. It violates Engine authority, R1/R4, and the invalid/recycled session contract; the current document must be one of the fresh active project documents, not inserted by React.
- minimal_fix: Reject a hydrate whose `document.get` result is absent from complete `document.list` with a typed invalid/session-stale error. On startup, clear only a domain-proven invalid/recycled session and resolve Home; during switch/search/example transitions, retain the prior surface/session and show the associated error. Add tests for omitted/recycled documents on startup and on each navigation path, asserting zero replacement session write.
- status: open

### F5
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:1842-1855`, `apps/desktop/src/renderer/state/use-app-controller.ts:1857-1897`
- problem: Workbench Add files increments an op ID and awaits `flushOrStay()` before setting `addFilesPending`. During that await the control remains enabled and the command guard still sees `addFilesPending === false`, so repeated activation can start multiple flush/picker/batch-import sequences. This breaks R2/R10's command-level duplicate guard and the one canonical import operation invariant.
- minimal_fix: Acquire a command-owned pending/ref guard and patch the Workbench pending state before the first await; release it on flush failure, cancellation, stale invalidation, success, and error. Keep the current document unchanged and one summary authoritative. Add a deferred-flush double-activation test that proves one picker and one `project.batchImport` call, plus flush-failure and picker-cancel reset tests.
- status: open

### F6
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:2039-2083`, `apps/desktop/src/renderer/surfaces/GlobalSearch.tsx:72-103`
- problem: Starting a new search immediately changes `submittedQuery` but leaves the old `items/total`. If the new Engine request fails, the catch only clears loading and sets an error, so the UI labels and renders the previous query's hits as results for the failed new query. This is a false Engine projection and violates R5/R10's authoritative result and failure-retention rules.
- minimal_fix: Separate pending query from the last successful submitted projection. Commit submitted query/items/total/offset together only on a current successful response; on failure keep the previous successful query/results (or deliberately clear all result metadata) while showing the failed attempted query/error separately. Add tests for success A followed by failed B, failed paging, and out-of-order A/B responses.
- status: open

### F7
- severity: major
- files: `apps/desktop/src/renderer/surfaces/Templates.tsx:73-78`, `apps/desktop/src/renderer/surfaces/Templates.tsx:233-248`, `apps/desktop/src/renderer/state/use-app-controller.ts:2660-2699`
- problem: Template deletion is not an awaited confirmation. `onDelete` returns `void`; the dialog sets `deletePending`, calls the async controller, immediately closes, and immediately resets pending. A failure loses confirmation context instead of retaining it with the typed error, and the controller has no built-in-template guard even though mutation guards must not rely only on hidden UI. This violates R3/R10 and the checked destructive-dialog contract.
- minimal_fix: Make the delete command/prop return `Promise<boolean>`, await it while keeping the dialog mounted and busy, close only on true, and retain the selected template plus typed failure on false. Add a controller guard that rejects built-in or mismatched selected identity/revision. Refresh the authoritative page only after success. Test duplicate activation, Engine conflict/failure retention, built-in command rejection, and focus restoration.
- status: open

### F8
- severity: major
- files: `apps/desktop/src/renderer/shell/ConfirmDialog.tsx:41-76`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:323-420`, `apps/desktop/src/renderer/surfaces/Templates.tsx:233-248`, `apps/desktop/src/renderer/surfaces/RecycleBin.tsx:148-173`, `apps/desktop/src/renderer/surfaces/Workbench.tsx:200-224`
- problem: The shared confirmation traps focus and initially focuses Cancel, but it never captures/restores the previously focused trigger. Only Project Home happens to restore focus through separate local state; Templates, Recycle, and Workbench do not. The project Edit dialog is a separate modal with no initial focus, focus trap, Escape behavior, or pending-safe keyboard containment. Required keyboard/focus behavior for P1 lifecycle dialogs (R11/AC17) is therefore incomplete.
- minimal_fix: Make the shared modal primitive capture `document.activeElement`, focus the safe initial action, trap focus, make Escape cancel only when safe, and restore the still-connected trigger on unmount. Reuse it (or the same tested focus hook) for Edit with a form-content slot. Add component tests for initial focus, forward/reverse trap, non-confirming Escape, pending Escape behavior, and restoration for edit/template/recycle/document triggers.
- status: open

### F9
- severity: major
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:70-139`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:147-205`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:209-234`
- problem: The new real-Engine P1 spec does not implement R12/AC22 coverage. Flow 1 does not edit before switching, explicitly accepts empty search and never activates a hit, does not test Workbench Add files retention, and never relaunches. Flow 2 only creates a template and archives a project; it omits template edit/delete/use/create-from-template import, project update, and unarchive. There is no recycle/restore/purge/exclusion flow, no P1 axe/keyboard/dialog focus checks, and no compact viewport overflow assertion. The example assertion accepts either Workbench or Import without validating the returned project/document/session. Passing this spec would not prove S9-S16.
- minimal_fix: Expand the isolated real-Engine spec into diagnosable S9-S16 flows matching WP9/AC1-AC17: dirty switch + relaunch; real search hit activation + insights; template CRUD/use/create/import + project update/archive/unarchive; disposable document/project recycle, active/search exclusion, restore, re-delete and purge; authoritative example identity; axe/keyboard/focus/no-overflow/no-console checks. Assert returned Engine data and session outcomes, not just destination visibility. Keep destructive identities isolated.
- status: open

### F10
- severity: minor
- files: `apps/desktop/src/renderer/state/document-navigation.ts:35-104`, `apps/desktop/src/renderer/state/document-navigation.test.ts:30-100`
- problem: Document aggregation has a 50-round bound, but exhausting that bound before `collected.length >= total` returns `{ ok: true }` with a silently truncated list. This contradicts R1's no-silent-truncation rule and the helper's stated bounded/malformed-page error policy. Existing tests cover a stalled page but not cap exhaustion with advancing pages.
- minimal_fix: Track whether authoritative completion was reached; if the loop exhausts while `collected.length < total`, return a typed `DOCUMENT_LIST_LIMIT`/invalid Engine-data error. Add a small `maxRounds` test with advancing non-empty pages and a larger total.
- status: open

### F11
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts`, `apps/desktop/dist` (generated build evidence)
- problem: No fresh desktop build or real-Engine P0/P1 Playwright result was provided/run for this P1 working tree. Unit fakes cannot confirm Electron asset loading, native multi-file selection, real Engine diagnostics/search/indexing/analytics/recycle semantics, output files, or relaunch session continuity. Because F9 also makes the current P1 spec insufficient, an exit-zero run of the unexpanded spec would not close this evidence gap.
- minimal_fix: First fix F1-F10 and expand P1 E2E per F9; then execute the complete Verify mission against a fresh production build and preserve a rich `review/verify-1.md` report with mission answers, primary logs, any V* findings, and unanswered risks.
- status: needs_evidence

### F12
- severity: major
- files: `apps/desktop/src/renderer/state/use-app-controller.ts:650-878`
- problem: Reconnect error paths re-enable `mutationsEnabled` for context-bearing P1 surfaces even when authoritative revalidation/refresh fails. Insights, Projects, Templates, Recycle, and submitted Search catch blocks patch an error and then dispatch `SET_MUTATIONS_ENABLED true`; unlike the outer fatal path, the user can mutate a stale projection immediately after reconnect failed. R10 requires affected P1 surfaces to revalidate and refresh before mutations are enabled.
- minimal_fix: Keep mutations disabled after a reconnect refresh/revalidation failure and expose Retry/Restart through the existing Engine status path. Re-enable only after the relevant project/session plus feature projection succeeds. Add representative reconnect tests for Insights and one list/query surface proving controls remain disabled on failure and enable only after a successful retry; include a stale completion case.
- status: open

## assumptions
- The review treats `prd.md` and `design.md` as the task-specific source of truth where broader lifecycle guidance includes later out-of-scope features such as archive-file/re-import/advanced analysis.
- No research artifact is listed in `check.jsonl`; none was requested or used.
- There were no prior `findings-*.md` or `verify-*.md` files in this task.
- The working tree contains broad P0/P1 and unrelated task/agent edits. Product findings were judged against the current renderer/E2E files, but Orchestrator must stage only task-owned changes.
- Independently rerun in review: `pnpm --filter @translunar/desktop test` passed 24 files / 178 tests; desktop typecheck passed; renderer/E2E ESLint and Prettier checks passed. These results do not substitute for build/real-Engine evidence.
- Static lock audit found no production renderer `backdrop-filter`, `-webkit-backdrop-filter`, new `lucide-react`, forbidden archive/analysis/trash lifecycle call, or new domain localStorage key. The fixed light/advanced-brown/solid/Phosphor direction is therefore not an open finding in this round.

## summary_for_orchestrator
- Verdict is `need_fix`: 0 blocker, 10 open major, 1 open minor, and 1 major waiting on evidence. Prioritize the cross-generation stale-operation boundary (F1), Engine-authoritative project/document resolution (F2-F4), duplicate/search/destructive command correctness (F5-F7), dialog keyboard safety (F8), acceptance-complete P1 E2E (F9), and reconnect mutation safety (F12) before dispatching Verify. Planning artifacts are sufficient; no re-plan or research is required. After fixes, run the supplied build + focused P0/P1 real-Engine mission and return the full verify report for review resume.
