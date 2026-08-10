# Implementation plan — Frontend rebuild P4 AI, plugins, collaboration, and settings

## 1. Execution rules

1. Work on `task/08-10-frontend-rebuild-p4-ai-plugins-settings` from `refactor/frontend-3`.
2. Keep P4 frontend-focused. Do not change Engine methods, protocol/schema, migrations, main/preload APIs, or package runtime unless an existing contract is proven broken; report an exact blocker before expanding scope.
3. Import Engine params/results from `@translunar/contracts`; do not hand-maintain parallel RPC interfaces or stringly type method names.
4. Preserve `SaveCoordinator`, IME, identity-only session-v1, feature-generation invalidation, and save-before-navigation. Re-read revisions after flush.
5. Keep route identity in `app-state`; keep provider/plugin/connector/collab/settings forms, pages, events, images, and results in dedicated hooks.
6. Snapshot `stateRef.current` before pending patches. Use independent read/list and mutation tokens; command code must block duplicates.
7. Secrets remain in active password controls only. AI credential writes use `DesktopApi.setAiCredential`. External connector credential writes use the generated connector method but never localStorage/log/error interpolation.
8. Use the existing trusted picker/session/shell DesktopApi methods. Renderer code never reads files, packages, backups, update artifacts, or plugin resources.
9. Appearance uses only versioned renderer localStorage; `updateShellSettings` remains locale-only.
10. New iconography is Phosphor. Keep solid surfaces, no glass, no new renderer Lucide, no filler subtitles/guiding microcopy/dead tabs.
11. Every displayed section must implement loading, honest empty, typed error, success, cancellation, and applicable terminal states before it is exposed in chrome.
12. Run focused checks after each work package; keep P0–P3 unit/E2E green throughout rather than deferring all regressions to the end.

## 2. Preflight and stop conditions

Before editing product code:

- [ ] Confirm current branch/base and cleanly identify task-owned files.
- [ ] Read `prd.md`, `design.md`, and every file in `implement.jsonl`.
- [ ] Verify the generated method catalog still contains every method in design §6.
- [ ] Verify `DesktopApi` still contains `setAiCredential`, plugin picker/panel lifecycle, all shell/data/backup/restore/update/tutorial methods.
- [ ] Record existing P0–P3 test names/selectors before changing AppChrome or appearance tests.

**Stop/report instead of inventing a workaround when:**

- a required Engine method is absent from `EngineMethod`/generated maps;
- a required DesktopApi method is absent or its main/preload implementation is demonstrably unusable;
- a plugin panel cannot be mounted through the existing issued-session URL/CSP contract;
- a fixture-dependent deep E2E cannot run and there is no honest skip + controller/always-on evidence path.

Preflight commands:

```bash
pnpm contracts:check
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
```

## 3. Work packages

### WP0 — Contract projections, fake DesktopApi, and pure foundations

**Goal:** Establish typed test seams and pure logic before visible P4 routes.

- [ ] Extend `apps/desktop/src/renderer/test/fake-desktop-api.ts` and its fake state with controllable values, call recording, failures, and deferred completions for:
  - all AI methods and `setAiCredential`;
  - plugin inventory/lifecycle/bundled/permission/AI-action/UI-panel methods;
  - plugin picker, panel issue/revoke/revocation subscription;
  - external connector catalog/profile/credential/invoke/checkpoint methods;
  - collaboration members/locks/presence/assignments/op log;
  - locale/shell, data, backup/restore, update, and tutorial DesktopApi methods.
- [ ] Keep the fake generic over the generated method map. Add no `as any` or string-only parallel request map.
- [ ] Add pure route helpers for P4 return target/project context and exhaustive current-surface handling.
- [ ] Add pure operation/state helpers:
  - AI provider schema projection/unknown-preserving config merge;
  - AI event reducer and run/batch terminal command guards;
  - plugin schema/lifecycle/permission/session guards;
  - external connector operation-specific request builder and bounded unknown JSON decoder;
  - collaboration context, op-log cursor, assignment/lock/heartbeat guards;
  - restore preview decoder and update command matrix.
- [ ] Add unit tests for good/base/bad cases from design §§7–12, including malformed `unknown`, unsupported schema fields, stale sequence, duplicate IDs, empty actor/reason, undeclared connector operation, malformed restore data, and invalid update transitions.
- [ ] Use one decoder/builder owner for any repeated `unknown` payload field; do not cast in components.

