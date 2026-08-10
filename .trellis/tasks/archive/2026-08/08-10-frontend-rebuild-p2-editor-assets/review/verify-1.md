# Verify report round 1

## mission_echo
- purpose: After F1–F8 static major issues were fixed, prove the P2 renderer/controller change works against the real Rust Engine and has not regressed shipped P0/P1 save, IME, lifecycle, session, QA, export, and relaunch guarantees.
- questions_addressed:
  - Q1 (P0/P1 Electron suites vs real Engine): **Yes for the focused P0/P1 Playwright lanes.** All five P0/P1 tests passed against built Electron + real Engine (no skips observed in the run log). Suite covered welcome→create→import→edit/confirm→QA→export→resume, project home Open, dirty switch/add-files/search/insights/relaunch, templates/lifecycle/recycle, and open-example. This run did not re-assert every console/axe/overflow detail inside those older specs beyond their own pass/fail.
  - Q2 (P2 Electron harness + real paths): **Partial.** The rewritten `p2-editor-assets.spec.ts` launches Electron with isolated `TRANSLUNAR_TEST_USER_DATA` / `TRANSLUNAR_DATA_DIR`, seeds a disposable project via public UI (create → import fixture → confirm), exercises editor command bar + overflow + history settle, find/replace panel, comment create, Asset Hub entry, dead-chrome absence (QA/Export/Insights), all six section tabs, then fails on TM create visibility. It is no longer a soft browser `page.goto("/")` presence check. Structural merge/replace-apply, reconnect, and destructive corpus/rollback paths are **not** covered by this single P2 test.
  - Q3 (dirty flush → merge revision; undo/redo settle): **Not fully answered by this E2E pass.** P2 asserts history panel open and absence of sticky `Working` after history; it does not dirty-merge or run undo/redo. Vitest includes `editor-operations.test.ts` (7) plus integration suites, but merge flush-revision and undo settle need review/fix confirmation against the F1/F2 recipes rather than this E2E alone.
  - Q4 (duplicate/stale/reconnect independence per domain): **Not answered by Electron E2E.** No deferred concurrent or reconnect scenario was executed in this mission run. Static code now has per-domain list/mut tokens in `use-asset-controller.ts`; runtime proof is still open.
  - Q5 (Assets reconnect revalidation; Home/chrome session contract): **Partial for chrome; reconnect untested.** On Assets, P2 proved QA/Export/Insights buttons are not rendered. Home/back session-clear and relaunch-after-Assets were not in the P2 path before failure; P1 relaunch coverage still passes for non-Assets flows.
  - Q6 (destructive failure retention; a11y/overflow): **Partial.** Workbench and Assets axe (serious/critical) and horizontal overflow checks passed in P2 before the TM failure. Corpus remove / curation rollback retention were not reached. Catalog filter + curation policy controls were not reached (test stops at TM create).

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (large uncommitted working tree for P2 implementation)
- node: v22.19.0 · pnpm: 10.18.3 · rustc/cargo: 1.97.1
- OS: Windows
- deviations:
  - ESLint invoked as `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e` (orchestrator-requested); project package has no dedicated lint script and is missing `react-hooks` plugin resolution.
  - Playwright run used `--project=electron` (matches config; only project defined).
  - Focused diagnostic Electron launches (ad-hoc Node+Playwright) were used after P2 failure to isolate TM create; not part of CI scripts.
  - Did not run full monorepo/Rust workspace tests (per avoid).

## actions
### A1
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    pretypecheck → @translunar/contracts build
    tsc electron + renderer + e2e --noEmit paths completed
- interpretation: Desktop TypeScript typecheck clean for electron/renderer/e2e configs.

### A2
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.45s
- interpretation: Engine package builds; real-Engine E2E can launch against a valid binary toolchain.

