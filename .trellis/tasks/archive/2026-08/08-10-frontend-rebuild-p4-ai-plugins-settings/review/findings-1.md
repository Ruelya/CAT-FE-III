# Findings round 1

## meta
- task: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings`
- branch: `task/08-10-frontend-rebuild-p4-ai-plugins-settings`
- head_sha: `7cd695fd47121a10b5c17e289e6e4c64c3d248ee`
- round: 1

## verdict
- need_fix
- reason: AI Control and Plugins/Connectors expose visibly incomplete P4 destinations, several revision/session/async safety contracts are not enforced, and the submitted tests cannot prove the claimed P4 completion or the unrun P1–P3 regression matrix.

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: Establish the real desktop baseline and characterize the runtime safety/regression impact that static review cannot fully settle; this evidence is required to resolve F3–F9, but passing existing commands does not waive the static blockers F1–F8.
- questions:
  - Do desktop unit tests, strict desktop typecheck, contracts drift check, and a fresh production desktop build pass from this exact worktree, with result counts and primary errors recorded rather than only an exit code?
  - After rebuilding the synchronized Rust Engine and Electron app, what are the exact pass/fail/skip counts for each P0, P1, P2, P3, and P4 Playwright file? Are all skips narrow, fixture-specific, and explained, and are there any renderer console or page errors?
  - Do dirty-Workbench P4 navigation, deferred P4 loads/mutations, navigation away, and Engine reconnect preserve the draft/current owner, discard stale completions, and leave controls usable when the user later re-enters the same P4 surface? In particular, can the AI revision race or a stale mutation leave a command as a no-op or leave `mutationPending` stuck?
  - Does a plugin panel session revoke on UI-panel section exit, surface navigation, supersession, unmount, matching/global revocation, expiry, and stale issue completion? Is every issued-but-not-mounted session explicitly revoked?
  - Do migration success and restore success follow their distinct product routes (retained-session rehydrate for migration; full authoritative cold route/invalidation for restore), while failures remain retryable without stale P4 state committing after navigation/reconnect?
  - For representative extreme seeds including light `#99ffee` and dark `#330000`, do the applied focus indicator and primary-control text satisfy the required contrast against every relevant solid surface while success/warning/error tokens remain independent?
  - Do runtime call/storage/error/console observations keep AI secrets only in `setAiCredential`, connector secrets only in the intentional `externalConnector.credential.set` request, and plugin panel session values out of renderer persistence and error output?
  - When P4 fixture environment variables are present, does each fixture-gated AI, plugin lifecycle/permission/version, plugin action/panel, and external-connector scenario execute real assertions rather than passing an empty test body?
- success_criteria:
  - `pnpm contracts:check`, desktop typecheck, the complete desktop unit/integration suite, and a fresh desktop production build are clean; the report states the unit test count and identifies any warnings relevant to P4.
  - Every P0–P4 Playwright file is run against the fresh built app and synchronized real Engine. P0–P3 have no regressions; always-on P4 cases pass at 1250×744, 1680×942, and 1920×1080 without document-level horizontal overflow, serious/critical accessibility violations, renderer console errors, or page errors.
  - Fixture absence skips only the unavailable deep case with a concrete missing-fixture reason. Fixture presence executes assertions for the corresponding end-to-end product flow. No aggregate placeholder test passes without product interaction.
  - Dirty saves finish before P4 entry; save failure keeps Workbench/draft. Deferred/stale completions cannot replace a newer surface, project, section, revision, or error owner, and re-entered P4 controls are not permanently busy.
  - AI grounding/start/apply use the revision returned by the same current hydration read. Apply retains a proposal on failure and uses the returned authoritative mutation on success.
  - Every plugin panel session is revoked for all owner exits and stale/expired issue results; no hidden authorized session remains after leaving `uiPanels`.
  - Data migration rehydrates the retained identity; restore invalidates all feature work and restarts from shell/Engine truth. Failure retains retry context and the actual active data path.
  - Focus indication reaches at least 3:1 against canvas and raised/field surfaces for tested custom seeds; primary text reaches the applicable WCAG control-text contrast, and semantic tokens do not alias/derive from the accent.
  - No AI/connector secret or plugin panel session is present in localStorage/sessionStorage, console/page errors, displayed error text, URLs beyond the issued opaque panel URL, or unrelated recorded calls.
