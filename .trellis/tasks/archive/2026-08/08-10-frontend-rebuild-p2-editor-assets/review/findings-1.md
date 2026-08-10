# Findings round 1

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (implementation is an uncommitted working-tree diff)
- round: 1

## need_verify
- required: true

### Verify mission
- purpose: After the static major issues below are fixed, real runtime evidence is still required to prove that the large P2 renderer/controller change works against the Rust Engine and has not regressed the shipped P0/P1 save, IME, lifecycle, session, QA, export, and relaunch guarantees.
- questions:
  - Do the existing P0 and P1 Electron suites complete against the real Engine with no skips, console/page errors, serious/critical axe findings, session regression, save-before-navigation failure, or viewport overflow?
  - Does the P2 suite launch the built Electron application with isolated user/Engine data rather than a standalone browser page, seed disposable entities through public Engine operations, and exercise real editor mutations, find/replace preview/apply, a structural operation, Asset Hub entry/return, and the non-blocked TM/TB/alignment/corpus/catalog/curation/review paths?
  - After a dirty target is flushed, do merge and every other editor mutation use the post-flush authoritative revision, and do undo/redo return the command surface to an enabled settled state?
  - Are duplicate submissions and concurrent/stale completions prevented independently for editor operations and each asset domain, including reconnect while a list or mutation is pending?
  - On Asset Hub reconnect, is the project/session and active section revalidated before mutations become available, and do Home/back/chrome destinations preserve or clear session identity according to the P0/P1 lifecycle contract?
  - Do failed corpus removal and curation rollback flows keep confirmation/error context, and do all newly completed P2 forms, filters, paging controls, keyboard commands, and panels remain keyboard accessible without horizontal overflow?
- success_criteria:
  - Desktop typecheck, the complete desktop Vitest suite, production desktop build, and static no-glass/no-Lucide checks pass.
  - Focused P0, P1, and P2 Playwright specs all pass against the built Electron app and real Rust Engine; P2 contains no conditional environment skip or soft-presence-only acceptance.
  - P0/P1 observable behavior remains intact: dirty edits survive required transitions/relaunch, IME guards hold, identity-only session continuity is correct, and QA/export/project lifecycle flows remain authoritative.
  - P2 observable behavior is complete for the planned scope: command operations settle correctly; Asset Hub mutations/lists remain current under concurrency/reconnect; all Engine-paged collections can reach later pages; destructive failures retain their dialog/context; and the documented `WP0-TM-TB-IMPORT-FILTER` omission is the only omitted TM/TB path.
  - Stable Workbench and all six Asset Hub sections have no renderer console/page errors, serious/critical axe findings, dead controls, or viewport-level horizontal overflow at the supported compact and wide desktop sizes.
- failure_signals:
  - Any P0/P1 failure, skip, lost draft/session, IME mutation, stale completion, console/page error, serious/critical axe finding, or viewport overflow.
  - P2 uses `page.goto("/")`, does not launch Electron/real Engine, conditionally skips when no session exists, or asserts only toolbar/tab presence.
  - Undo/redo leaves controls in `Working`, dirty merge sends a pre-flush revision/conflicts, or rapid/concurrent actions cause duplicate Engine writes or permanently pending UI.
  - Reconnect enables Asset Hub mutations before project/section revalidation, or stale pre-reconnect results replace current state.
  - Home/QA/Export/Insights controls rendered on Assets no-op, Home leaves a stale Workbench session, or a failed destructive operation closes its confirmation context.
  - Required non-import P2 controls remain absent, only the first Engine page is reachable, or hidden default policy/filter values are submitted without a controlled surface.
