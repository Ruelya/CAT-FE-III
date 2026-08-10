# Findings round 3

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle`
- branch: `task/08-10-frontend-rebuild-p1-project-lifecycle`
- head_sha: `0c2009ace6e1a3d7c7ca6237a1c5079cc762b4f8`
- round: 3
- reviewed_state: dirty working tree after the findings-2 E2E hardening pass; final judgment incorporates the complete `review/verify-2.md` report and targeted source re-check

## verdict
- green_for_closeout
- reason: Verify round 2 is `satisfied`. Desktop/e2e typecheck, 188 renderer unit/integration tests, touched-scope ESLint and Prettier, production desktop build, Engine build, and the complete focused real-Engine Playwright matrix all passed. Playwright is 5/5 and now exercises the previously blocked P0 Home Open, mandatory S9-S10 Add-files/search/insights/relaunch path, mandatory restore/re-recycle/purge/exclusion lifecycle, and authoritative S15 example identity. No blocker, major, minor, or evidence-waiting issue remains.

## need_verify
- required: false

### Verify mission
- none

## issues

### F9
- severity: major
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:164-347`, `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:473-557`
- problem: Round 2 found permissive E2E branches that could bypass a genuinely new Add-files import, a real search-hit activation, exact relaunch continuity, mandatory restore/purge outcomes, and normal Home/search exclusion.
- minimal_fix: Completed. The current spec requires document-option growth from a third source, retains the selected document, requires and activates a non-empty Engine search result, checks identity-only session continuity across relaunch, and makes restore/re-recycle/purge/post-purge absence/Home-search exclusion unconditional.
- status: fixed

### F11
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle/review/verify-2.md`
- problem: Round 2 still lacked complete real-Engine evidence for P0 Home Open, S9-S10, and S15.
- minimal_fix: Completed. Verify-2 answers every mission question and records clean task-scoped gates plus a fresh production build and real-Engine Playwright 5/5 run.
- status: fixed

### F13
- severity: major
- files: `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts:306-317`
- problem: The P0 Home Open selector collided with Open example and aborted before resuming the listed project.
- minimal_fix: Completed. The selector is scoped to the `Listed` project row and uses the exact `Open` accessible name; the test reaches Workbench with the listed project and passed in verify-2.
- status: fixed

### F14
- severity: major
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:131-134`
- problem: The non-exact Document label selector collided with Recycle document and aborted S9-S10 and S15.
- minimal_fix: Completed. All affected assertions use the stable `document-switcher-select` landmark; S9-S10 and S15 both passed in verify-2.
- status: fixed

### F15
- severity: minor
- files: `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:568-619`
- problem: S15 previously accepted a generic Workbench-or-Import destination without proving the materialized example project/document/session identity.
- minimal_fix: Completed. S15 requires the bundled example Workbench, checks the known project projection, ties the selected example document to session-v1, and proves the same project/document identity after process relaunch.
- status: fixed

## prior_issue_disposition
- F1-F8, F10, and F12 remain fixed as established by the round-2 static re-review and the green 188-test suite; verify-2 found no runtime contradiction or new product defect in those areas.
- No new blocker, major, minor, or nit issue was reported by verify-2.

## residual_risks
- Forced Engine failure/picker-cancellation and reconnect-race paths were not repeated in Playwright. Their representative unit/integration and static guard coverage is green, and the satisfied real-Engine mission found no contradictory behavior. This is accepted as residual test-depth risk, not an open product issue.
- Keyboard behavior was not exhaustively replayed for every new control. Shared modal focus tests, Cancel-first runtime assertions, sampled axe checks, no-console guards, and compact viewport overflow checks are green. This is accepted as residual test-depth risk.
- A separate manual `pnpm dev:desktop` AC23 transcript is not present in verify-2. The production Electron/real-Engine 5/5 matrix exercises the closeout-critical lifecycle and relaunch paths without DevTools intervention; the missing duplicate manual transcript is waived as non-product evidence.
- The working tree contains unrelated task/agent edits. This is a closeout staging concern only: Orchestrator must stage and commit task-owned paths selectively.

## assumptions
- `review/verify-2.md` was read in full, including mission answers, actions A1-A8, V1-V6, unanswered items, and `mission_status: satisfied`.
- The final source re-check confirms the exact/scoped P0 Open selector, stable document selector, mandatory S9-S10 outcomes, unconditional restore/purge/exclusion assertions, and authoritative example identity/relaunch checks remain present.
- No research artifact is listed in `check.jsonl`; no re-plan or research is required.
- Verify-2's fresh production build and isolated real-Engine run are accepted as the authoritative runtime evidence for this dirty reviewed state.

## open_counts
- blocker: 0
- major: 0
- minor: 0
- needs_evidence: 0

## summary_for_orchestrator
- Final disposition is `green_for_closeout`. Mark F9, F11, F13, F14, and F15 fixed; retain the round-2 closure of F1-F8/F10/F12. The required verify mission is satisfied and no further Verify mission is warranted. Proceed to closeout, preserving the documented low-risk evidence residuals and staging only task-owned changes from the broad dirty working tree.