**Gate WP0:** focused new pure tests, full desktop typecheck, and existing desktop unit suite green.

```bash
pnpm --filter @translunar/desktop exec vitest run src/renderer/state --reporter=dot
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
```

**Rollback point:** Pure modules/fake extensions are additive and can be reverted without changing existing P0–P3 behavior.

### WP1 — Appearance-v1 and pre-React theme application

**Goal:** Lift P0 fixed defaults into a robust light/dark + custom accent system before Settings consumes it.

- [ ] Replace fixed appearance constants with:
  - `RendererAppearancePreferenceV1`;
  - key `translunar.renderer.appearance.v1`;
  - strict total read/parse/serialize helpers;
  - default light/`#765847`;
  - pure RGB/luminance/contrast/palette derivation;
  - one DOM apply function.
- [ ] Add complete solid dark surface/text/border/semantic tokens to `tokens.css` and theme selectors/data attributes.
- [ ] Refactor accent buttons/focus/borders to derived operational variables, including `--color-text-on-accent`.
- [ ] Keep success/warning/error fixed per theme and independent from accent.
- [ ] Add the CSP-compatible pre-React appearance bootstrap before `main.tsx`; retain the static light/brown HTML fallback for first install and storage failure.
- [ ] Update hard-coded `color-scheme: light` in renderer CSS/HTML runtime handling so native controls follow applied theme without causing dark-default first paint.
- [ ] Rewrite appearance tests around default, valid dark/custom persistence, unsupported version/malformed storage, storage exception, reset, contrast thresholds, semantic independence, no glass, and pre-React order.
- [ ] Verify P0 appearance expectations are intentionally lifted rather than left contradictory.

**Gate WP1:** appearance tests and full desktop unit/typecheck/build green; static no-glass/new-Lucide audit green.

```bash
pnpm --filter @translunar/desktop exec vitest run src/renderer/state/appearance.test.ts --reporter=verbose
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
if rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer; then exit 1; fi
```

**Rollback point:** Restore fixed P0 token/constants/bootstrap; leave no partial dark selectors or unused storage reader.

### WP2 — P4 surface routing, chrome, and app composition

**Goal:** Create real P4 route ownership without exposing incomplete tabs.

- [ ] Extend `AppSurface`, `AppAction`, reducer patches, and identity rendering for `ai-control`, `plugins`, `collaboration`, and `settings` using design §4 route-only state.
- [ ] Add `goAiControl`, `goPlugins`, `goCollaboration`, `goSettings`, section-change, Back, and return-rehydrate commands to `use-app-controller`.
- [ ] Reuse one save-before-P4 transition helper. Workbench flush failure must make no destination load and retain draft/session/surface.
- [ ] Collaboration command shall reject absence of project context in command code even if UI is hidden.
- [ ] Add thin surface shells and dedicated hook gateways; do not place domain forms/results in `App.tsx` or the global reducer.
- [ ] Extend `AppChrome` with Phosphor AI/Plugins/Collaboration/Settings controls, stable test IDs, `aria-current`, titles, and project-context gating.
- [ ] Ensure AppChrome remains one compact non-overlapping row at 1250px; identity yields/truncates before controls.
- [ ] Initially render only a section when its WP implementation is complete. Do not commit dead placeholder tabs between WPs.
- [ ] Add integration tests for every source route, Workbench flush success/failure, context retention, Collaboration visibility, Back rehydrate, Home/session behavior, and stale enter completion.

**Gate WP2:** focused route/App integration tests plus P0/P1 integration tests green. Manual DOM inspection confirms no dead tab exposed.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/App.integration.test.tsx \
  src/renderer/App.p1.integration.test.tsx \
  src/renderer/state/p4-route-context.test.ts --reporter=dot
