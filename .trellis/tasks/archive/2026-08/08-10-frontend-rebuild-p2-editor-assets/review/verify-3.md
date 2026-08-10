# Verify report round 3

## mission_echo
- purpose: After claimed F5–F7 fixes, prove Asset Hub actions read current controlled state (no deferred setState updater side-effects), destructive curation rollback reaches Engine with correct revisions, and global editor shortcuts are accepted only in a visible/focus/IME-safe Workbench context — then re-prove static gates + real-Engine P0/P1/P2.
- questions_addressed:
  - Q1 (Non-empty searches/catalog/alignment/curation issue exactly one expected RPC from current values; blank/canceled issue none?): **Yes (renderer unit evidence).** `use-asset-controller.test.tsx` records typed `engine.calls` for `tm.search` (query/threshold/offset), `tm.concordance`, `term.search`, `corpus.search`, catalog list with filters + page offset, alignment link paging from selected session, and `curation.run` with library/reason. Blank TM/concordance/term/corpus searches and blank curation start issue zero RPCs. Implementation reads `stateRef.current.*` before any loading patch (e.g. searchQuery, catalog filters, curation libraryId/reason).
  - Q2 (Paged projections can move to a later offset and render returned page?): **Yes for TM search and catalog/alignment in unit tests.** TM search second call uses `offset: 25` and state offset becomes 25; catalog list and alignment session get are exercised with non-zero page offsets from current session/filters. Real-Engine P2 E2E still does not assert later pages (depth residual).
  - Q3 (Curation rollback invokes `curation.rollback` with run/library revisions, keeps dialog/error paths, blocks duplicates?): **Yes (unit).** `rollbackCuration` snapshots `stateRef.current.curation.snapshot` (no null holder / updater side-effect), calls `curation.rollback` with `expectedRunRevision` / `expectedLibraryRevision`, returns `true` on success / `false` on failure or missing snapshot; duplicate concurrent rollback yields exactly one RPC while `beginMut` guards the second; failed rollback leaves `actionError` set. Dialog Cancel-first UI path is not re-asserted in this unit file (surface-level); controller contract matches F7 recipe.
  - Q4 (Ctrl/Cmd+F/K, IME, keyCode/which 229 only where Workbench can accept?): **Yes (static + unit).** Main process no longer `preventDefault`s editor chords or dispatches `editor.palette` (comment + absence of before-input intercept at `main/index.ts` ~426–428). Renderer `useEffect` keydown uses `isImeKeyboardEvent`, Workbench DOM focus containment, and `resolveAcceptedEditorShortcut` (composition + 229 + workbenchFocused + registry availability). Tests: Workbench Ctrl+F opens find; inactive/outside focus/IME/229 leave panel null; unregistered Ctrl+K does not open state. `editor.palette` is not in `EDITOR_COMMAND_REGISTRY` (no K shortcut).
  - Q5 (typecheck / unit / eslint / build / no-glass / engine / Playwright P0+P1+P2 green?): **Mostly yes; ESLint red.** Typecheck 0, Vitest 215/215, build 0, engine 0, no-glass clean, Playwright electron 6/6 (~13.6s). Scoped ESLint exit 1: 13× `@typescript-eslint/require-await` in the new F5–F7 test files only (not product runtime sources).

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- head_sha: `14931c93d7f530190fbeaf5a6bc582b54f66be73` (P2 + F5–F7 fixes remain largely uncommitted working-tree / untracked task artifacts)
- node: v22.19.0 · pnpm: 10.18.3 · rustc: 1.97.1
- OS: Windows
- deviations:
  - ESLint via `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e` (no package lint script) — same scope as prior verifies.
  - Playwright `--project=electron` on three focused specs only (not full monorepo).
  - Did not run full Rust workspace tests (per avoid).
  - F5–F7 real-Engine depth for catalog list results / curation run+rollback seed paths is still primarily unit-fake-engine; P2 E2E remains TM-create + presence for catalog/curation chrome.
  - Orchestrator dispatch stated mission satisfied if 6/6 e2e + unit green; formal findings-3 success_criteria also require scoped ESLint green and stronger catalog/curation E2E assertions — those two formal items are incomplete (see overall).

## actions
### A1
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    pretypecheck → @translunar/contracts build
    tsc electron + renderer + e2e --noEmit completed with no errors
- interpretation: Desktop TypeScript clean across electron/renderer/e2e after F5–F7 changes.