- failure_signals:
  - Any task-owned contract/type/unit/build failure, any P0–P4 Playwright failure, renderer console/page error, unexplained skip, or a fixture-present P4 test that performs no assertions.
  - A P4 command silently does nothing because it reads a pre-hydration revision, applies a stale revision, commits after navigation/reconnect, or remains busy after re-entry.
  - A panel issue completion survives section exit, a session is unmounted without revoke, an expired/stale URL mounts, or revocation fails to remove the matching iframe immediately.
  - Migration routes to generic Home instead of rehydrating its retained session, restore reuses stale controller state instead of cold-routing, or either completion acts after its owner is invalid.
  - Focus contrast below 3:1 on any required surface, unreadable accent-button text, or semantic status colors changing with the custom seed.
  - Any secret/session value is echoed, logged, persisted, included in a generic AI invoke, or retained outside its intentional active control/request boundary.
- suggested_commands:
  - `pnpm contracts:check`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop test`
  - `cargo build -p translunar-engine`
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts tests/e2e/p1-project-lifecycle.spec.ts tests/e2e/p2-editor-assets.spec.ts tests/e2e/p3-interop-pdf.spec.ts tests/e2e/p4-ai-plugins-settings.spec.ts --reporter=line`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/p4-ai-plugins-settings.spec.ts --reporter=line`
  - `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer`
- scope: `apps/desktop/src/renderer/**`, `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts` through `p4-ai-plugins-settings.spec.ts`, generated-contract drift, and the synchronized `translunar-engine` binary needed by desktop E2E. Use isolated temporary Engine/user-data directories. The verifier may add disposable runtime/static probes in its report when existing tests do not answer a mission question, but must not treat absent coverage as a pass.
- avoid: Do not run the optional full monorepo lint/test matrix unless a desktop failure requires classification. Do not use live external AI/network providers, install real updates, migrate/restore a real user workspace, expose fixture secrets in logs, or broaden into unrelated Rust suites. Keep fixture-gated work bounded to available local/official fixtures.
- related_issues: F1, F2, F3, F4, F5, F6, F7, F8, F9

## issues
### F1
- severity: blocker
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts:140-187`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:770-824`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:885-1006`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:107-228`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:272-380`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:443-629`
- problem: The visible Plugins destination does not implement the required lifecycle, permission, AI-action, or external-connector product contract. Upgrade/version/rollback commands exist in the controller but have no reachable UI; permission `review` is never invoked and grant/deny/revoke are immediate row buttons rather than failure-retaining authority-change confirmations; plugin AI actions have no schema form, cancel, or history and send fabricated empty English→Chinese context; connector profiles can only be created with `{}` or deleted, with no schema-driven create/update, unknown-preserving edit, credential-status projection, declared credential-slot labels, or reachable credential delete. The operation selector exposes all six operations regardless of the selected profile. These are complete visible tabs, so they violate R06–R09, AC09–AC14, and the no-dead/incomplete-navigation lock rather than representing optional polish.
- minimal_fix: Finish the existing WP5/WP6 boundaries before exposing the tabs: wire inspect-based install and upgrade separately; render versions/rollback; add exact permission review plus Cancel-first, failure-retaining decision/revoke dialogs; project AI-action schemas and current bounded editor context and expose invoke/cancel/history; join connector catalog to exact-owner descriptors, implement unknown-preserving create/update plus credential status/declared slots/set/delete, and render only declared operations. After every lifecycle mutation, reload all dependent plugin, permission, provider, action, panel, and connector projections. Hide any subsection until its handler/state matrix is complete.
- status: open

### F2
- severity: blocker
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:180-224`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1018-1044`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:369-415`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:426-610`, `apps/desktop/src/renderer/surfaces/AiControl.tsx:612-728`, `apps/desktop/src/renderer/state/p4-route-context.ts:136-151`, `apps/desktop/src/renderer/lib/errors.ts:1-55`
- problem: AI Control similarly exposes a completion surface without the required operations and projections. AI settings render only three booleans, omitting default profile, origin allowlist, and monthly budget; there is no `ai.run.list` durable reopen path, selected conversation messages are loaded but never rendered/paged in the surface, batch counts/items have no paging, and usage has no range/dimension/paging controls. `ai.result.apply` discards the returned `EditorMutationResult` instead of committing its authoritative projection. `interactive` is considered available with only a document, so QA/Export-derived contexts expose a segment-dependent tab that then renders “Segment context required,” contrary to the requirement that such controls be absent. AI errors use the generic technical formatter, so the required structured `policy_denied`/`profileId` catalog path is absent. This blocks R03–R05 and AC03–AC08.
- minimal_fix: Complete the generated-method ledger and UI state matrix: expose every settings field with the fetched revision; add run list/reopen and conversation/message paging; render authoritative grounding/events/proposal, batch counts/items/pages, usage query controls/pages, and report outputs; use the returned apply mutation through the existing editor-mutation projection before eventual Workbench rehydrate; require active segment context when deciding whether to render segment-dependent sections; and restore the structured AI error formatter keyed by stable code/data. Add honest no-enabled-credential-profile states and hide unfinished sections.
- status: open

### F3
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:699-719`, `apps/desktop/src/renderer/state/use-ai-controller.ts:831-842`, `apps/desktop/src/renderer/state/use-ai-controller.ts:905-910`, `apps/desktop/src/renderer/state/use-ai-controller.ts:1018-1025`
- problem: Exact segment revision hydration is a state side effect, but grounding/start/apply immediately read `stateRef.current.segmentRevision` after awaiting that function. React has not guaranteed that the `setState` commit updated the ref, so the command can no-op on first use or send the previously cached revision. The hydrator also has no feature-generation, document, segment, or operation-token check, allowing an older list completion to replace the current revision with a value or `null`. This defeats the post-flush exact-revision safety required by R04/R15 and can turn apply into a conflict or wrong-owner command.
- minimal_fix: Make the hydration command return a validated `{ segmentId, revision }` (or row) directly from the current Engine response. Capture generation + document/segment owner + op ID before the read, reject a stale completion, and pass that returned revision directly into grounding/start/apply; use React state only as a display cache. Add deferred tests for first use, changed revision, navigation, segment switch, and reconnect.
- status: open

### F4
- severity: major
- files: `apps/desktop/src/renderer/state/use-ai-controller.ts:248-284`, `apps/desktop/src/renderer/state/use-ai-controller.ts:435-470`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:218-257`, `apps/desktop/src/renderer/state/use-collaboration-controller.ts:130-169`, `apps/desktop/src/renderer/state/use-product-settings.ts:126-142`, `apps/desktop/src/renderer/state/use-product-settings.ts:270-548`
- problem: P4 async ownership is incomplete. AI/plugin/collaboration invalidation advances ref counters but does not clear presentation `mutationPending`; stale mutation paths return before `end`, so leaving and re-entering can preserve a permanently busy surface. The tokens do not include section/project/profile owner keys. Product Settings is weaker: data picker/validation, migration, backup, restore, update, and tutorial mutations generally have no active/generation/op check after awaits and use React `mutationPending` rather than a synchronous command guard, so rapid duplicate submits or stale commits after navigation/reconnect remain possible. This violates R15/AC23 across every P4 domain.
- minimal_fix: Introduce the design’s generation + ownerKey + independent op-ID token per read/mutation domain, with synchronous duplicate guards. Every continuation must validate its current surface/section/project/profile identity before committing or invoking a follow-up. Invalidation must clear timers/subscriptions and reset only disposable pending presentation safely so re-entry is usable. Add deferred controller/App integration tests for navigation, section switch, project switch, reconnect, duplicate clicks, and re-entry.
- status: open

### F5
- severity: major
- files: `apps/desktop/src/renderer/state/use-plugin-controller.ts:239-282`, `apps/desktop/src/renderer/state/use-plugin-controller.ts:840-879`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:55-73`, `apps/desktop/src/renderer/surfaces/Plugins.tsx:419-438`
- problem: Authorized plugin panel sessions are not owned through all required exits. The cleanup effect runs only when the whole Plugins surface becomes inactive, not when the user leaves `uiPanels`; therefore the iframe unmounts on section change while its session stays authorized. An issued session that resolves after its op becomes stale is simply dropped without revocation, and `expiresAtMs` is stored but never checked or scheduled for unmount/revoke. This violates the trusted session boundary in R08/AC12 and can leave hidden plugin authority alive.
- minimal_fix: Give the panel an exact section/owner token. Revoke before switching away from `uiPanels`, on supersession/surface exit/unmount/lifecycle authority change, and whenever an issued result is stale, malformed, or expired. Reject already-expired sessions, schedule expiry cleanup, and preserve immediate matching/global revocation unmount. Add deferred issue, section navigation, supersession, expiry, event, and unmount tests that assert each issued session ID is revoked exactly as required.
- status: open

### F6
- severity: major
- files: `apps/desktop/src/renderer/App.tsx:334-348`, `apps/desktop/src/renderer/state/use-product-settings.ts:307-439`, `apps/desktop/src/renderer/state/use-app-controller.ts:1383-1407`
- problem: Successful data migration and successful restore share one callback that calls generic `goHome()`. Migration is required to rehydrate the retained current identity, while restore must invalidate all feature work and cold-route from authoritative shell/Engine state. Routing both to Home neither preserves the migration return target nor expresses restore’s cold-start boundary; from Settings, `goHome` also does not clear/revalidate the retained session as a cold boot would. This breaks R12/AC18–AC19 even if the shell operation itself succeeds.
- minimal_fix: Split the gateway into explicit `onMigrationCommitted(result)` and `onRestoreCommitted(result)` commands. Migration should bump/invalidate P4 work and hydrate the retained `P4ReturnTarget` session from the new active directory before committing Workbench (or show a typed retryable failure). Restore should invalidate all controller generations, discard stale in-memory projections, and execute the normal authoritative startup/cold-route resolver before enabling mutations.
- status: open

### F7
- severity: major
- files: `apps/desktop/src/renderer/state/appearance.ts:200-235`, `apps/desktop/src/renderer/state/appearance.test.ts:91-101`
- problem: Custom accent focus derivation does not enforce the promised 3:1 contrast. When the seed fails, the algorithm shifts light seeds toward white on light surfaces and dark seeds toward black on dark surfaces—the direction that often reduces contrast—and performs only one unverified step. For example, light `#99ffee` derives focus `#bdfef2` at roughly 1.0:1 against the light canvas, and dark `#330000` derives `#2e0b09` at roughly 1.0:1 against the dark canvas. The test checks only text-on-accent at `>= 3` and never asserts focus against canvas and raised surfaces. This fails R14/AC22 and visible-focus accessibility.
- minimal_fix: Derive focus with a bounded iterative/binary lightness search that verifies at least 3:1 against every required solid theme surface, retaining hue where possible and falling back to a known accessible theme focus token when no candidate succeeds. Assert the final computed ratios for black/white/extreme/chromatic seeds in both themes, primary text contrast at the required threshold, and semantic-token independence.
- status: open

### F8
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/implement.md:570-610`, `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/implement.md:369-408`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:125-251`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:313-328`
- problem: The submitted acceptance coverage cannot support the completion claim. There are no `use-ai-controller`, `use-plugin-controller`, `use-collaboration-controller`, `use-product-settings`, or P4 App integration tests despite the plan requiring deferred/race/secret/session/command coverage. The always-on Playwright case only round-trips a member and starts/stops presence; it does not round-trip locks, assignments, settings picker-cancel paths, malformed appearance storage, locale reload, panel lifecycle, or the required command safety. The sole fixture-gated test contains only two conditional `test.skip` calls and no product body/assertions—when both variables are present it passes without exercising AI or plugin behavior, and it has no connector gate at all. Thus “2 pass + 1 fixture skip” is not AC25 evidence.
- minimal_fix: Add the planned controller/App integration suites with deferred promises, duplicate guards, exact params, error retention, secret call/storage inspection, timer/subscription cleanup, and stale generation/owner cases. Expand always-on real-Engine P4 coverage to all mandatory local/settings/appearance paths. Split each AI/plugin/action-panel/connector fixture path into a real scenario with its own narrow precondition and executable assertions; never use an empty aggregate skip test.
- status: open

### F9
- severity: major
- files: `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/implement.md:410-457`, `.trellis/tasks/08-10-frontend-rebuild-p4-ai-plugins-settings/implement.md:470-479`
- problem: P1–P3 real-Engine Playwright suites were not rerun in the implementation pass, while P4 changes central `App`, `AppChrome`, routing/controller code, global CSS, appearance tokens, and the shared fake API. Static review cannot establish AC25 or the inherited save/IME/navigation/interop regression contract without the complete P0–P4 report and skip accounting.
- minimal_fix: Execute the Verify mission on a freshly synchronized Engine/desktop build, attach a rich `verify-1.md` with per-file counts, skips, relevant logs, interpretations, and newly discovered V* issues, then fix any task-owned regressions before review resumes.
- status: needs_evidence

## assumptions
- No prior `findings-*.md` or `verify-*.md` exists for this task; this is the initial quality round.
- Review covers the uncommitted task worktree at the recorded HEAD plus its current tracked/untracked P4 files. The user-supplied “269 unit/typecheck/build green; P4 2 pass + 1 skip; P0 smoke green” claims were treated as implementation claims, not as a rich verification report.
- Fixture-dependent deep integrations may skip only when their exact local fixture is absent; always-on routing, local collaboration, appearance, settings non-destructive paths, accessibility/layout, and console safety remain mandatory.
- Existing generated Engine/DesktopApi contracts are assumed authoritative because this task did not change protocol/main/preload product code; missing renderer orchestration is not treated as permission to invent a replacement contract.

## summary_for_orchestrator
- Verdict is `need_fix`. Two blocker-level completion gaps remain in the visible AI and Plugins/Connector destinations, with six additional open major issues in exact revision handling, async ownership, plugin panel session cleanup, settings post-commit routing, appearance contrast, and acceptance coverage. One major-severity regression question remains `needs_evidence`. Dispatch fix against F1–F8 before closeout; run the complete Verify mission and return the full `verify-1.md` to review so F3–F9 can be adjudicated with runtime evidence.