pnpm --filter @translunar/desktop typecheck
```

**Rollback point:** P4 route variants and chrome actions revert together; do not leave a visible nav control after reverting its surface.

### WP3 — AI providers, credentials, and AI settings

**Goal:** Ship a complete global AI administration section before context-dependent run UI.

- [ ] Implement `use-ai-controller` list/read/mutation ownership for provider catalog/list, credentials, and AI settings.
- [ ] Build Providers UI with compact catalog/profile tables and create/edit form driven by supported generated schema fields.
- [ ] Preserve unknown profile configuration fields on update; create emits supported visible fields only.
- [ ] Display exact built-in/plugin source owner, availability/degraded reason, model/base URL/timeouts/response limit, credential presence, and revision-safe action state.
- [ ] Implement create/update/delete/test/enable-through-update flows. Refresh catalog/profiles/settings references/status after current successful mutations.
- [ ] Implement AI credential status/set/delete:
  - write only through `setAiCredential`;
  - clear password only after success;
  - retain only current input on failure;
  - no secret call logging or error interpolation.
- [ ] Implement AI settings get/update as a full fetched settings form with exact revision.
- [ ] Add empty/loading/error/success/conflict/unavailable states and duplicate-submit guards.
- [ ] Add unit/controller/integration tests for plugin-source config, unsupported schema, unknown-key preservation, status refresh, secret lifecycle, settings revision conflict, and stale completions.

**Gate WP3:** AI provider/settings focused tests, full desktop tests, typecheck green; static secret scan of P4 tests/evidence contains no fixture secret.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/ai-view.test.ts \
  src/renderer/state/use-ai-controller.test.tsx --reporter=dot
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Rollback point:** Providers/settings section is independently removable; global AI route must then be hidden until WP4 is complete.

### WP4 — AI conversations, grounding, runs, batch, usage, quality, and apply

**Goal:** Complete AI Control with context-aware operational flows.

- [ ] Add context hydration from route IDs through existing Engine-backed segment/session helpers; never trust pre-flush revisions.
- [ ] Add project conversation list/create/update/archive and message paging in the Interactive section.
- [ ] Add grounding preview with expected current segment revision and exact Engine sections/truncation/hash rendering.
- [ ] Add interactive run start/get/list/events, run-event sequence replay, timer cleanup, terminal status handling, cancel/resume exact revision, and durable reopen/resume.
- [ ] Ensure first submit creates a conversation first and uses the returned ID for grounding/run.
- [ ] Add proposal diff with local Discard and explicit `ai.result.apply`:
  - snapshot current run and segment revisions;
  - retain proposal on failure;
  - apply returned editor mutation locally only as an authoritative projection;
  - rehydrate Workbench on Back.
- [ ] Add batch start/list/get/items/cancel/resume, Engine count/status display, item paging, exact revision commands, and no local terminal inference.
- [ ] Add usage query with explicit dimension/time range/page state and exact aggregates/records.
- [ ] Add document quality score, semantic QA, and term extraction reports as read-only panels; verify they invoke no mutation method.
- [ ] Hide interactive/quality without document+segment context and batch without project context; keep Providers/Usage available globally where supported.
- [ ] Add tests for first-conversation binding, event duplicate/out-of-order handling, unmount polling cleanup without cancel, resume, apply conflict retention, batch terminal guards, usage zero/null values, quality no-write, stale generation, and no-profile empty state.

**Gate WP4:** all AI focused tests and full desktop unit/typecheck/build green. Fake integration covers the entire start→event→apply and batch flows.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/ai-events.test.ts \
  src/renderer/state/use-ai-controller.test.tsx \
  src/renderer/App.p4.integration.test.tsx --reporter=dot
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
```

**Rollback point:** Context-dependent AI sections can revert without removing provider administration; hide any reverted section from nav.

### WP5 — Plugin installed/bundled lifecycle and permissions

**Goal:** Deliver public plugin management and permission authority on the rebuilt shell.

- [ ] Implement `use-plugin-controller` independent inventory, bundled, inspect/lifecycle, version, permission, and audit operation ownership.
- [ ] Build installed inventory with exact identity/version/tier/status/source/distribution/compatibility/contribution/diagnostic projections and bounded paging.
- [ ] Build bundled inventory with catalog-available/degraded/empty states and authoritative `bundled.apply` action.
- [ ] Implement local package flow: trusted picker → inspect → inspection dialog → explicit install/upgrade.
- [ ] Keep source path only as picker-provided operation state; do not render managed `packagePath` as a user-openable path or persist it.
- [ ] Implement enable/disable/uninstall/version list/upgrade/rollback with current revisions and actor/reason where contract requires.
- [ ] Refresh installed, bundled, permissions, provider catalog, plugin actions/panels, and connector catalog after each current successful lifecycle mutation.
- [ ] Build permission request/review/grant/deny/revoke/audit sections with exact request revisions/scopes, supported/risk/required state, actor/reason guards, and failure-retaining confirms.
- [ ] Revoke/close open panel sessions for the affected plugin before/when lifecycle authority changes.
- [ ] Test picker cancel no-op, inspect-before-mutate ordering, incompatible inspection, bundled unavailable, stale revision, authoritative refresh, versions/rollback, permission grant/deny/revoke/audit, blank actor/reason, and failed dialog retention.