### A2
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- duration_note: ~24.2s
- log_excerpt: |
    Test Files  29 passed (29)
    Tests  215 passed (215)
    Includes:
      use-asset-controller.test.tsx (9)
      use-editor-operations.test.tsx (5)
      editor-operations.test.ts (9)
      ime.test.ts (4)
      App.integration + App.p1.integration green
- interpretation: Full desktop Vitest suite green. Count rose from verify-2’s 199 → 215 with focused F5–F7 coverage. Authoritative proof for Q1–Q4 branches under fake Engine.

### A3
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.51s
- interpretation: Engine package builds; Electron harness can spawn a valid Engine.

### A4
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 1
- log_excerpt: |
    use-asset-controller.test.tsx: 5× require-await (async act wrappers without await)
    use-editor-operations.test.tsx: 8× require-await (flushOrStay/commit/refresh stubs + act wrappers)
    13 problems (13 errors, 0 warnings)
- interpretation: Tooling gate regression vs verify-2 (was exit 0). Failures are confined to new test files’ `async () => { … }` / fake save-coordinator stubs without `await`, not production renderer/e2e sources. Product logic not implicated.

### A5
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    vite build → dist/renderer (~486 kB JS)
    tsc -p tsconfig.electron.json → dist/electron
    built in ~590ms
- interpretation: Production desktop build succeeds; Playwright launches this artifact via `electron .`.

### A6
- command: `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
- exit_code: 0
- log_excerpt: |
    appearance.test.ts:44-45 only (negative assertions)
- interpretation: No glass CSS or Lucide product imports under renderer sources.

### A7
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts tests/e2e/p2-editor-assets.spec.ts --project=electron`
- exit_code: 0
- duration_note: ~13.6s for 6 tests (1 worker)
- log_excerpt: |
    [1/6] p0 welcome→create→import→edit/confirm→QA→export→resume — passed
    [2/6] p0 project home Open — passed
    [3/6] p1 S9–S10 dirty switch… — passed
    [4/6] p1 S11–S16 templates/lifecycle/recycle — passed
    [5/6] p1 S15 open example — passed
    [6/6] p2 editor commands, find, assets… — passed
    6 passed (13.6s)
- interpretation: Focused real-Engine Electron lanes green with zero skips in the run log. P2 still asserts TM create visibility + catalog filter controls presence + curation policy form presence + back-to-workbench; it does **not** assert Engine catalog rows, curation.run snapshot, or rollback (unit suite covers those).

### A8
- command: static inspection of F5–F7 fix sites (no extra process)
- exit_code: n/a
- log_excerpt: |
    F5 main/index.ts ~426-428: no will-preventDefault editor chords; comment documents renderer ownership.
    F5 use-editor-operations.ts ~634-668: keydown → isImeKeyboardEvent → workbench focus → resolveAcceptedEditorShortcut → preventDefault only if id.
    F5 editor-operations.ts ~356-378: composition/229/workbenchFocused/availability gates; matchEditorShortcut registry-only (no K/palette).
    F6 use-asset-controller.ts: stateRef.current for catalog filters, tm search/concordance, term search, corpus search, curation library/reason/policy, alignment session id, etc. Comment at ~192: never read form fields via setState updater side-effects.
    F7 rollbackCuration ~2469-2524: snapshot = stateRef.current.curation.snapshot; invokeEngine curation.rollback with run/library revisions; success true / error false + actionError.
- interpretation: Code matches F5–F7 minimal_fix recipes from findings-3. The verify-1 proven anti-pattern (assign inside setState updater then read blank local) is gone from the listed action paths.

## findings_for_reviewer
### V1
- severity: info
- related_review_ids: F6
- title: F6 deferred-updater Asset Hub no-ops appear fixed (stateRef + RPC unit matrix)
- evidence: |
    `use-asset-controller.ts` reads `stateRef.current` for TM/term/corpus/catalog/curation/alignment command snapshots before RPC.
    `use-asset-controller.test.tsx` (9 tests): non-empty TM search params + offset 25; blank search suppression (4 methods); concordance/term/corpus current queries; catalog filters/page; alignment page with/without session; curation start.
- detail: Q1–Q2 product defect class from findings-3 is refuted under fake Engine. Real-Engine multi-domain matrix still not in P2 E2E.
- suggested_next: out_of_scope for further F6 product fix unless review requires Engine-backed catalog/curation E2E asserts.

### V2
- severity: info
- related_review_ids: F7
- title: F7 curation rollback pre-RPC false return appears fixed
- evidence: |
    `rollbackCuration` uses `stateRef.current.curation.snapshot` then `curation.rollback` with expectedRunRevision/expectedLibraryRevision (`use-asset-controller.ts:2469-2491`).
    Unit: success path `ok === true` + one RPC; no-snapshot `ok === false` + zero RPC; concurrent duplicate → one RPC + actionError retained on failure path.