### A3
- command: `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
- exit_code: 0
- log_excerpt: |
    apps/desktop/src/renderer/state/appearance.test.ts:44-45 (negative assertions only)
- interpretation: No glass CSS or Lucide renderer imports in product renderer sources; only test guards. (Note: `lucide-react` remains a package.json dependency but is not imported under `src/renderer`.)

### A4
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- log_excerpt: |
    Test Files  27 passed (27)
    Tests  199 passed (199)
    Duration  ~22s
    Includes App.integration / App.p1.integration, editor-operations, asset-view, etc.
- interpretation: Full desktop Vitest suite green (199). Pure helper + integration coverage present; does not substitute for real-Engine P2 E2E.

### A5
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 1
- log_excerpt: |
    App.tsx:50 require-await on commitWorkbenchRows
    App.tsx:83,118 + use-asset-controller.ts:624 — Definition for rule 'react-hooks/exhaustive-deps' was not found
    4 errors
- interpretation: Lint is not clean. Two classes: (1) missing ESLint plugin for `react-hooks/exhaustive-deps` (tooling/config noise relative to product correctness); (2) `@typescript-eslint/require-await` on a sync async adapter in `App.tsx`. Not treated as P2 functional failure, but fails the “eslint clean” bar if review requires it.

### A6
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    vite build → dist/renderer (~482 kB JS)
    tsc -p tsconfig.electron.json → dist/electron
- interpretation: Production desktop build succeeds; E2E uses this artifact via `electron .` from `apps/desktop`.

### A7
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts tests/e2e/p2-editor-assets.spec.ts --project=electron`
- exit_code: 1 (1 failed, 5 passed; pnpm also printed a trailing “playwright not found” after the run, but Playwright itself executed and reported results)
- duration_note: ~46.5s
- log_excerpt: |
    [1/6] p0 welcome→…→export→resume — passed
    [2/6] p0 project home Open — passed
    [3/6] p1 S9–S10 dirty switch… — passed
    [4/6] p1 S11–S16 templates/lifecycle/recycle — passed
    [5/6] p1 S15 open example — passed
    [6/6] p2 editor commands, find, assets… — FAILED
      expect(getByText('P2 TM')).toBeVisible() timeout 30s
      at p2-editor-assets.spec.ts:218 after tm-create click
- interpretation: P0/P1 regression lanes green against real Engine. P2 harness is real Electron but fails on non-import TM create observation.

### A8
- command: Ad-hoc Electron diagnostic (Playwright launch + RPC monkeypatch + React fiber inspect)
- exit_code: 0 (diagnostic)
- log_excerpt: |
    Accessibility snapshot at P2 failure: Name input still "P2 TM"; table only "P2 Editor Assets TM"; 1–1/1; no error-text.
    After Create click with invoke monkeypatch: window RPC call count = 0.
    Hook refs at click time: gateway.mutationsEnabled=true; mutPending.tm=false; createName="P2 TM"; projectId set.
    Direct window.translunar.invoke("tm.library.create", {name:"P2 TM",…}) succeeds.
    tm.library.list(projectId) after create without mount: still only default library.
    After tm.library.mount: list shows both "Direct P2 TM" and default.
- interpretation: UI `createTmLibrary` is a silent no-op (no Engine RPC) despite enabled mutations and filled name. Independent product gap: Engine list is mount-scoped; create without mount cannot appear in the hub table even when create RPC succeeds.

## findings_for_reviewer
### V1
- severity: major
- related_review_ids: F6, F8
- title: Asset Hub TM Create is a silent no-op (no `tm.library.create` RPC)
- evidence: |
    `apps/desktop/src/renderer/state/use-asset-controller.ts` `createTmLibrary` (~640–694):
    reads name via setState updater side-effect (`let name=""; setState(s => { name = s.tm.createName.trim(); ...})`) then `if (!name) return` before `invokeEngine`.
    Electron diagnostics: React state has `createName="P2 TM"`, `mutationsEnabled=true`, `mutPending.tm=false`, yet Create click issues **zero** invokes; name field uncleared; no `actionError`.
    Same anti-pattern exists on `createTermbase`.
    Playwright error-context snapshot matches: input retains "P2 TM", list unchanged, no error UI.
- detail: |
    The control is clickable and the form is populated, but the mutation path returns before Engine I/O. Most consistent mechanism: functional `setState` updater does not run eagerly before the `!name` check in this React 19 production bundle, so `name` stays `""` and the function exits without RPC, busy flag, or error. This blocks AC9 non-import TM create and fails the P2 E2E assertion. Fix recipe: read `createName` from a ref or latest state without relying on setState side-effects; gate on empty name with explicit UI error; never silent-return when the user activated Create with a non-empty controlled field.
- suggested_next: fix_recipe_hint — rewrite name capture (ref or `state.tm.createName` before setState); add renderer integration test with deferred fake that asserts `tm.library.create` params; re-run P2 E2E.

### V2
- severity: major
- related_review_ids: F6
- title: TM create does not mount; project-scoped list only returns mounted libraries
- evidence: |
    `crates/storage/src/store.rs` `list_tm_libraries` filters by `tm_library_mounts` for a projectId (not `owner_project_id`).
    `create_tm_library` inserts library + optional owner but does not insert a mount.
    Diagnostic: create succeeds via raw RPC; list total stays 1 until `tm.library.mount`; then total 2 with new name visible.
    Project create auto-mounts `{name} TM` (store.rs ~6566–6624), which is why the hub always shows the default library.