**Gate WP5:** plugin controller/integration tests, typecheck, and production build green; no package parser/import in renderer.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/plugin-view.test.ts \
  src/renderer/state/use-plugin-controller.test.tsx --reporter=dot
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
if rg -n "from ['\"](?:node:)?(?:fs|path|adm-zip|jszip)" apps/desktop/src/renderer; then exit 1; fi
```

**Rollback point:** Plugin lifecycle/permission sections revert together with their visible tabs; existing runtime remains untouched.

### WP6 — Plugin AI actions, UI-panel sessions, and external connectors

**Goal:** Complete plugin contribution interaction without widening renderer authority.

#### Plugin AI actions

- [ ] List exact-owner action inventory and active/degraded/detached states.
- [ ] Render supported bounded schema fields; keep JSON/unknown schema actions visible but unavailable.
- [ ] Build context only from current rehydrated project/editor identity and declared input fields.
- [ ] Implement invoke/cancel/history with descriptor versions/deadlines and Engine result proposal/usage/failure state.
- [ ] Never auto-apply a proposal or bypass normal editor/save/revision paths.

#### Plugin UI panels

- [ ] List exact-owner panel inventory and supported placement/surface state.
- [ ] Issue a session only for active exact revision; reject stale/expired completion.
- [ ] Mount only the returned `translunar-plugin:` URL in the authorized iframe shape.
- [ ] Revoke and unmount on close, section/surface navigation, supersession, unload, and affected plugin lifecycle.
- [ ] Subscribe Strict-Mode-safely to `onPluginPanelRevoked`; matching ID revokes matching panel and null revokes all.
- [ ] Add no parent-side generic bridge-call console or ad-hoc postMessage authority.

#### External connectors

- [ ] Join connector catalog to exact-owner plugin descriptor for schema/credential metadata; render missing/unsupported descriptors read-only.
- [ ] Implement profile list/create/update/delete with unknown-preserving config overlay and exact revisions.
- [ ] Implement credential status/set/delete with ephemeral password controls and returned status refresh.
- [ ] Implement declared operation forms via the one typed V1 request builder; bound JSON, IDs, items, deadline, idempotency, and checkpoint values.
- [ ] Implement invoke result and checkpoint inspection without CAT project mutation or false sync claims.
- [ ] Test all six declared operation builders, undeclared/invalid inputs, exact binding identity handoff, unknown config preservation, secret lifecycle, replay/checkpoint projection, and stale owner handling.

**Gate WP6:** action/panel/connector focused tests and full desktop test/typecheck/build green; panel cleanup verified under deferred revocation.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/plugin-view.test.ts \
  src/renderer/state/external-connector-request.test.ts \
  src/renderer/state/use-plugin-controller.test.tsx \
  src/renderer/state/use-external-connector-controller.test.tsx --reporter=dot
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
```

**Rollback point:** Revoke every issued panel session before reverting UI. Actions/panels/connectors are additive sections and leave plugin runtime untouched.

### WP7 — Local collaboration panels

**Goal:** Ship usable, honest project-scoped collaboration.

- [ ] Implement `use-collaboration-controller` with separate list/mutation tokens for members, locks, presence, assignments, and op log.
- [ ] Members: list/add/remove with role and project context; confirm removal.
- [ ] Locks: list, acquire/release/heartbeat with current project/document/segment IDs; render Engine holder/expiry/conflict.
- [ ] Presence: explicit start/stop; immediate heartbeat; bounded next-heartbeat schedule; separate list refresh; cleanup timer on section/surface/unmount/reconnect.
- [ ] Assignments: list/create with valid document/ordinal range/due date; complete with exact assignment revision; no cancel action.
- [ ] Op log: page from `afterSequence`; preserve returned order; render sequence/kind/actor/time; treat payload as bounded unknown inspection only.
- [ ] Label the surface local collaboration and avoid any remote-sync/server claim.
- [ ] Add empty/loading/error/success tests for every panel, duplicate mutation, lock conflict, stale assignment revision, heartbeat timer cleanup, op-log cursor progression, unknown payload, reconnect, and absent project gating.

