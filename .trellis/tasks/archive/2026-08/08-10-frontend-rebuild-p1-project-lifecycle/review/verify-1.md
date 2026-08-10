# Verify report round 1

## mission_echo
- purpose: After F1–F10/F12 fix work, prove P0 and P1 lifecycle paths work through the production Electron build, trusted picker bridge, real Rust Engine, durable storage, destructive lifecycle operations, and relaunch — not renderer-fake unit tests alone.
- questions_addressed:
  - Q1 (P0 full path + real Engine, no console/page errors): **Partially yes.** The primary P0 vertical-slice test (`welcome → create → import → edit/confirm → QA → export → resume`) **passed** against a fresh production build and real Engine (output-file + relaunch assertions in-spec). The secondary P0 test (`project home Open resumes an existing project`) **failed** before resume assertion due to a Playwright strict-mode locator collision on `getByRole('button', { name: 'Open' })` matching both **Open** and **Open example** (see V1). No product assertion failure was reached on that second case.
  - Q2 (P1 S9–S10 multi-import, dirty switch, add-files retention, search hit, insights, relaunch): **Not proven.** Spec expanded (F9) and run against real Engine, but failed early in dirty-document switch: `getByLabel('Document')` strict-mode collision with `aria-label="Recycle document"` (V2). Multi-file import **did** reach Workbench with `document-switcher` and `batch-import-summary` visible before the failure; dirty switch, add-files retention, search hit activation, insights, and relaunch were **not** executed.
  - Q3 (templates CRUD/use/import, project update/archive/unarchive, recycle/restore/purge + failure context): **Largely yes for the happy path covered by S11–S16.** That real-Engine test **passed**, covering project edit (name → “P1 Seed Updated”), template create/edit/use → import → workbench, template delete with Cancel-first confirm, archive/unarchive with lifecycle confirm, project recycle + recycle-bin visibility, optional restore/re-recycle/purge, axe on templates/recycle, 1250×744 no viewport overflow, empty console-error guard. Explicit Engine failure/cancellation retention paths were **not** exercised end-to-end (unit/integration cover some; e2e does not force failure).
  - Q4 (recycled absent from Home/search; session-v1 timing; failed save/hydrate leaves prior state): **Partial / incomplete.** Recycle path in S11–S16 asserted “From Template” count 0 on Active Home after recycle and presence in recycle bin — good for Home exclusion of recycled project identity. **Search exclusion**, session-v1 write/clear timing, and failed save/hydrate retention were **not** observed in this Playwright run (unit/integration may cover some; real-Engine e2e did not reach those assertions in S9–S10 because that test aborted).
  - Q5 (keyboard/dialog, Cancel-first focus, axe, no overflow, no console errors at 1250×744): **Partial yes where tests reached checks.** S11–S16 set viewport 1250×744, asserted Cancel focus on edit/template-delete/archive dialogs, axe serious/critical empty on templates + recycle, no viewport overflow, no console errors for that flow. P0 primary path runs axe on several surfaces and console guards (passed). S9–S10 and S15 did not complete their a11y/console tails. Focus restoration after every dialog and full keyboard operability of all new surfaces were not exhaustively proven in e2e.

## environment
- cwd: `D:\Workbench\CAT-FE-III`
- branch: `task/08-10-frontend-rebuild-p1-project-lifecycle`
- head_sha: `0c2009ace6e1a3d7c7ca6237a1c5079cc762b4f8` (dirty working tree; P1 product + e2e untracked/modified files present)
- node: v22.19.0; pnpm: 10.18.3; rustc: 1.97.1
- OS: Windows
- production build artifact: `apps/desktop/dist/renderer/` rebuilt immediately before Playwright (`index.html` + hashed assets dated this run)
- Engine: `cargo build -p translunar-engine` finished ok (dev profile)
- deviations from findings suggested_commands:
  - Ran Orchestrator/must-run set: package typecheck, package unit tests, eslint/prettier on renderer+e2e, package build (not only `pnpm build:desktop` alias), cargo engine, focused Playwright P0+P1.
  - Did **not** run full monorepo or `pnpm test:e2e:desktop` (honors avoid until focused paths diagnose cleanly — focused e2e still red).
  - Playwright invoked via `pnpm --filter @translunar/desktop exec playwright test …`; runner completed with 3 failed / 2 passed. Footer also printed `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found` after results (pnpm exec quirk / exit path); tests **did** execute under Electron worker.

## actions

### A1 — typecheck
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- log_excerpt: |
    pretypecheck → @translunar/contracts build ok
    tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.renderer.json && tsc -p tsconfig.e2e.json
- interpretation: Desktop electron/renderer/e2e TypeScript gates clean after F* fixes.