- detail: |
    Even after V1 is fixed, `createTmLibrary` only calls create then `loadTmLibraries`. The new library will not appear in the hub table (and the P2 `getByText('P2 TM')` assertion will still fail) unless the UI mounts after create or list semantics change. Product expectation for “Create” in the project Asset Hub is a visible, project-usable library (default project path mounts write mode).
- suggested_next: fix_recipe_hint — after successful `tm.library.create`, call `tm.library.mount` with projectId + writable/reference mode from the UI selector; then reload list. Align fake-desktop-api + integration tests with mount-visible results.

### V3
- severity: minor
- related_review_ids: new
- title: ESLint not green on renderer/e2e paths
- evidence: |
    4 errors: missing `react-hooks/exhaustive-deps` rule definition (3); `require-await` on `commitWorkbenchRows` in App.tsx.
- detail: Config/tooling gap plus one async style finding. Does not explain P2 functional failure.
- suggested_next: fix_recipe_hint — install/configure eslint-plugin-react-hooks or remove disable comments; make commitWorkbenchRows sync or await a real async boundary if lint is gated.

### V4
- severity: info
- related_review_ids: F8
- title: P2 E2E is now a real Electron/Engine lane (F8 largely addressed structurally)
- evidence: |
    `tests/e2e/p2-editor-assets.spec.ts` uses `_electron.launch`, isolated user/engine data dirs, fixture seed, console/pageerror guards, axe + overflow, editor + assets flow. playwright.config only defines `electron` project. No conditional skip for missing Workbench.
- detail: F8’s “soft presence browser test” description is obsolete. Remaining gap is product failure V1/V2 and incomplete depth (no merge/reconnect/destructive coverage in this single test).
- suggested_next: out_of_scope for fix of F8 harness shape; extend P2 after V1/V2 if review still requires deeper AC paths.

### V5
- severity: info
- related_review_ids: F4
- title: Assets chrome hides QA/Export/Insights (observed green path)
- evidence: |
    P2 reached Asset Hub and asserted zero QA/Export/Insights buttons under `app-shell` before TM failure.
- detail: Static dead-chrome concern from F4 appears fixed for the Assets surface in this build. Home/session-clear after Assets still needs dedicated coverage.
- suggested_next: re-run_with — optional P2 assertion for Home from Assets + relaunch identity if F4 session branch remains in doubt.

## unanswered
- Full proof that dirty-target merge always uses post-flush revisions (F2) under real Engine — not in P2 E2E.
- Undo/redo never leaves command surface permanently busy (F1) under real Engine — only history-open “no Working” observed.
- Per-domain duplicate submission / stale completion / reconnect revalidation (F3) under real Engine — no scenario run.
- Corpus remove failure retention and curation rollback ConfirmDialog (F7) — not exercised.
- Catalog filter submit shapes, alignment replaceLinks/refine reason, curation policy submit (F6 remainder) — UI presence for catalog/curation not reached this run; request shapes unproven.
- Whether ESLint cleanliness is a hard quality gate for this task (config currently broken for react-hooks).

## overall
- mission_status: failed
- summary_for_reviewer: |
    Static gates mostly green: typecheck, Vitest 199, production desktop build, engine crate build, no glass/Lucide in renderer sources. ESLint is red for tooling/style reasons. Real-Engine P0 (2) and P1 (3) Playwright tests all passed — no P0/P1 regression detected in the focused suites. P2 is a genuine Electron/Engine test and progresses through editor commands, find, comments, Asset Hub entry, chrome hygiene, and section tabs, then fails because TM Create does not call the Engine and would not list an unmounted library even if it did. Two major product defects (V1 silent create, V2 create-without-mount vs mount-scoped list) block P2 acceptance and the non-import TM AC path. Treat F8 harness rewrite as largely done; keep F6 open; re-verify P2 after V1+V2 fixes. Deeper F1–F3/F7 runtime proof remains outstanding beyond this mission’s command set.
- recommended_review_focus: |
    1) Fix V1 name-capture / silent no-op in `createTmLibrary` (and sibling createTermbase).
    2) Fix V2 post-create mount so hub list shows the new library.
    3) Re-run P2 E2E (and spot-check P0/P1 if desired).
    4) Decide whether remaining F1/F2/F3/F7 need another verify mission with targeted integration + E2E cases.
    5) Optionally clean ESLint plugin config if lint is gated.