**Gate WP7:** focused fake integration green and one real-Engine collaboration smoke path defined for WP10.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/collab-view.test.ts \
  src/renderer/state/use-collaboration-controller.test.tsx \
  src/renderer/App.p4.integration.test.tsx --reporter=dot
pnpm --filter @translunar/desktop typecheck
```

**Rollback point:** Collaboration surface and chrome entry revert together; heartbeat/subscriptions must be removed in the same change.

### WP8 — Product Settings shell operations

**Goal:** Deliver locale, data, backup/restore, updates, tutorial, and appearance UI over existing authorities.

#### Locale and appearance

- [ ] Load shell/system locale; implement System (`null`), English, Chinese options.
- [ ] Commit only `updateShellSettings({ locale })`; replace state from result and update `<html lang>`.
- [ ] Build light/dark selector, native color input + canonical hex field, Apply/Reset actions over appearance-v1.
- [ ] Show local persistence error if storage write fails while keeping the in-memory applied palette truthful.

#### Data directory and backup/restore

- [ ] Load data status with real path, free-space, writable/healthy/schema/override values.
- [ ] Select → validate → explicit Cancel-first migrate confirm → migrate; use returned `activePath`/phase/error.
- [ ] Backup: trusted destination selection then creation; picker cancel no-op; render returned action result.
- [ ] Restore: trusted source → preview → one strict `RestorePreviewSummary` decoder → explicit confirm → apply opaque token unchanged.
- [ ] Keep restore preview on failure. On migration/restore success, invalidate all P4 feature work and rehydrate/cold-route from authoritative shell/Engine state.

#### Updates and tutorial

- [ ] Load status and drive actions from `allowedUpdateCommands`; recheck in command code.
- [ ] Implement mode/check/defer/download/install/rollback/open-installer with current snapshot replacement and duplicate guards.
- [ ] Render install ledger/recovery/unsigned/feed/failure state from snapshot without claiming success.
- [ ] Load existing tutorial state and implement reset/skip/complete through minimal `updateTutorialState` patches.
- [ ] Add tests for exact locale patch, locale failure, appearance persistence/reset/malformed boot, data cancel/validation/failure/success, malformed restore data/token pass-through/retry, every update command guard, tutorial round-trip, stale completion, and duplicate submit.

**Gate WP8:** settings tests, appearance tests, full desktop test/typecheck/build green.

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/appearance.test.ts \
  src/renderer/state/product-settings-view.test.ts \
  src/renderer/state/use-product-settings.test.tsx \
  src/renderer/App.p4.integration.test.tsx --reporter=dot
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
```

**Rollback point:** Shell data remains main-owned. Reverting Settings does not migrate data itself; never attempt to reverse a successful user data migration in renderer rollback.

### WP9 — Visual integration, accessibility, and static quality

**Goal:** Converge P4 surfaces into one dense, coherent shell before E2E.

- [ ] Use unframed sections, compact tables, shared buttons/fields/dialogs, and confined scroll. Avoid nested decorative cards/bento.
- [ ] Use Phosphor icons only; add `aria-label` and `title` to every icon-only control.
- [ ] Ensure all tabs/sections are implemented and reachable; hide context-inapplicable sections.
- [ ] Verify Cancel-first focus, focus trap, non-destructive Escape, and focus restoration for inspect/lifecycle/permission/data/restore dialogs.
- [ ] Give plugin iframe a descriptor-derived title and safe focus behavior after revoke.
- [ ] Wrap long IDs/hashes/origins/diagnostics and assert no document-level horizontal overflow at 1250×744, 1680×942, and 1920×1080.
- [ ] Verify light/dark/custom accent focus and semantic status visibility at all viewports.
- [ ] Honor reduced motion for new transitions without changing cleanup/focus.
- [ ] Remove filler copy and any visible rebuild placeholder/dead item.
- [ ] Run targeted ESLint/Prettier and static audits; fix production warnings rather than broad-disable them.

**Gate WP9:** static audits and touched-file formatting/lint green; component/integration accessibility checks green.

```bash
pnpm exec prettier --check \
  apps/desktop/src/renderer \
  apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts
pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts
if rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer; then exit 1; fi
if rg -n "TODO|Coming soon|Placeholder" apps/desktop/src/renderer; then exit 1; fi
pnpm --filter @translunar/desktop typecheck
```

**Rollback point:** Styles and semantic DOM fixes stay coupled to the P4 components they support; do not leave orphan selectors or dark-token partials.

### WP10 — P4 real-Engine E2E and full rebuild regression

