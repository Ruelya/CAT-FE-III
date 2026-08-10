# Findings round 2

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle`
- branch: `task/08-10-frontend-rebuild-p1-project-lifecycle`
- head_sha: `0c2009ace6e1a3d7c7ca6237a1c5079cc762b4f8`
- round: 2
- reviewed_state: dirty working tree after the findings-1 fix pass and full `review/verify-1.md` review

## verdict
- need_fix
- reason: Post-fix static gates and 188 renderer tests are green, the primary P0 path and the P1 S11-S16 real-Engine flow passed, and prior F1-F8/F10/F12 fixes are present. However, two strict-mode locator defects leave P0 Home Open, P1 S9-S10, and S15 red; the P1 E2E still contains permissive branches that can pass without required Add-files, search, recycle, or relaunch outcomes; and S15 does not prove the authoritative example identity. The real-Engine mission therefore remains partial.

## need_verify
- required: true

### Verify mission
- purpose: After the E2E locator and assertion fixes, close the remaining real-Engine acceptance gap without repeating already-green broad static work: prove the previously aborted P0 Home Open, S9-S10, and S15 paths and ensure the P1 spec cannot pass by bypassing required lifecycle outcomes.
- questions:
  - Does Project Home's exact project-row Open action resume the listed real project in Workbench without colliding with Open example?
  - Does the S9-S10 flow complete against the real Engine and prove dirty target persistence before document switch, exact selected-document/session continuity, a genuinely new Add-files import that retains the active document, an authoritative non-empty search-hit activation, compact insights, and relaunch into the final hydrated document?
  - Does the lifecycle flow require and observe restore, re-recycle, purge, and normal Home/search exclusion rather than treating those outcomes as optional branches?
  - Does Open example prove the Engine-backed example project/document and session identity (or the branch-specific empty-project Import identity) instead of accepting only a generic Workbench-or-Import surface?
  - Do all rerun paths remain free of strict-mode locator errors, renderer/page console errors, serious/critical axe findings on reached stable P1 surfaces, and viewport-level horizontal overflow?
- success_criteria:
  - A production desktop build used by the rerun is current; desktop/e2e TypeScript remains clean after spec edits.
  - The targeted P0 Home Open test and P1 S9-S10/S15 tests pass first, followed by both focused P0/P1 specs passing in full (expected matrix: 5/5) against isolated real Engine data.
  - P0 Home Open is scoped to the intended project row or uses an exact accessible name and reaches Workbench showing the listed project.
  - S9-S10 asserts the selected document ID/value and session-v1 identity, verifies the dirty target after switching/relaunch, imports a new third file in a later picker invocation/profile relaunch, keeps the active document selected, and observes the authoritative batch summary/document list update.
  - Search must yield and activate a real hit for deterministic imported content; empty results or fallback Home/Open navigation fail the test. Relaunch must resume Workbench with the expected project/document identity; Project Home is not an accepted equivalent.
  - Restore and purge are asserted as completed Engine outcomes, including disappearance after purge and exclusion from active Home/default search; missing controls/outcomes fail rather than skip.
  - S15 compares visible/selected project-document identity with the identity-only stored session and known example projection; each allowed Workbench or empty-project Import branch has its own authoritative assertions.
- failure_signals:
  - Any Playwright strict-mode collision, early abort, stale build, Electron/Engine launch failure, console/page error, serious/critical axe violation, or viewport horizontal overflow.
  - The S9-S10 test passes after taking an empty-search fallback, re-importing only the same initial files without observing a new document, accepting Home after relaunch, or failing to re-observe the dirty saved target and expected document identity.
  - Restore/purge/search-exclusion checks are guarded by optional `if visible` branches, or the test passes without proving the durable mutation result.
  - S15 checks only surface or switcher visibility and does not tie the rendered example projection to session-v1 project/document identity.
  - Mocking `DesktopApi.invoke`/the Engine, adding a renderer test bridge, sharing destructive identities between flows, or weakening exact assertions to make the suite green.
- suggested_commands:
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts -g "project home Open"`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p1-project-lifecycle.spec.ts -g "S9–S10|S15"`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts`
- scope: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts`, and only directly necessary accessible landmarks in `apps/desktop/src/renderer/{surfaces,workbench}`; fresh desktop production output; isolated real Engine/user-data directories and the existing process-only picker seam.
- avoid: Do not run the full monorepo before the focused Electron specs are green; do not re-run the already-green 188-test suite unless product/controller code changes; do not mock the Engine or add a test-only product bridge; do not retain fallback/optional branches that let required outcomes go unobserved.
- related_issues: F9, F11, F13, F14, F15

## issues

### F9
- severity: major
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:136-151`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:189-225`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:241-262`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:423-454`
- problem: The expanded P1 E2E is still acceptance-permissive even after the strict locators are repaired. The third source file is created but never supplied to the app; Add files reuses the initial static picker paths and asserts only that the selection stayed unchanged, so no newly available document is required. Search explicitly accepts no real hit and falls back through Home/Open. Relaunch accepts either Workbench or Project Home instead of the final hydrated document. Restore/re-recycle/purge use optional visibility branches and never require post-purge absence or default-search exclusion. A green run could therefore still miss AC4, AC8-AC10, and AC21/AC22.
- minimal_fix: Make the real-Engine assertions deterministic and mandatory. One bridge-free recipe is to complete initial multi-import/switch, close and relaunch the same isolated profile with `sourceFiles: [thirdSource]`, assert exact session/document resume, then invoke Add files and require a new option plus retained active value and summary. Require a search hit for unique imported text and activate it; assert the exact session/document after navigation and relaunch. In the lifecycle flow, require restore, re-delete, purge, post-purge absence, and active/default-search exclusion; split disposable identities or launches if necessary rather than guarding assertions with `if visible`.
- status: open

### F11
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle/review/verify-1.md`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts`
- problem: The required real-Engine evidence remains incomplete. Verify-1 is `partial`: fresh build, static gates, P0 primary, and P1 S11-S16 passed, but P0 Home Open, S9-S10, and S15 aborted before their core assertions. The remaining product judgments cannot be closed from unit fakes or the passing subset.
- minimal_fix: Fix F9/F13-F15, then execute the focused Verify mission and write the complete `review/verify-2.md` with answers, action logs, V* findings, unanswered items, and an overall mission status. Do not mark this fixed from selector edits alone.
- status: needs_evidence

### F13
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:307`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:220-228`, `apps/desktop/src/renderer/surfaces/ProjectHome.tsx:291-299`
- problem: The P0 Project Home resume test uses substring role-name matching for `Open`, which now resolves both the project-row Open button and P1's Open example button. Playwright aborts in strict mode before the existing project is reopened, so this inherited P0 acceptance path is red (verify V1).
- minimal_fix: Scope the action to the row containing `Listed` and request `getByRole('button', { name: 'Open', exact: true })` (or an equally stable row landmark). Preserve the product's valid concise labels; do not rename controls solely to hide an imprecise test selector. Rerun the single P0 test before the full focused specs.
- status: open

### F14
- severity: major
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:165-183`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:489-490`, `apps/desktop/src/renderer/workbench/DocumentSwitcher.tsx:23-53`
- problem: P1 uses `getByLabel('Document')`, whose non-exact accessible-name matching resolves both the labelled document `<select>` and the `Recycle document` button. Strict mode aborts dirty switching and the S15 Workbench branch, leaving the S9-S10 chain unexecuted (verify V2).
- minimal_fix: Bind the locator to the switcher/select itself, for example `getByTestId('document-switcher').getByLabel('Document', { exact: true })` or the stable select ID. Reuse that exact locator for option/value assertions and S15. Keep the recycle button's accessible name intact.
- status: open

### F15
- severity: minor
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:477-493`, `apps/desktop/src/main/index.ts:1167-1189`
- problem: S15 accepts either Workbench or Import and, in Workbench, checks only switcher/Document visibility. It never proves that the known materialized example project and imported document became the rendered and stored session identity. Thus fixing F14 alone would still allow an unrelated Workbench/session to satisfy the example test (verify V3).
- minimal_fix: For the normal bundled example returned by the current main process, assert the known project name (`Example: Welcome to Translunar`), selected example document projection, and parsed session-v1 project/document IDs agree; close and relaunch if needed to prove resumability. If retaining the contract's empty-project Import branch, give that branch distinct assertions for the example project identity and absence of a session rather than a generic surface union.
- status: open

