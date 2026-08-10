# Verify report round 2

## mission_echo
- purpose: After the claimed V1/V2 fixes (Asset Hub TM Create silent no-op + create-without-mount), re-prove static gates and real-Engine Electron P0/P1/P2 so review can accept or reject the create-TM path and regression status.
- questions_addressed:
  - Q1 (Are V1 and V2 fixed?): **Yes, with runtime proof.** `createTmLibrary` now reads `stateRef.current.tm.createName` (no setState side-effect name capture), surfaces `VALIDATION` when empty, calls `tm.library.create`, then `tm.library.mount` (mode `write`) so the mount-scoped project list can show the library. Sibling termbase create also uses `stateRef`. Playwright P2 fills `tm-create-name` with `"P2 TM"`, clicks `tm-create`, and observes `"P2 TM"` visible within 30s.
  - Q2 (Do P0 + P1 + P2 Electron suites pass against real Engine?): **Yes.** All 6 focused tests passed (`2` P0 + `3` P1 + `1` P2) in one Playwright electron project run (~14.1s), exit 0, no skips in the run log.
  - Q3 (Does the non-import create TM path work end-to-end?): **Yes for the exercised path.** Seeded project → Assets → TM create → name visible in hub. Catalog filter controls and curation policy form presence were also asserted after TM create; back-to-workbench succeeded with empty console-error guard.
  - Q4 (Static gates: typecheck / unit / eslint / build / engine / no-glass?): **Yes, all clean this round.** ESLint is green on renderer+e2e (was red in verify-1 for missing react-hooks rule + require-await).
  - Q5 (Residual F1–F3/F7/deep AC runtime proof?): **Still open / not re-answered.** This mission did not add dirty-merge, undo/redo settle, reconnect/duplicate domain, or destructive failure-retention scenarios under real Engine.

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (large uncommitted / untracked P2 working tree; product fix lives in working tree, not necessarily committed)
- node: v22.19.0 · pnpm: 10.18.3 · rustc: 1.97.1
- OS: Windows
- deviations:
  - ESLint via `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e` (no package lint script); now exit 0.
  - Playwright via `--project=electron` on the three focused specs (matches config; not full monorepo).
  - Did not run full Rust workspace / monorepo tests (per avoid).
  - Did not re-run ad-hoc fiber/RPC diagnostics from verify-1; success is inferred from P2 E2E + code inspection of the fixed create path.

## actions
### A1
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    pretypecheck → @translunar/contracts build
    tsc electron + renderer + e2e --noEmit completed with no errors
- interpretation: Desktop TypeScript clean across electron/renderer/e2e configs.

### A2
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- log_excerpt: |
    Test Files  27 passed (27)
    Tests  199 passed (199)
    Duration  ~23.8s
    Includes App.integration, App.p1.integration, editor-operations (7), asset-view (4)
- interpretation: Full desktop Vitest suite green. Unit/integration coverage does not alone prove real-Engine create TM; that is A7.

### A3
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.53s
- interpretation: Engine package builds; Electron harness can talk to a valid Engine binary toolchain.

### A4
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 0
- log_excerpt: |
    (no findings; empty successful run)
- interpretation: Prior V3 (eslint red) is cleared on this tree. Not a product functional claim; tooling gate now passes for the scoped paths.

### A5
- command: `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
- exit_code: 0
- log_excerpt: |
    apps/desktop/src/renderer/state/appearance.test.ts:44-45 (negative assertions only)
- interpretation: No glass CSS or Lucide product imports under renderer sources; only test guards.

### A6
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    vite build → dist/renderer (~482 kB JS)
    tsc -p tsconfig.electron.json → dist/electron
    built in ~544ms
- interpretation: Production desktop build succeeds; Playwright launches this artifact via `electron .`.

### A7
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts tests/e2e/p2-editor-assets.spec.ts --project=electron`
- exit_code: 0
- duration_note: ~14.1s for 6 tests (1 worker)
- log_excerpt: |
    [1/6] p0 welcome→create→import→edit/confirm→QA→export→resume — passed
    [2/6] p0 project home Open — passed
    [3/6] p1 S9–S10 dirty switch… — passed
    [4/6] p1 S11–S16 templates/lifecycle/recycle — passed
    [5/6] p1 S15 open example — passed
    [6/6] p2 editor commands, find, assets… — passed
    6 passed (14.1s)
- interpretation: Focused P0/P1 regression lanes green against real Engine. P2 Electron/Engine path green including non-import TM create visibility (the verify-1 failure point).

### A8
- command: static inspection of `createTmLibrary` / P2 E2E assert (no extra process)
- exit_code: n/a
- log_excerpt: |
    use-asset-controller.ts ~642–701:
      name = stateRef.current.tm.createName.trim()
      empty → actionError VALIDATION "Name required"
      invokeEngine("tm.library.create", { name, locales, ownerProjectId, writable: true })
      invokeEngine("tm.library.mount", { projectId, libraryId: created.id, mode: "write", enabled: true })
      clear createName; loadTmLibraries(0)
    p2-editor-assets.spec.ts ~214–218:
      fill tm-create-name "P2 TM" → click tm-create → expect text "P2 TM" visible 30s
- interpretation: Code matches the V1+V2 fix recipes from verify-1; E2E is the authoritative product observation that the path is no longer a silent no-op and that the library appears in the hub.

## findings_for_reviewer
### V1
- severity: info
- related_review_ids: F6, F8, verify-1 V1
- title: V1 silent TM Create no-op appears fixed (create RPC + name via stateRef)
- evidence: |
    `apps/desktop/src/renderer/state/use-asset-controller.ts:642-674` reads `stateRef.current.tm.createName`; empty name sets explicit VALIDATION error instead of silent return without feedback when empty; non-empty path calls `tm.library.create`.
    P2 E2E A7: `getByText("P2 TM")` visible after create click (previously timed out with zero RPC).