**Goal:** Prove always-on product completion and fixture-backed deep integrations without weakening P0–P3.

- [ ] Add `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts` with isolated Engine/user data, console/page-error failure, and stable P4 test IDs.
- [ ] Always-on cases:
  - create/open a real project then reach AI/Plugins/Collaboration/Settings and every visible section;
  - collaboration member/lock/presence/assignment/op-log round-trip;
  - appearance dark/custom accent persistence across Electron relaunch, reset, and malformed-storage recovery;
  - locale update persistence/document `lang`;
  - data/backup/restore trusted picker-cancel paths (no mutation), update/tutorial status reachability;
  - honest empty/unavailable provider/plugin/connector state when fixtures are absent;
  - three viewports, no horizontal overflow, sampled axe/keyboard/focus, no console errors.
- [ ] Fixture-gated cases (each checks its specific environment/resource and skips with a concrete reason only when absent):
  - loopback AI provider credential → grounding → run/events → apply → usage/quality → credential delete;
  - official bundled/local plugin inspect/install/permission/enable/versions/rollback/uninstall;
  - plugin AI action and UI panel issue/open/revoke;
  - official external connector profile/credential/test/pull/checkpoint.
- [ ] Ensure fixture-dependent skips do not skip the entire file or any always-on reachability/appearance/collaboration/settings case.
- [ ] Run focused P4 first, then P0–P4 together against a freshly built desktop and real Engine.
- [ ] Preserve P3’s honest fixture skips; do not convert skip to synthetic renderer mocks.

**Gate WP10:** focused P4 and P0–P4 matrix green for all available cases; all skips explicit; no page/console errors.

```bash
# Build synchronized Engine + desktop first.
cargo build -p translunar-engine
pnpm --filter @translunar/desktop build

# Focused P4 (from desktop package through filter exec).
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/p4-ai-plugins-settings.spec.ts

# Full frontend rebuild matrix.
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/p0-vertical-slice.spec.ts \
  tests/e2e/p1-project-lifecycle.spec.ts \
  tests/e2e/p2-editor-assets.spec.ts \
  tests/e2e/p3-interop-pdf.spec.ts \
  tests/e2e/p4-ai-plugins-settings.spec.ts
```

**Rollback point:** P4 E2E lands with P4 product. Never remove or relax P0–P3 assertions to make P4 pass.

## 4. Final validation gates

### Gate A — Contracts and static boundaries

```bash
pnpm contracts:check
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop build
if rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer; then exit 1; fi
```

Expected:

- generated contracts unchanged/green;
- no new Engine methods or protocol output;
- no renderer Node/Electron/file parser imports;
- no new Lucide/glass usage.

### Gate B — Desktop unit/integration

```bash
pnpm --filter @translunar/desktop test
```

Expected:

- all prior P0–P3 tests green;
- all P4 pure/controller/App integration tests green;
- no test-only secret appears in snapshots/logs.

### Gate C — Focused code quality

```bash
pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e
pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e
```

Any unrelated repository-wide baseline must be reported with exact file/error. Task-owned warnings/errors are not waivable by broad disable.

### Gate D — Real-Engine frontend rebuild

```bash
pnpm test:e2e:desktop
```

The authoritative final desktop command builds the Engine and built Electron app, then runs the full Playwright suite. Review must record pass/fail/skip counts by P0–P4 file and explain each fixture skip.

### Gate E — Optional full repository confidence

Run when the task-owned gates are green and environment/time allow:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Classify unrelated Rust/workspace failures rather than masking them. P4 product files must still pass targeted gates.

## 5. Review missions and evidence expectations

Review should request rich verification when static reading cannot settle:

1. **Save/race mission:** deferred Workbench flush and P4 request completions across navigation/reconnect; success means no stale surface/data commit and no draft loss.
2. **Secret/session mission:** inspect recorded fake calls, renderer storage, console, errors, and panel lifecycle; success means AI secrets occur only in `setAiCredential`, external secrets occur only in the intentional `externalConnector.credential.set` request, neither secret is persisted/echoed elsewhere, and panel sessions revoke on every owner exit.
3. **Appearance mission:** light/dark/custom accent at three viewports plus relaunch/malformed storage; success means readable controls/focus/semantics, no flash that leaves mismatched theme, and semantic tokens independent.
4. **Real-Engine mission:** P0–P4 Playwright result accounting and fixture skips; success means always-on P4 green and no regression/console errors.

