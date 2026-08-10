# Findings round 3

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings`
- branch: `task/08-10-frontend-rebuild-p4-ai-plugins-settings`
- head_sha: `7cd695fd47121a10b5c17e289e6e4c64c3d248ee`
- round: 3
- resume_from: `review/findings-2.md` + full `review/verify-2.md`

## verdict
- green_for_closeout
- reason: The post-fix Verify mission is `satisfied`. Findings-2 F1 and F2 are closed by the current controller/UI paths and supporting static evidence, while the desktop baseline remains green at 275 unit tests and 9 passed / 7 explicitly fixture-skipped / 0 failed P0–P4 Playwright cases. There are no open blocker, major, minor, or evidence-dependent product issues. The only waived residual is the already-documented fixture availability/controller test-depth risk.

## need_verify
- required: false

### Verify mission
- none: `review/verify-2.md` fully answers the post-fix mission with `mission_status: satisfied`; another verification round would only repeat accepted fixture/test-depth gaps.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts:780-1090`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:1362-1454`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:1620-1640`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:560-710`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:770-1166`, `apps/desktop/src/renderer/state/ai-view.ts:69-103`
- problem: The findings-2 Plugins/External Connectors completeness gaps are closed. Connector create/update uses projected schema fields and unknown-preserving configuration merge; credential controls are declared-slot-driven; AI actions hydrate bounded editor/project context and retain cancel/history identity; lifecycle commands refresh dependent plugin projections; and permission confirmations close only after a controller-returned success.
- minimal_fix: none.
- status: fixed

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:995-1056`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1189-1317`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1364-1508`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:480-1090`
- problem: The findings-2 AI completeness gaps are closed. Runnable profiles require enabled profiles with credentials and command guards reject the empty case. Runs, batches, batch items, and usage use offset-aware authoritative loads, while the UI exposes totals, Prev/Next controls, batch counts/item diagnostics, usage aggregates, and usage records.
- minimal_fix: none.
- status: fixed

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts`, `apps/desktop/src/renderer/state/use-ai-controller.test.tsx`
- problem: Exact segment revision hydration returns a validated snapshot consumed directly by grounding/start/apply; focused unit evidence remains green.
- minimal_fix: none.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts`, `apps/desktop/src/renderer/state/use-plugin-controller.ts`, `apps/desktop/src/renderer/state/use-product-settings.ts`, `apps/desktop/src/renderer/state/use-collaboration-controller.ts`
- problem: Invalidation, pending-state reset, duplicate guards, and generation/operation ownership remain implemented; verify-2 found no regression in the green desktop gates.
- minimal_fix: none.
- status: fixed

### F5
- severity: major
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts`
- problem: Plugin panel sessions remain owned through section/surface exit, supersession, expiry, stale issue completion, unmount, lifecycle change, and matching/global revocation.
- minimal_fix: none.
- status: fixed

### F6
- severity: major
- files: `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/state/use-app-controller.ts`, `apps/desktop/src/renderer/state/use-product-settings.ts`
- problem: Migration retains and rehydrates the return identity, while restore invalidates feature/session/save ownership and cold-routes from authoritative state.
- minimal_fix: none.
- status: fixed

### F7
- severity: major
- files: `apps/desktop/src/renderer/state/appearance.ts`, `apps/desktop/src/renderer/state/appearance.test.ts`
- problem: The bounded focus-color search and extreme-seed tests continue to prove required contrast, with semantic colors independent of the accent seed.
- minimal_fix: none.
- status: fixed

### F8
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.test.tsx`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts`, `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/review/verify-2.md`
- problem: Dedicated controller/deferred coverage remains thinner than the implementation plan, and seven P3/P4 deep cases remain skipped because their named local fixtures are unavailable. The fixture-gated P4 tests contain executable product assertions, the skips are explicit and narrow, and all available unit/build/always-on E2E gates pass. This is the sole closeout waiver and does not reinterpret skipped deep flows as passed.
- minimal_fix: optional follow-up only: provision the official fixtures and add deferred controller suites for plugin/session/settings ownership paths.
- status: wontfix

### F9
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/review/verify-1.md`, `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/review/verify-2.md`
- problem: The post-fix regression baseline is green: strict desktop typecheck, 275 unit tests, production build, Engine build, and all available P0–P4 Playwright cases pass. Verify-2 reports 9 passed / 7 fixture-skipped / 0 failed.
- minimal_fix: none.
- status: fixed

### F10
- severity: minor
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:1139-1178`, `apps/desktop/src/renderer/state/use-app-controller.ts`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:766-770`
- problem: The prior apply-projection concern is closed as an architectural non-defect rather than waived residual risk: AI Control retains the authoritative `EditorMutationResult`, no Workbench projection is interactable on that surface, and Back performs mandatory authoritative Engine rehydration before Workbench becomes interactive.
- minimal_fix: none.
- status: fixed

## assumptions
- `review/verify-2.md` was read in full, including its mission answers, A1–A5 evidence, V1–V4 findings, unanswered items, and `mission_status: satisfied` conclusion.
- The current review target is the uncommitted P4 worktree at the recorded HEAD; verify-2 exercised that same post-fix tree.
- Fixture-dependent deep AI/plugin/connector and P3 interop paths remain unproven in this environment. Their explicit skips are accepted only as residual fixture/test-depth risk, not as passing evidence.
- The prior apply-projection observation is closed by the required route/rehydration contract and is not treated as an additional waiver.
- Unrelated title-bar work is outside this review and was not introduced as a finding.

## summary_for_orchestrator
- Verdict: `green_for_closeout`. Open counts: blocker 0, major 0, minor 0, needs_evidence 0. Verify-2 is satisfied; F1 and F2 are fixed; no new V* product issues require action. F8 is the sole accepted waiver for unavailable deep fixtures and thinner controller coverage. Proceed to Trellis closeout without another review/verify/fix round.