- detail: Matches F7 fix recipe. Dialog Cancel-first and UI close-on-true are surface concerns; controller returns boolean for the dialog layer. No real-Engine seedable rollback E2E this round.
- suggested_next: out_of_scope unless review wants one real-Engine rollback seed in P2.

### V3
- severity: info
- related_review_ids: F5
- title: F5 Workbench/IME-safe shortcut ownership appears fixed
- evidence: |
    Main does not intercept Ctrl/Cmd+F/K (`main/index.ts` comment ~426-428; no before-input editor dispatch).
    Renderer: `resolveAcceptedEditorShortcut` + workbench focus + IME/229; tests in `use-editor-operations.test.tsx` and `editor-operations.test.ts`.
    Ctrl+K unregistered → no panel; non-Workbench focus → no find.
- detail: Global swallow / invisible palette path closed at main + renderer. Registry still dispatches via hook switch after acceptance (acceptable if only registered ids run).
- suggested_next: out_of_scope.

### V4
- severity: minor
- related_review_ids: new
- title: Scoped ESLint red on new F5–F7 test files (require-await)
- evidence: |
    A4 exit 1 — 13 errors only in `use-asset-controller.test.tsx` and `use-editor-operations.test.tsx` (`@typescript-eslint/require-await`).
- detail: Blocks formal findings-3 “scoped ESLint pass” criterion. Does not fail Vitest or product runtime. Easy fix: drop unnecessary `async` on act callbacks / stub methods or add void await.
- suggested_next: fix_recipe_hint — make fake flush/commit methods sync or `await Promise.resolve()`; use non-async act callbacks where no await.

### V5
- severity: info
- related_review_ids: F8, findings-3 success_criteria
- title: P2 E2E still presence-only for catalog List and curation policy (not Engine result/rollback)
- evidence: |
    `p2-editor-assets.spec.ts:220-231` clicks catalog-search and asserts curation-policy / minimumChars visible only; TM create remains the only Engine-backed Asset Hub mutation assertion.
    Suite still 6/6 green (A7).
- detail: Acceptable residual depth if review accepts unit matrix as F6/F7 proof. Formal mission text wanted catalog rows / run snapshot in E2E — not met.
- suggested_next: re-run_with — only if review elevates catalog/curation E2E to required before closeout.

### V6
- severity: info
- related_review_ids: F1, F2, F3, F4
- title: Residual F1–F4 real-Engine depth unchanged (not reopened)
- evidence: |
    P0/P1/P2 6/6 still pass; no new failures in dirty-merge / undo-redo / reconnect / Home-from-Assets paths beyond existing suite coverage.
- detail: Prior review accepted static corrections + residual evidence risk. This round did not add new failure signals.
- suggested_next: out_of_scope.

## unanswered
- Real-Engine catalog list returning rows or explicit empty ready state after click (P2 only clicks + form presence).
- Real-Engine curation.run snapshot visibility and rollback confirmation dialog retention on Engine failure (unit covers controller; UI dialog not e2e’d).
- Whether any remaining Asset Hub mutators outside the tested set still use updater-side-effect capture (spot-check showed stateRef on listed F6/F7 paths; exhaustive audit of every mutator not re-run line-by-line beyond rg).
- Home / Assets / QA / Export Electron-level chord non-interception (unit covers inactive Workbench + outside focus; no dedicated multi-surface E2E for Ctrl+F).

## overall
- mission_status: partial
- summary_for_reviewer: F5–F7 product defects from findings-3 are strongly refuted by static code + focused Vitest (215/215, including 9 asset-controller and 5 editor-keyboard tests). Real-Engine P0/P1/P2 remain 6/6; typecheck/build/engine/no-glass are clean. Mission is **partial** (not failed) because (1) scoped ESLint is red on the new tests only (V4), and (2) formal findings-3 wanted Engine-backed catalog/curation E2E assertions beyond control presence (V5). Orchestrator’s simplified bar (6/6 e2e + unit green) is met. Recommended judgment: treat F5–F7 as fixed pending optional eslint hygiene + optional E2E depth; no product re-open signals observed this round.
- recommended_review_focus: Decide whether V4 eslint is a closeout blocker vs quick fix; whether V5 E2E depth is accepted residual; then close F5–F7 or dispatch a tiny fix for require-await only.