Verification reports must include command, exit code, relevant log excerpt, interpretation, skip accounting, and any new issue—not only pass/fail.

## 6. Risk points and mitigations

| ID | Risk | Mitigation / gate |
| --- | --- | --- |
| K1 | P4 breadth turns `App.tsx`/`use-app-controller` into a monolith | Thin surface shells + dedicated AI/plugin/connector/collab/settings hooks; route-only reducer; review file size/ownership |
| K2 | Stale polling/list result overwrites newer owner after reconnect | Per-domain tokens tied to `featureGeneration`; deferred tests; invalidate on section/unmount/reconnect |
| K3 | Dirty target revision is captured before entering AI/collab/settings | Flush first; carry stable IDs only; re-read rows/revisions after entry |
| K4 | AI or external secret leaks through fake call logs/errors/storage | Separate AI credential DesktopApi path; redact/avoid logging secret params; ephemeral inputs; static/runtime secret inspection |
| K5 | Provider/plugin config drops unknown future keys | Update from fetched object + overlay supported fields; unit tests; unsupported schema disables edit rather than raw JSON |
| K6 | Plugin panel survives lifecycle revoke/navigation | One session owner; revoke cleanup in all exits; revocation event test; no persistence |
| K7 | External generic `unknown` request becomes arbitrary JSON console | Operation-specific V1 builder, one tested decoder, bounded fields, declared operations only |
| K8 | Collaboration UI overclaims remote sync | Explicit local state label; no server/push claims; Engine methods only; presence timer cleanup |
| K9 | Arbitrary accent breaks contrast/semantics | Pure derivation with on-accent/focus contrast tests; fixed per-theme semantic tokens; default fallback |
| K10 | Dark preference applies after React/causes first-render mismatch | External pre-React bootstrap before main module + same canonical parser/apply function |
| K11 | Restore/update destructive action fires from stale state | Strict preview decoder/opaque token; update allowed-command table + command recheck; pending duplicate guard |
| K12 | Fixture absence hides P4 incompleteness | Always-on reachability/collab/appearance/settings suite; narrow explicit fixture skips only; controller tests own exact params |
| K13 | AppChrome overflows at 1250px | Icon-only compact P4 actions, identity flex shrink, viewport geometry/overflow assertions |
| K14 | Existing P0 fixed-appearance tests/spec assumptions contradict P4 | Rewrite task-owned tests intentionally; closeout updates durable frontend specs after quality green |

## 7. Definition of done

- [ ] PRD R01–R17 and AC01–AC27 are met or an explicit blocker stops the task; no deliberately incomplete visible section ships.
- [ ] AI Control supports providers/credentials/settings, conversations/grounding/runs/apply, batch, usage, and quality with correct context gating.
- [ ] Plugins supports installed/bundled lifecycle, permissions, AI actions, authorized UI panels, and external connectors.
- [ ] Collaboration members/locks/presence/assignments/op log is usable and honest for a real local project.
- [ ] Settings supports locale, appearance, data migration, backup/restore, updates, and tutorial state over existing APIs.
- [ ] Appearance-v1 persists light/dark/custom seed locally, defaults safely, and keeps semantic colors independent.
- [ ] No protocol/main/preload widening unless separately approved after proven gap.
- [ ] No dead nav, filler placeholder, glass, new renderer Lucide, secret persistence, renderer package/file parsing, or optimistic Engine authority.
- [ ] Desktop typecheck/unit/build/contracts/static gates green.
- [ ] P0–P4 real-Engine E2E matrix green for available cases with narrow explicit fixture skips.
- [ ] Task is ready for `trellis-review`/`trellis-verify`; implementation does not start/commit/archive itself.

## 8. Execution order summary

```text
WP0 contracts/fakes/pure helpers
  → WP1 appearance-v1 foundation
  → WP2 surface routing/chrome
  → WP3 AI provider/settings
  → WP4 AI operational flows
  → WP5 plugin lifecycle/permissions
  → WP6 plugin actions/panels/connectors
  → WP7 collaboration
  → WP8 product settings
  → WP9 visual/a11y/static convergence
  → WP10 P4 + P0–P4 E2E
  → final gates / review
```

After WP2, WP3, WP5, WP7, and the shell-operation portion of WP8 may be implemented independently if multiple implement workers are ever used, but one owner must converge App routing, fake API state, styles, and E2E before exposing all sections.