- detail: The verify-1 anti-pattern (name capture via setState updater side-effect) is gone. Runtime proof is the green P2 assertion, not a re-run of the fiber/RPC monkeypatch diagnostic.
- suggested_next: out_of_scope for further V1 fix unless review wants a dedicated deferred-fake integration assert on invoke params.

### V2
- severity: info
- related_review_ids: F6, verify-1 V2
- title: V2 post-create mount appears fixed (list becomes mount-visible)
- evidence: |
    After create, controller calls `tm.library.mount` with `mode: "write", enabled: true` then `loadTmLibraries(0)` (`use-asset-controller.ts:676-689`).
    P2 E2E observes library name in the hub without a separate manual mount step.
- detail: Aligns with Engine list being mount-scoped (verify-1 diagnostic). Product create-from-hub path now creates + mounts + reloads.
- suggested_next: out_of_scope unless review wants explicit mode-selector coverage beyond hard-coded write mount.

### V3
- severity: noise
- related_review_ids: verify-1 V3
- title: ESLint scoped paths now green
- evidence: A4 exit 0 on `apps/desktop/src/renderer` + `apps/desktop/tests/e2e`
- detail: Clears prior tooling noise for this verify pass; does not prove product AC completeness.
- suggested_next: out_of_scope

### V4
- severity: info
- related_review_ids: F8
- title: P2 E2E electron lane green (F8 harness usable as acceptance evidence for exercised path)
- evidence: |
    A7 P2 passed; spec continues past TM create into catalog filters, curation policy presence, assets-back → workbench, console guard empty.
- detail: Structural F8 rewrite from verify-1 remains valid; the previous functional blocker (V1/V2) no longer fails the suite. Depth limits of the single P2 test remain (see unanswered).
- suggested_next: re-run_with — only if review requires deeper merge/reconnect/destructive cases in E2E.

### V5
- severity: info
- related_review_ids: F4
- title: Assets chrome still hides QA/Export/Insights on green P2 path
- evidence: P2 asserts zero QA/Export/Insights buttons under `app-shell` on Assets (spec lines ~190–198); suite passed.
- detail: Dead-chrome observation still holds. Home-from-Assets session-clear / relaunch-after-Assets still not in this P2 path.
- suggested_next: re-run_with — optional if F4 session branch remains open in review judgment.

### V6
- severity: minor
- related_review_ids: F1, F2, F3, F6, F7
- title: Residual runtime evidence gaps (not refuted by this green suite)
- evidence: |
    P2 covers editor command bar/history settle observation, find panel, comment create, assets entry, six tabs, TM create, catalog filter presence, curation policy presence, back to workbench.
    P2 does not assert: dirty-target merge post-flush revisions; undo/redo re-enable after busy; per-domain duplicate/stale/reconnect; corpus remove failure retention; curation rollback ConfirmDialog; alignment replaceLinks/refine reason submit shapes; full paging beyond first page; Home/relaunch after Assets.
- detail: Green P0/P1/P2 does **not** auto-close static majors F1–F7. It only proves the exercised paths and clears verify-1 V1/V2 product blockers for create TM.
- suggested_next: fix_recipe_hint for remaining open findings if review still marks them open; or a follow-up verify mission with targeted scenarios if judgment needs more Engine proof.

## unanswered
- Real-Engine proof that dirty merge always uses post-flush revisions (F2) — not in P2 E2E.
- Real-Engine proof that undo/redo never leave the command surface permanently busy (F1) — only incidental history/Working observations from prior round; not re-probed with failure/success settle matrix this round.
- Per-domain duplicate submission / stale completion / Assets reconnect revalidation before mutations (F3) under real Engine — no scenario run.
- Corpus remove failure retention and curation rollback ConfirmDialog (F7) — not exercised.
- Full request shapes for alignment replaceLinks/refine reason, catalog multi-filter submit, mount mode choices beyond create’s write mount (F6 remainder) — UI presence for catalog/curation observed; submit contracts not fully proven.
- Home/back from Assets session-clear and relaunch identity (F4 remainder) — not in P2 path.
- Whether working-tree changes are committed; head_sha still points at pre-implementation commit with uncommitted product code.

## overall
- mission_status: satisfied
- summary_for_reviewer: |
    Round-2 verify re-ran typecheck, Vitest (199), ESLint (renderer+e2e), production desktop build, engine crate build, no-glass/no-Lucide scan, and focused Playwright P0+P1+P2 against real Electron/Engine — all exit 0. The verify-1 major blockers are addressed in code and by E2E: TM Create reads name from `stateRef`, issues `tm.library.create`, mounts write, reloads, and `"P2 TM"` appears in the hub. P0 (2) and P1 (3) remain green. ESLint is no longer red on the scoped paths. Mission success criteria for this dispatch (p0/p1/p2 green + create TM works) are met. Residual open evidence for F1–F3/F6-depth/F7 and parts of F4 is unchanged and should not be treated as closed solely because this suite is green.
- recommended_review_focus: |
    1) Accept V1/V2 as fixed for the non-import create-TM hub path based on code + P2 E2E.
    2) Re-judge F8 as harness-usable / largely satisfied for the exercised AC path; keep depth gaps explicit.
    3) Do not auto-close F1–F7 from this report alone — either waive with residual risk, demand more verify scenarios, or require fix for remaining static majors.
    4) Confirm commit/branch state before merge (working tree still dirty at head_sha recorded here).
    5) Optional: extend P2 or add integration tests for merge flush-revision, undo settle, reconnect, and destructive retention if those remain acceptance-blocking.
