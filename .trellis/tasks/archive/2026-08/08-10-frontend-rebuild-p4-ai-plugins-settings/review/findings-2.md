# Findings round 2

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings`
- branch: `task/08-10-frontend-rebuild-p4-ai-plugins-settings`
- head_sha: `7cd695fd47121a10b5c17e289e6e4c64c3d248ee`
- round: 2
- resume_from: `review/findings-1.md` + full `review/verify-1.md`

## verdict
- need_fix
- reason: Baseline verification is green and F3–F9 are resolved or explicitly waived, but two visible product-completeness majors remain in Plugins/External Connectors and AI Control. No blocker remains.

## need_verify
- required: false

### Verify mission
- none: the remaining failures are directly established by reachable UI/controller code and do not require another runtime mission before fix.

## issues

### F1
- severity: major
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts:181-198`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:448-669`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:891-990`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:1118-1251`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:323-368`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:414-519`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:522-668`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:730-941`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:960-986`
- problem: Post-fix Plugins now exposes versions/rollback, permission review, schema fields for plugin AI actions, panel cleanup, connector credential slots, and declared-operation gating, so the round-1 blocker is reduced. The visible destination is still incomplete in product-significant paths: connector profile creation always sends `configuration: {}` and exposes neither schema-driven configuration nor `externalConnector.profile.update`, so existing unknown keys cannot be edited/preserved; plugin AI action invocation still fabricates blank text plus hard-coded `en`/`zh` context, retains no invokable ID, and exposes no cancel control; lifecycle mutations refresh only installed/bundled inventory rather than all dependent permission/action/panel/connector/provider projections; and permission decision dialogs close after controller-caught failures because the `.then()` callback reads stale render-time `plugins.state.error`. These remain direct R06–R09 / AC09–AC14 failures.
- minimal_fix: Add one connector profile form projected from the selected exact-owner descriptor, use it for create and unknown-preserving update with current revision, and remove the free-form credential-slot fallback when no declared slot exists. Hydrate bounded current editor context for plugin AI actions, retain the active invocation ID, and expose cancel/history against it. Centralize the post-lifecycle authoritative refresh across installed, bundled, permissions, actions, panels, connectors, and provider projections. Make permission mutation commands return success/failure and close the confirmation only on true; keep dialog, actor/reason, and error on failure.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:109-117`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1158-1307`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1376-1423`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:480-739`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:742-915`
- problem: Post-fix AI Control now exposes the omitted settings fields, message paging, run list/reopen, segment-only route gating, structured AI error formatting, exact hydration snapshots, and authoritative apply-result retention, so the round-1 blocker is reduced. The visible Batch and Usage sections remain materially incomplete: batch list/items are hard-coded to offset 0, `batchItemsTotal`/`batchItemsOffset` exist but are never populated or exposed, authoritative batch counts are not rendered, and item errors cannot be paged; usage is also fixed to offset 0 and displays only the number of returned records instead of the records and page controls. Run list state records total/offset but exposes no paging. The Interactive section reports an empty credential-backed-profile state while still rendering Start against all profiles and disables it only when the entire profile list is empty. These are direct R04–R05 / AC06–AC08 completeness and honesty gaps, independent of fixture availability.
- minimal_fix: Implement offset-aware load commands and Prev/Next controls for runs, batch list/items, and usage; store/render returned totals, offsets, limits, batch counts, item diagnostics, usage aggregates, and actual records without local inference. Derive the runnable profile set from enabled credential-backed profiles, use that set in the selector and command guard, and hide or block run controls when it is empty while preserving the truthful unavailable state.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:744-795`, `apps/desktop/src/renderer/state/use-ai-controller.test.tsx`
- problem: The hydrator now returns a generation/document/segment/op-validated `{ segmentId, revision }` snapshot, and grounding/start/apply consume that returned revision directly. Focused unit evidence proves the first-use path.
- minimal_fix: none; keep the returned snapshot as command authority rather than reverting to post-`setState` ref reads.
- status: fixed

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:272-284`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:291-301`, `apps/desktop/src/renderer/state/use-product-settings.ts`, `apps/desktop/src/renderer/state/use-collaboration-controller.ts`
- problem: Post-fix invalidation clears disposable pending presentation, mutation commands use synchronous domain guards, and continuations check generation/operation ownership. Verify found no contradictory product failure; the remaining deferred-suite depth is adjudicated under F8.
- minimal_fix: none for closeout judgment.
- status: fixed