- suggested_commands:
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop test`
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts --project=electron`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p1-project-lifecycle.spec.ts --project=electron`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p2-editor-assets.spec.ts --project=electron`
  - `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
  - Use focused renderer integration tests with deferred typed fake responses for duplicate/reconnect/failure-retention cases before the Electron lanes; run `pnpm test:e2e:desktop` as the final authoritative desktop pass if the focused lanes settle.
- scope: `apps/desktop/src/renderer/**`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, `p1-project-lifecycle.spec.ts`, `p2-editor-assets.spec.ts`, built Electron outputs, and the real Rust Engine process used by the desktop harness.
- avoid: Do not run the full monorepo/Rust workspace merely to investigate renderer failures; do not widen main/preload/protocol for TM/TB import; do not fabricate Engine data or accept conditional skips as evidence.
- related_issues: F1, F2, F3, F4, F5, F6, F7, F8

## issues
### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts:420-470`, `apps/desktop/src/renderer/state/use-editor-operations.ts:477-505`
- problem: Undo and redo can permanently leave the editor command surface busy. Each command starts an operation token and sets `busy=true`, then calls `loadHistory()`. `loadHistory()` starts a new operation on the same `opRef`, so the original undo/redo token is no longer current and the trailing `setBusy(false)` is skipped. A successful undo/redo therefore disables the command bar and panels until another invalidation/reconnect.
- minimal_fix: Give history loads an independent read token, or refresh history without invalidating the mutation token; settle `busy` in a current mutation-owned `finally` path. Add an integration test that runs undo and redo, observes the authoritative row/history refresh, and proves controls re-enable after both success and failure.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-editor-operations.ts:319-378`, `apps/desktop/src/renderer/state/use-editor-operations.ts:829-870`
- problem: Merge does not obey the required flush-then-reread revision sequence. `confirmStructure()` resolves the selected pair and captures both row revisions before `runTargetMutation()` flushes the dirty active target. If the flush updates either selected segment, `segment.merge` is still sent with the pre-flush revision, producing a preventable conflict instead of using the latest authoritative rows. The generic runner also does not capture/validate the originating active and selected IDs across the flush.
- minimal_fix: Capture only stable segment IDs before flush, then after a successful flush re-read the current Workbench context, validate that the same document/active selection is still current and adjacent, and build both merge revisions from those refreshed rows. Add dirty-active merge, selection-change-during-flush, and flush-failure tests proving no stale merge RPC is sent.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-asset-controller.ts:126-188`, `apps/desktop/src/renderer/state/use-asset-controller.ts:541-636`, `apps/desktop/src/renderer/state/use-app-controller.ts:742-759`, `apps/desktop/src/renderer/state/use-app-controller.ts:989-993`
- problem: Asset async authority does not meet AC14. The whole Asset Hub shares one list token and one mutation token rather than independent TM/termbase/alignment/corpus/catalog/curation tokens, and command functions rely on React pending state without synchronous command guards. A later action in another section can invalidate an earlier successful completion, leaving the earlier form stuck pending even though the Engine write occurred; rapid activation can also issue duplicate writes. On reconnect, the app controller has no Assets revalidation branch and falls through to enabling mutations immediately, before the hook's asynchronous project/section reload has established that the project still exists and the active section is current.
- minimal_fix: Introduce independent per-domain list/query and mutation tokens plus synchronous pending refs/guards, invalidate all on project/section/reconnect identity changes, and settle only the originating domain. Add an explicit Assets reconnect branch that revalidates the project/session and waits for an authoritative active-section reload before enabling mutations. Cover deferred cross-domain operations, double activation, project switch, and reconnect in integration tests.
- status: open

### F4
- severity: major
- files: `apps/desktop/src/renderer/shell/AppChrome.tsx:54-76`, `apps/desktop/src/renderer/shell/AppChrome.tsx:125-176`, `apps/desktop/src/renderer/state/use-app-controller.ts:1277-1294`, `apps/desktop/src/renderer/state/use-app-controller.ts:2389-2432`
- problem: The new Assets route introduces dead and session-unsafe chrome. Assets entered from Workbench is included in `showSessionActions` and `showInsights`, so QA, Export, and Insights are rendered, but the corresponding controller commands do not accept an `assets` surface and silently no-op. Home is also rendered, but `goHome()` does not include Assets in its session-clear/save-coordinator branch; leaving Assets for Home can therefore retain `session-v1`, causing a later relaunch to reopen the old Workbench instead of honoring the Home transition. This violates the no-dead-navigation and P0/P1 session-continuity locks.
- minimal_fix: Either implement each Assets chrome transition through the stored session with authoritative hydration, or hide controls that are not valid on Assets. Include Assets-from-Workbench in Home's intentional session clear/save-coordinator cleanup, while preserving Assets-from-Home behavior. Add integration/E2E coverage for Home, back, QA/Export/Insights visibility/behavior, and relaunch after leaving Assets.
- status: open

### F5
- severity: major
- files: `apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:23-110`, `apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:112-150`, `apps/desktop/src/renderer/state/use-editor-operations.ts:508-559`, `apps/desktop/src/renderer/workbench/EditorPanels.tsx:433-460`
- problem: The required professional editor command contract is incomplete. Labels/placement are duplicated in presentational `PRIMARY`/`OVERFLOW` arrays and dispatch is a second switch in the hook; there is no renderer subscription to `DesktopApi.onEditorCommand`, no editor-focus/IME-aware keyboard dispatch, no shortcut exposure, and the supposed overflow is simply another always-visible button group. Comment edit (`segment.comment.update`) is absent, and delete is invoked directly without the required confirmation dialog. Thus E1/E2, AC5, and keyboard/discoverability requirements are not met despite the controls being visible.
- minimal_fix: Create one typed command registry that owns IDs, labels, enabled predicates, shortcut metadata, and handler dispatch; render a real accessible overflow menu and subscribe/unsubscribe to `onEditorCommand` with editor-focus and IME/229 guards. Complete comment edit with exact revision and route delete through the existing Cancel-first `ConfirmDialog`, retaining errors until success/cancel. Add registry, keyboard, comment update, immutable comment, and delete-cancel/failure tests.
- status: open

### F6
- severity: major
- files: `apps/desktop/src/renderer/surfaces/AssetHub.tsx:530-713`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1354-1489`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:924-1037`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1042-1201`, `apps/desktop/src/renderer/state/asset-view.ts:76-85`
- problem: Multiple required, non-blocked Asset Hub paths are still missing or only partial. Alignment exposes status changes but no generated `replaceLinks` repartition flow, and refine hard-codes `reason: "refine"` instead of collecting the required reason. Catalog exposes only query/kind rather than the generated locale/origin/domain/date filters. Curation silently submits hard-coded policy defaults with no complete controlled policy form. TM/TB/alignment/corpus lists and searches generally expose only the first Engine page, and mount/apply selectors do not consistently restrict or offer the returned writable/reference modes. These are core AC9-AC13 outcomes, separate from the accepted TM/TB import picker blocker.
- minimal_fix: Finish the exact planned generated-contract paths without widening the bridge: add explicit link repartition and refine reason; expose the complete curation policy; add generated catalog filters with offset reset; add deterministic paging for every paged projection; and present valid mount/writable choices from Engine data. Add request-shape, paging, empty/error/conflict, and stale-query tests for each completed path.
- status: open

### F7
- severity: major
- files: `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1206-1238`, `apps/desktop/src/renderer/state/use-asset-controller.ts:1731-1761`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1173-1190`
- problem: Destructive Asset Hub failures do not retain confirmation context. `removeCorpus()` catches its own Engine error and resolves `Promise<void>`, while the dialog caller closes and clears the reason in `.then()` regardless of success. A failed remove therefore dismisses the confirmation even though the product contract requires it to remain mounted with the typed error. Curation rollback is destructive but is exposed as a direct button with no Cancel-first confirmation at all.
- minimal_fix: Make destructive controller commands return an explicit success result (or rethrow on failure), close dialogs only on confirmed success/cancel, and keep the reason/error mounted on failure. Route rollback through `ConfirmDialog` with exact run/library revisions and duplicate guards. Add cancel, failure retention, duplicate activation, and success-close tests for both operations.
- status: open

### F8
- severity: major
- files: `apps/desktop/tests/e2e/p2-editor-assets.spec.ts:1-41`, `apps/desktop/playwright.config.ts:1-16`
- problem: AC17/AC18 have no usable P2 real-Engine evidence. The new spec uses the ordinary browser `page` fixture, calls `page.goto("/")` without a configured base URL/web server, never launches Electron or an isolated Engine profile, conditionally skips when no Workbench already exists, and checks only toolbar/tab visibility. It exercises no editor mutation, replacement, structural operation, asset RPC, persistence, reconnect, accessibility, console guard, or overflow path. The claimed 198 passing unit tests cannot substitute for the required real-Engine P2 acceptance or P0/P1 regression lanes.
- minimal_fix: Replace the soft-presence spec with the established P0/P1 Electron launch harness: build/launch Electron with isolated user and Engine data, seed disposable project/documents/assets through public operations, attach console/page-error guards, run axe/overflow/keyboard checks, and execute separable editor, TM/TB non-import, alignment/corpus, catalog/curation/review flows. Do not skip merely because seed data is absent; create it in the test. Then run P0, P1, and P2 suites together.
- status: open

## assumptions
- The documented `WP0-TM-TB-IMPORT-FILTER` blocker is accepted for this round: TM/TB import controls may remain omitted, with no dead controls and no renderer/main/preload bypass. It is not counted as a finding.
- No prior `findings-*.md` or `verify-*.md` existed in this task review directory.
- The reported 198 unit tests were not treated as acceptance evidence because the working tree contains only new pure helper tests for `editor-operations` and `asset-view`, with no P2 renderer integration suite, and runtime execution belongs to the verify mission.
- File/line references describe the uncommitted working tree at the recorded HEAD SHA.

## summary_for_orchestrator
- Verdict is `need_fix`. Eight open major issues block green: two concrete editor lifecycle failures, asset token/reconnect authority gaps, dead/session-unsafe Assets chrome, incomplete editor command/comment behavior, incomplete non-blocked Asset Hub requirements, destructive failure-retention violations, and an unusable non-Electron P2 E2E spec. Preserve the documented TM/TB import omission, fix the static issues in bounded scope, then execute the full Verify mission with real-Engine P0/P1/P2 evidence.