### A2 — unit/integration tests
- command: `pnpm --filter @translunar/desktop test`
- exit_code: 0
- log_excerpt: |
    Test Files  25 passed (25)
         Tests  188 passed (188)
    Duration  ~20.5s
    Notable P1 files green:
      - App.p1.integration.test.tsx (14) — batch import, double Add-files guard, search fail retains prior projection, template create/use, search navigate
      - ConfirmDialog.test.tsx (2)
      - document-navigation / search-navigation / analytics-view / template-definition
      - App.integration.test.tsx (15) — P0-style fake path + reconnect draft retention
- interpretation: Renderer unit/integration suite expanded past review’s 178 tests and is green under fakes. Satisfies static correctness for F1/F5/F6/F8-style guards **in unit scope only**; does not close real-Engine mission.

### A3 — ESLint
- command: `pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 0
- log_excerpt: | 
    (no findings)
- interpretation: Lint clean on mission scope paths.

### A4 — Prettier
- command: `pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e`
- exit_code: 0
- log_excerpt: |
    All matched files use Prettier code style!
- interpretation: Format gate clean.

### A5 — production desktop build
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    vite build → dist/renderer/index.html, index-*.css, index-*.js (~326 kB JS)
    tsc -p tsconfig.electron.json ok
    built in ~1.22s
- interpretation: Fresh production renderer/electron compile succeeded **before** Playwright; stale-dist failure signal not observed.

### A6 — real Engine crate build
- command: `cargo build -p translunar-engine`
- exit_code: 0
- log_excerpt: |
    Finished `dev` profile [unoptimized + debuginfo] target(s) in 0.90s
- interpretation: Engine binary available for desktop child process.

### A7 — focused real-Engine Playwright (P0 + P1)
- command: `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts`
- exit_code: 1 (3 failed, 2 passed; ~12.4s wall for suite)
- log_excerpt: |
    Running 5 tests using 1 worker

    [1/5] P0 vertical slice › welcome → create → import → edit/confirm → QA → export → resume
         → PASSED

    [2/5] P0 vertical slice › project home Open resumes an existing project
         → FAILED strict mode:
           getByRole('button', { name: 'Open' }) resolved to 2 elements:
             1) data-testid="open-example" "Open example"
             2) button "Open"
           at p0-vertical-slice.spec.ts:307

    [3/5] P1 › S9–S10 dirty switch, add-files retention, search hit, insights, relaunch
         → FAILED strict mode:
           getByLabel('Document') resolved to 2 elements:
             1) #document-switcher-select (label Document)
             2) button aria-label="Recycle document"
           at p1-project-lifecycle.spec.ts:183 (selectOption after dirty fill)
           Prior steps reached: multi-file create/import, document-switcher + batch-import-summary visible

    [4/5] P1 › S11–S16 templates, project update/archive/unarchive, recycle lifecycle
         → PASSED (real Engine isolated userData; axe templates/recycle; no overflow; console empty)

    [5/5] P1 › S15 open example project with validated identity
         → FAILED strict mode:
           getByLabel('Document') same collision as V2
           at p1-project-lifecycle.spec.ts:490
           open-example click reached workbench OR import; workbench branch hit Document locator fail
           Identity assertion still weak (visibility of switcher/label, not Engine ids)

    Artifacts:
      apps/desktop/test-results/p0-vertical-slice-P0-verti-07012-resumes-an-existing-project-electron/
      apps/desktop/test-results/p1-project-lifecycle-P1-pr-d0f84-earch-hit-insights-relaunch-electron/
      apps/desktop/test-results/p1-project-lifecycle-P1-pr-dbb5e-ect-with-validated-identity-electron/
      apps/desktop/test-results/.last-run.json status=failed
- interpretation: Production Electron + isolated `TRANSLUNAR_TEST_USER_DATA` / `TRANSLUNAR_DATA_DIR` / native picker env seam exercised. Failures are **locator strict-mode** defects (test + ambiguous accessible names), not compile/launch failures and not assertion of wrong Engine mutation outcomes. Mission success_criteria requiring both focused specs fully green is **not** met.

## findings_for_reviewer

### V1
- severity: major
- related_review_ids: F11, F9 (evidence gap); product surface from P1 Welcome/Home “Open example”
- title: P0 e2e Open button strict-mode collision with “Open example”
- evidence: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:307`; Playwright error: `getByRole('button', { name: 'Open' })` → “Open example” (`data-testid="open-example"`) + row “Open”; product `ProjectHome.tsx` / `Welcome.tsx` label “Open example”
- detail: Secondary P0 real-Engine path never asserted workbench resume after Project Home Open. Primary P0 full slice still passed. Default Playwright role name match is substring, so P1’s Open example control breaks the older selector without `exact: true` or row/test-id scoping.
- suggested_next: fix_recipe_hint — prefer `getByRole('button', { name: 'Open', exact: true })` scoped to project row / `getByTestId` on Open; re-run P0 second test only first, then full focused suite.