## assumptions
- `verify-1.md` was read in full. Its A1-A6 evidence is accepted: desktop typecheck, 188/188 unit/integration tests, renderer/E2E ESLint and Prettier, production desktop build, and Engine crate build passed on this dirty head.
- Static re-review found the prior F1-F8/F10/F12 remedies in place: generation/origin operation guards and invalidation, paged Home, `project.get` before edit, active-list hydration rejection, synchronous Add-files guard, successful-query projection ownership, awaited template deletion/built-in guard, shared modal focus behavior, document paging cap failure, and reconnect mutation disablement. They are not carried as open issues in round 2.
- P0 primary and P1 S11-S16 happy-path results from verify-1 are valid evidence, but optional branches in the source spec still need hardening under F9 before they can close all acceptance claims.
- Real reconnect races and forced Engine failure/cancellation were not rerun in Playwright; representative deferred renderer integration tests plus static guards are accepted for this round. Reopen if verify-2 observes stale navigation, mutation re-enable before revalidation, context loss, or duplicate mutation.
- No research artifact is listed in `check.jsonl`; no research or re-plan is needed.
- The broad dirty tree still contains unrelated task/agent edits. Orchestrator must stage only task-owned changes.

## summary_for_orchestrator
- Verdict is `need_fix`: 0 blocker, 3 open major (F9, F13, F14), 1 open minor (F15), and 1 major waiting on evidence (F11). Apply a narrow E2E fix pass: exact/scoped P0 Open and Document selectors, deterministic mandatory S9-S10/search/relaunch/recycle assertions, and authoritative S15 identity checks. Then dispatch the focused Verify mission; do not repeat full monorepo/static work unless product code changes. Planning artifacts are sufficient, so there is no re-plan or research request.