### F5
- severity: major
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts:260-336`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:1005-1089`
- problem: Panel sessions are now revoked on section exit, surface exit, supersession, lifecycle change, unmount, matching/global revocation, expiry, stale issue completion, malformed URL, and already-expired issue response. Verify accepted the static owner/cleanup paths; missing fixture execution is adjudicated under F8.
- minimal_fix: none for closeout judgment.
- status: fixed

### F6
- severity: major
- files: `apps/desktop/src/renderer/App.tsx:321-340`, `apps/desktop/src/renderer/state/use-app-controller.ts:2870-2948`, `apps/desktop/src/renderer/state/use-product-settings.ts`
- problem: Migration and restore now have distinct gateways: migration returns through retained-target rehydration, while restore clears session/save ownership, invalidates feature work, and cold-routes from authoritative Engine state. Static post-fix evidence is accepted.
- minimal_fix: none.
- status: fixed

### F7
- severity: major
- files: `apps/desktop/src/renderer/state/appearance.ts`, `apps/desktop/src/renderer/state/appearance.test.ts`
- problem: Focus derivation now performs a verified bounded contrast search. Unit tests and an independent recomputation prove representative extreme seeds meet the required focus and on-accent contrast while semantic tokens remain seed-independent.
- minimal_fix: none.
- status: fixed

### F8
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.test.tsx`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts`, `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/review/verify-1.md`
- problem: Controller/deferred coverage remains thinner than the implementation plan, and deep AI/plugin/connector Playwright cases were fixture-skipped. The fixture tests now contain real product bodies with narrow skip reasons; always-on P4, static safety paths, focused unit evidence, and the complete desktop baseline are green. Per the round-2 disposition, this is accepted residual test-depth/environment risk rather than an open product defect. This waiver does not convert the skipped deep flows into passed evidence.
- minimal_fix: optional follow-up: add deferred controller suites and run the three deep fixture cases when official fixtures are provisioned; do not block this product-fix loop solely on those additions.
- status: wontfix

### F9
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/review/verify-1.md`
- problem: The synchronized baseline is proven: contracts, desktop typecheck, 275 unit tests, production build, Engine build, and P0–P4 Playwright all passed. Playwright accounting is 9 passed / 7 explicitly fixture-skipped / 0 failed, with every always-on P0–P4 case green and no passing-case console/page errors.
- minimal_fix: none.
- status: fixed

### F10
- severity: minor
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:1106-1146`, `apps/desktop/src/renderer/state/use-app-controller.ts:2870-2932`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:735-738`
- problem: Verify V4 correctly notes that successful `ai.result.apply` retains the authoritative `EditorMutationResult` and revision but does not merge rows into a mounted Workbench projection while the user remains on AI Control. The accepted architecture has no Workbench mounted on that surface, and Back performs a full Engine rehydrate before Workbench becomes interactive, so the user cannot return to a stale editor projection. This is accepted as a minor presentation residual rather than an open correctness issue.
- minimal_fix: optional future improvement: add an app-level mutation gateway that merges the returned rows into a retained Workbench cache without bypassing the mandatory Back rehydrate.
- status: wontfix

## assumptions
- `review/verify-1.md` was consumed in full. Its `mission_status: partial` reflects residual depth/fixture evidence, not a failing baseline.
- Broad ESLint output is not reopened: task-owned P4 product/e2e paths were clean; the reported errors are predominantly inherited non-P4 test style noise.
- Title-bar/chrome work is outside this phase judgment and is not introduced as a finding.
- Fixture skips are accepted only as explicitly documented residual risk; they are not described as passed deep integration coverage.

## summary_for_orchestrator
- Verdict: `need_fix`. Open counts: blocker 0, major 2, minor 0, needs_evidence 0. Fix only F1 and F2: complete connector profile configuration/update, plugin-action context/cancel and failure-retaining permission flow with dependent reloads; then complete AI batch/run/usage paging/projections and runnable-profile honesty. F3–F7 and F9 are fixed. F8 test-depth/fixture E2E and F10 in-place apply projection are explicitly accepted residual risks and do not independently block closeout after the two product majors are fixed.