### V2
- severity: major
- related_review_ids: F9, F11
- title: P1 e2e `getByLabel('Document')` collides with “Recycle document”
- evidence: `p1-project-lifecycle.spec.ts:166-183`, `:490`; `DocumentSwitcher.tsx` label “Document” + `aria-label="Recycle document"`; Playwright lists both elements for `getByLabel('Document')`
- detail: Blocks dirty switch (`selectOption`), add-files retention chain, search hit, insights, relaunch (S9–S10), and S15 workbench identity visibility check. Product control structure is otherwise reachable (`document-switcher` testid visible; multi-file import summary visible before fail).
- suggested_next: fix_recipe_hint — scope select via `#document-switcher-select` / `getByTestId('document-switcher').locator('select')` / `getByLabel('Document', { exact: true })`; re-run S9–S10 + S15.

### V3
- severity: minor
- related_review_ids: F9
- title: S15 identity validation still weak even if locator fixed
- evidence: `p1-project-lifecycle.spec.ts:478-493` — after open-example, accepts workbench **or** import; on workbench only asserts `document-switcher` + Document label visibility, not project/document/session identity from Engine
- detail: Mission asked for validated example identity (project/document/session). Passing a fixed locator alone would still underspecify authoritative identity vs “surface reached”.
- suggested_next: fix_recipe_hint — assert stable project name / document option value / session-backed chrome text after example open; avoid Workbench-or-Import without branch-specific Engine identity.

### V4
- severity: info
- related_review_ids: F11
- title: Static/unit/build gates green; real-Engine mission incomplete
- evidence: typecheck 0; test 188/188; eslint 0; prettier 0; desktop build 0; cargo engine 0; Playwright 2/5
- detail: Review’s unit-only green is reproduced and slightly stronger (188 vs 178). Real-Engine proof is partial: P0 primary + P1 S11–S16 green; P0 Open resume + S9–S10 + S15 blocked by V1/V2.
- suggested_next: re-run_with focused Playwright after V1/V2 test fixes; no need to re-run full monorepo yet.

### V5
- severity: info
- related_review_ids: new
- title: pnpm exec playwright footer noise
- evidence: After Playwright summary, `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "playwright" not found` while tests already ran under Electron
- detail: Does not invalidate logged pass/fail matrix; treat as packaging/exec path quirk on this host. Prefer documented desktop e2e script if instability appears.
- suggested_next: out_of_scope unless e2e becomes flaky to launch

## unanswered
- Full S9–S10 real-Engine chain: dirty save-before-switch persistence, Workbench Add-files active-document retention with one batchImport, authoritative search hit jump, compact insights content, relaunch into last hydrated document — **blocked by V2**.
- P0 Project Home Open → Workbench resume of listed project — **blocked by V1** (primary P0 resume-after-export still green).
- Authoritative example project/document/session identity (S15) — not proven (V2 + V3).
- Recycled entity exclusion from **search** (only Active Home absence shown for recycled project in S11–S16).
- Session-v1 write/clear delayed to authoritative hydrate/delete commit points under real Engine transitions — not instrumented in this e2e run.
- Failed save/hydrate leaving prior document/draft/session intact under real Engine — unit/integration only here.
- Failure/cancellation retaining originating dialog/context under real Engine for every destructive surface — dialog Cancel-first focus seen on several confirms; failure retention not forced.
- Duplicate batch/destructive mutation under real Engine (double Add-files covered in unit with deferred flush; not re-proven in Playwright).
- Whether F1 generation/token invalidation and F12 reconnect mutation-disable hold under real reconnect — not part of this Playwright matrix (integration tests touch reconnect draft retention under fakes).

## overall
- mission_status: partial
- summary_for_reviewer: Post-fix static gates for desktop renderer/e2e are clean (typecheck, 188 tests, eslint, prettier), Engine and production desktop build succeed, and a fresh `dist` was used for Electron. Real-Engine Playwright is mixed: **P0 full vertical slice passed** (export file + relaunch); **P1 S11–S16 lifecycle suite passed** (template CRUD/use/import, project update/archive/unarchive, recycle bin path, Cancel-first on key dialogs, axe, no overflow, no console errors). **Three failures are all Playwright strict-mode locator collisions (V1/V2)**, not observed Engine wrong-success or crash. Consequently the mission’s highest-risk product claims for dirty multi-doc switch, search hit, insights, relaunch continuity, Project Home Open resume, and example identity remain **unproven**, not refuted. Review should treat F11 as still open for those slices, treat F9 as “spec expanded but not fully green,” and require a short fix pass on e2e selectors (optionally stronger S15 identity asserts) then re-verify focused Playwright only.
- recommended_review_focus:
  1. Confirm V1/V2 are accepted as test (or ARIA naming) fix recipes before another full quality round.
  2. After selector fix, demand re-verify only A7 (and A5 if dist dirty) to close Q2/Q4/Q5 residuals.
  3. Do not waive S9–S10 on unit-only double-import/search tests — mission explicitly requires real Engine.
  4. Optional: strengthen S15 identity (V3) in the same fix patch.
  5. F1/F12 real reconnect behavior still lacks real-Engine e2e; if still open in code review, either add a focused reconnect e2e or document residual risk.
