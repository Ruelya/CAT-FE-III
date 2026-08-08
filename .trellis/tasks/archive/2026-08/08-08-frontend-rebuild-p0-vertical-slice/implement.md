# Implementation plan — Frontend rebuild P0 vertical slice

## 1. Execution rules

- Work only on `task/08-08-frontend-rebuild-p0-vertical-slice`, based on `refactor/frontend-3` as recorded in task metadata.
- Implement S0–S8 as one coherent workflow. Do not add P1–P4 navigation, placeholder pages, disabled roadmap controls, or an optional feature that delays required quality.
- Keep main, preload, shared API, generated contracts, and Engine authoritative. Expected product edits are renderer source, renderer/unit tests, desktop E2E, desktop dependency metadata, and lockfile only.
- Inspect exact contract definitions before writing adapters. Search for the listed method names rather than reading all of `protocol.generated.ts`.
- No `any`, invented request/response interfaces, renderer-owned domain counts, optimistic confirmation, or domain snapshots in `localStorage`.
- Use Phosphor for all new renderer icons. Do not convert unrelated intact code or remove `lucide-react` if another intact scope still needs it.
- Treat accessibility, typed errors, cancellation, stale-response protection, and reduced motion as implementation requirements within each work package, not final polish.
- Keep stable `data-testid` values at workflow landmarks; use roles/labels for ordinary component tests.

## 2. Work packages

### WP0 — Confirm exact boundaries and establish the build lane

**Purpose:** bind the frozen design to existing types and test infrastructure without broad archaeology.

**Checklist**

- [ ] Read the specs listed in `implement.jsonl`, especially Engine ownership, session/save behavior, IME, accessibility, and type safety.
- [ ] Inspect `apps/desktop/src/shared/desktop-api.ts`, `apps/desktop/src/renderer/global.d.ts`, and only the exact generated method definitions for the P0 ledger.
- [ ] Record a small implementation-side method map: canonical method name, request type, result type, error/result envelope, and identity fields used by routing.
- [ ] Confirm the exact `DraftJournal`, Engine status callback/unsubscribe, and native picker return types before implementing recovery.
- [ ] Confirm `apps/desktop/tests/e2e/**/*.ts` and current Playwright Electron configuration are the intended E2E lane.
- [ ] Run a renderer/desktop baseline for typecheck and unit tests. Record any pre-existing failure before changes.
- [ ] Add the official React Phosphor package:
  - `pnpm --filter @translunar/desktop add @phosphor-icons/react`
- [ ] Verify only `apps/desktop/package.json` and `pnpm-lock.yaml` change for dependency installation.

**Focused validation**

- `pnpm --filter @translunar/desktop typecheck`
- `pnpm --filter @translunar/desktop test`

**Gate G0**

- Exact P0 methods and journal/status contracts can be consumed from the renderer without main/preload/Engine changes.
- If a required method is not exposed or DraftJournal cannot represent the recovery requirement, stop and report the exact type/runtime blocker to the Orchestrator. Do not invent a bridge or widen scope silently.

**Risk points:** generated protocol names/envelopes, unsubscribe signatures, journal identity fields, test include paths.

**Acceptance coverage:** foundation for AC1, AC5, AC11, AC12, AC16.

---

### WP1 — Build the light token system and persistent shell

**Purpose:** eliminate the dark scaffold and establish the visual/a11y contract before adding product surfaces.

**Expected paths**

- `apps/desktop/src/renderer/index.html` if required for pre-React light background/color scheme
- `apps/desktop/src/renderer/tokens.css`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/state/appearance.ts`
- `apps/desktop/src/renderer/state/appearance.test.ts`
- `apps/desktop/src/renderer/shell/AppChrome.tsx`
- `apps/desktop/src/renderer/shell/EngineStatusBanner.tsx`
- `apps/desktop/src/renderer/App.tsx`

**Checklist**

- [ ] Apply a light canvas/color-scheme before React mounts so the HTML/root paint matches `--color-canvas`.
- [ ] Define the token contract from `design.md`: light surfaces, advanced-brown interactive states, independent semantic colors, brand-strip variables, spacing, type, radius, shadow, focus, and motion.
- [ ] Remove all dark-stub defaults and avoid both forms of `backdrop-filter`.
- [ ] Export fixed appearance identifiers/constants only where tests/controller need them. Do not add theme/accent storage or settings.
- [ ] Build compact persistent chrome and a main-stage container using Phosphor icons.
- [ ] Give icon-only controls accessible names and add visible `:focus-visible` treatment.
- [ ] Add reduced-motion CSS behavior from the start.
- [ ] Add token tests for light/brown defaults, required variables, semantic separation, and forbidden glass material.

**Focused validation**

- `pnpm --filter @translunar/desktop exec vitest run src/renderer/state/appearance.test.ts`
- `pnpm exec prettier --check apps/desktop/src/renderer`

**Gate G1a**

- Initial paint is light; shell renders without placeholder copy; tokens pass; no renderer import from `lucide-react`; no glass CSS; keyboard focus is visible.

**Risk points:** CSS imported too late for first paint, low-contrast muted/accent states, accidental translucent panel styling.

**Acceptance coverage:** AC1, AC2, AC13, AC14.

---

### WP2 — Implement the typed RPC boundary, boot controller, session routing, status, and recovery

**Purpose:** make startup/resume/reconnect deterministic before workflow surfaces mutate data.

**Expected paths**

- `apps/desktop/src/renderer/lib/rpc.ts`
- `apps/desktop/src/renderer/lib/errors.ts`
- `apps/desktop/src/renderer/state/app-state.ts`
- `apps/desktop/src/renderer/state/use-app-controller.ts`
- `apps/desktop/src/renderer/state/session.ts`
- `apps/desktop/src/renderer/state/session.test.ts`
- `apps/desktop/src/renderer/state/draft-recovery.ts`
- `apps/desktop/src/renderer/routes/resolveSurface.ts`
- `apps/desktop/src/renderer/routes/resolveSurface.test.ts`
- `apps/desktop/src/renderer/shell/BootGate.tsx`
- `apps/desktop/src/renderer/shell/RecoveryDialog.tsx`

**Checklist**

- [ ] Implement a typed `invoke` adapter using canonical method request/result types and preserving canonical error information.
- [ ] Implement total versioned session parse/serialize helpers for project/document identity; add no domain snapshot fields.
- [ ] Implement pure startup surface resolution for valid session, invalid session, empty projects, and existing projects.
- [ ] Initialize the Engine and keep product surfaces gated until a full route is ready.
- [ ] Subscribe/clean up Engine status and reconnect callbacks safely under Strict Mode.
- [ ] Add generation IDs so stale initialization, retry, and reconnect responses cannot replace current state.
- [ ] Validate session identity through `project.get`, `document.get`, and segment hydration. Clear storage only on proven invalid/recycled identity, not transport failure.
- [ ] Read/classify DraftJournal on startup; present accessible Recover/Discard, plus Retry/Discard for stale/unresolvable recovery.
- [ ] Recover only after referenced identities validate; clear only after explicit discard or later matched save success.
- [ ] Preserve current projection/draft while disconnected, disable unsafe actions, and rehydrate before enabling after reconnect.
- [ ] Add tests for session parser, route decisions, storage clearing rules, boot generations, Strict Mode listener cleanup, reconnect, and recovery focus/actions.

**Focused validation**

- `pnpm --filter @translunar/desktop exec vitest run src/renderer/state/session.test.ts src/renderer/routes/resolveSurface.test.ts`
- Run the new boot/recovery component test files by exact path once named.

**Gate G1b**

- Cold boot resolves one complete destination; malformed/deleted sessions route Home; valid sessions hydrate Workbench state; non-empty journals are never silently ignored; reconnect is generation-safe.

**Risk points:** transport failure mistaken for recycled identity, duplicate Strict Mode listeners, stale retry result, destructive recovery default.

**Acceptance coverage:** AC1, AC3, AC5, AC11, AC12, AC14.

---

### WP3 — Deliver Welcome, Project Home, Create, Import, and authoritative hydration

**Purpose:** complete the front half of the real workflow and establish a session only after usable document hydration.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/Welcome.tsx`
- `apps/desktop/src/renderer/surfaces/ProjectHome.tsx`
- `apps/desktop/src/renderer/surfaces/CreateProject.tsx`
- `apps/desktop/src/renderer/surfaces/ImportDocument.tsx`
- related controller/component tests

**Checklist**

- [ ] Render Brand Welcome only when authoritative `project.list` is empty; include one primary Create action and no feature tiles.
- [ ] Render Project Home for non-empty results with concise masthead, project rows, loading/error/retry, and Open.
- [ ] On project Open, validate with `project.get`, call `document.list`, route empty projects to Import, and deterministically hydrate the first Engine-returned document for P0 when documents exist.
- [ ] Build the minimal `project.create` form from required canonical request fields only.
- [ ] Prevent empty/invalid and duplicate creates; preserve form values on typed failure.
- [ ] On create success, keep project identity in controller memory and route to Import without writing an incomplete Workbench session.
- [ ] Call `selectSourceDocument`; treat no path as cancellation with zero `document.import` calls.
- [ ] Invoke `document.import` once for a selected path; preserve retry context on failure.
- [ ] On success, validate/get the document and call `segment.editor.list`; write the versioned session only after hydration succeeds.
- [ ] Use stable landmarks: `welcome`, `project-home`, `create-project`, and `import-document`.
- [ ] Add tests for welcome/projects resolution, empty project open, existing project open, create pending/failure/success, import cancellation/failure/success, and post-import storage timing.

**Focused validation**

- Run the new surface/controller test files by exact path.
- `pnpm --filter @translunar/desktop typecheck`

**Gate G2a**

- Empty and existing-project startup paths work; Create → Import → hydrated Workbench state completes with mocked typed API; no duplicate mutation or premature session write is possible.

**Risk points:** canonical required create fields/locales, import result identity shape, projects containing multiple documents, picker cancellation representation.

**Acceptance coverage:** AC2, AC3, AC4, AC5, AC11.

---

### WP4 — Deliver Workbench editing, save safety, IME, exact TM, and draft journal

**Purpose:** complete the core professional interaction with no data-loss or composition edge shortcuts.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/Workbench.tsx`
- `apps/desktop/src/renderer/workbench/SegmentGrid.tsx`
- `apps/desktop/src/renderer/workbench/TargetEditor.tsx`
- `apps/desktop/src/renderer/workbench/TmExactPanel.tsx`
- `apps/desktop/src/renderer/workbench/PanelChrome.tsx`
- `apps/desktop/src/renderer/state/save-coordinator.ts`
- `apps/desktop/src/renderer/lib/ime.ts`
- `apps/desktop/src/renderer/lib/ime.test.ts`
- related component/controller tests

**Checklist**

- [ ] Render project/document/action header, segment grid, target editor, Engine status, and docked exact-TM panel; do not render roadmap navigation.
- [ ] Use stable Engine segment IDs as React keys and dynamic test ID suffixes; never use row index as identity.
- [ ] Display Engine-provided source/target/status/counts. Distinguish local dirty/saving/error state from confirmed domain state.
- [ ] Build the IME guard for composition state, `isComposing`, `keyCode` 229, and `which` 229.
- [ ] Route the Confirm button and keyboard shortcut through one guarded command; disable/guard re-entry.
- [ ] Implement one in-flight target mutation per active segment with edit generations and stale-response suppression.
- [ ] Queue journal writes and `segment.editor.updateTarget`; flush current target before confirm, active-row switch, QA, Export, Home, or another applicable transition.
- [ ] If row selection changes, flush the previous active draft first; on failure retain the previous row/editor and error.
- [ ] Confirm only after save flush; re-fetch authoritative segment data afterward; move focus only on current successful confirmation.
- [ ] Preserve draft and Workbench surface on save/confirm/navigation failure.
- [ ] Clear the matching journal only after acknowledged save with no newer draft, or explicit discard.
- [ ] Request `tm.lookupExact` for active segment; display results/empty/error; ignore stale responses.
- [ ] Add accessible named collapse/expand control and optional separate UI-only persisted preference.
- [ ] Add complete no-segment/loading/error states, keyboard traversal, visible focus, and reduced-motion behavior.
- [ ] Unit-test IME negative side effects and post-composition success.
- [ ] Component-test save generations, typing during in-flight save, confirm order, selection/navigation flush, failed flush retention, journal clear timing, TM stale suppression, and panel accessible name.

**Focused validation**

- `pnpm --filter @translunar/desktop exec vitest run src/renderer/lib/ime.test.ts`
- Run save coordinator and Workbench component tests by exact path.
- `pnpm --filter @translunar/desktop typecheck`

**Gate G2b**

- Import-hydrated content is editable; update precedes confirm; composition produces zero mutations/focus movement; failed save cannot leave Workbench; exact TM is identity-safe; all displayed domain status is authoritative.

**Risk points:** input responsiveness versus save acknowledgement, stale response overwriting a newer draft, focus advance after stale confirm, journal clear racing with new input, textarea shortcuts disrupting IME.

**Acceptance coverage:** AC5, AC6, AC7, AC8, AC12, AC14.

---

### WP5 — Deliver QA review and gated export

**Purpose:** complete the quality and output half of the vertical slice with strict ordering.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/QaReview.tsx`
- `apps/desktop/src/renderer/surfaces/ExportReview.tsx`
- related controller/component tests

**Checklist**

- [ ] Make QA/Export entry use the Workbench transition flush contract.
- [ ] QA Run invokes `qa.run` once and refreshes with `qa.issue.list` only after success.
- [ ] Render Engine severity/message/identity, explicit empty state, typed failure, and rerun behavior.
- [ ] Resolve issue segment references against hydrated segments; render Jump only when resolvable.
- [ ] Jump returns to Workbench and focuses the referenced segment after successful transition/rehydration.
- [ ] Export invokes `qa.gate.check` before requesting a path.
- [ ] Failed gate renders the Engine result, offers QA navigation where useful, and makes zero picker/export calls.
- [ ] Passing gate requests `selectExportPath`; cancellation makes zero export calls and remains usable.
- [ ] Selected path invokes `document.export` exactly once with canonical context; prevent concurrent exports.
- [ ] Render Engine-backed success/failure and permit a safe retry without replaying an obsolete path implicitly.
- [ ] Add tests for QA success/empty/failure/jump/no-reference, failed save before QA/export, gate failure ordering, picker cancellation, export failure, duplicate prevention, and success.

**Focused validation**

- Run QA and Export component/controller tests by exact path.
- `pnpm --filter @translunar/desktop test`

**Gate G3**

- Edit → QA → Workbench jump and Edit → Export are complete; a failing QA gate cannot reach picker/export; a passing gate can export once; all failures preserve an actionable surface.

**Risk points:** QA result versus issue-list refresh ordering, issue reference shape, gate response interpretation, reused export destination after retry.

**Acceptance coverage:** AC8, AC9, AC10, AC12, AC14.

---

### WP6 — Converge component integration, accessibility, and copy

**Purpose:** verify that separately implemented surfaces behave as one product before launching expensive E2E.

**Checklist**

- [ ] Add/finish an App-level integration test over the typed `DesktopApi` fake for boot → create → import → edit/confirm → QA → export surface transitions.
- [ ] Force and assert all high-risk negative paths: malformed/recycled session, failed flush, reconnect, IME, failed gate, picker cancellation, stale TM.
- [ ] Test strict pending guards so repeated clicks/keys result in one mutation.
- [ ] Audit all icon-only controls for accessible names and all fields for labels.
- [ ] Audit focus order, recovery focus containment/restoration, QA Jump focus, and Workbench return focus.
- [ ] Add axe checks at component level if already straightforward; E2E axe checks remain required.
- [ ] Audit visible strings: concise functional labels/errors only; remove filler subtitle/guidance and prohibited “不是” contrast copy.
- [ ] Audit empty/loading/error states on every S0–S8 surface.
- [ ] Audit CSS at narrow supported desktop width and normal maximized width; no content-blocking overflow.

**Focused validation**

- `pnpm --filter @translunar/desktop test`
- `pnpm --filter @translunar/desktop typecheck`
- `pnpm exec eslint apps/desktop/src/renderer`

**Gate G4a**

- Full desktop unit/component suite passes; keyboard and semantic contracts are complete; every async branch has a deliberate state; no placeholder/dead UI remains.

**Risk points:** test fake drifting from `DesktopApi`, assertions overusing test IDs instead of roles, hidden inaccessible collapsed-panel control.

**Acceptance coverage:** AC1–AC14, AC16.

---

### WP7 — Rebuild desktop E2E for new test IDs and run the real-Engine demo

**Purpose:** prove the vertical slice through Electron, preload, and the real Engine rather than only component fakes.

**Expected path**

- `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts` (or an equivalently focused existing include path)
- deterministic supported input fixture under the established E2E fixture convention

**Checklist**

- [ ] Launch Electron with isolated temporary user data so test projects do not pollute developer data.
- [ ] Supply deterministic source/export paths through the existing Electron dialog layer from Playwright main-process evaluation when native dialog UI would be flaky; do not add a product-only test bridge.
- [ ] Use new stable surface landmark IDs and accessible names; avoid deleted renderer selectors.
- [ ] Exercise real launch → Welcome → Create → Import → Workbench.
- [ ] Edit one target, use the guarded Confirm interaction, and assert authoritative confirmed/rendered state.
- [ ] Run QA and assert issue/empty state completes.
- [ ] Enter Export, observe the gate, choose deterministic output after pass, and assert export success/output evidence supported by the contract.
- [ ] Close and relaunch with the same temporary user data; assert valid RPC revalidation resumes the same project/document Workbench.
- [ ] Add a no-session-with-projects case for Project Home and Open.
- [ ] Add axe scans with zero serious/critical violations on stable Welcome, Project Home, Workbench, QA, and Export states.
- [ ] Keep failed-gate/no-export proof in component integration if deterministic real content has a passing gate.
- [ ] Run the same flow manually once under `pnpm dev:desktop`, including an app/Engine restart and console inspection.

**Focused validation**

- `pnpm test:e2e:desktop -- --grep "P0 vertical slice"` if root/script argument forwarding supports it; otherwise run the exact Playwright file through the desktop filter.
- `pnpm test:e2e:desktop`

**Gate G4b**

- The new E2E passes against the real Engine with isolated data; relaunch resumes; output is produced on a passing gate; axe has no serious/critical findings; manual demo requires no DevTools intervention.

**Risk points:** Electron dialog automation, supported deterministic source fixture, QA gate outcome, preserving temporary user data across relaunch, Windows file locks during shutdown.

**Acceptance coverage:** AC3, AC4, AC6, AC9, AC10, AC11, AC14, AC15, AC17.

---

### WP8 — Final convergence and release-quality validation

**Purpose:** ensure the complete slice satisfies frozen design and touched-path quality gates.

**Checklist**

- [ ] Cross-check every R1–R14 and AC1–AC17 against implementation/tests; record evidence for any criterion that is manual.
- [ ] Confirm dependency and lockfile contain the chosen official Phosphor package.
- [ ] Confirm no new renderer imports from `lucide-react`.
- [ ] Confirm no `backdrop-filter`, `-webkit-backdrop-filter`, glass class/material, dark-default token, theme/accent settings, or shell-settings appearance patch.
- [ ] Confirm no links/nav/surfaces for templates, batch, recycle, insights, search, advanced editor, TM admin, TB, corpus/alignment, OCR, interop, plugins, AI, collaboration, settings, tutorial, or customization.
- [ ] Confirm localStorage contains only versioned session identity and optional disposable panel preference.
- [ ] Confirm Engine-derived counts/statuses are never mutated optimistically.
- [ ] Confirm renderer console has no errors/warnings during the manual real workflow.
- [ ] Run focused formatting/lint/type/build/test/E2E commands below.
- [ ] If a repository-wide command exposes an unrelated baseline failure, capture it separately while still proving all touched paths clean.

**Final gate G5**

- All required automated commands pass for touched scope.
- Real-Engine E2E and manual demo pass.
- No unresolved blocker/major issue remains within S0–S8.
- The optional example project remains omitted unless all required gates are already green and it is fully tested.

## 3. Validation command set

Run from repository root unless noted.

### Focused unit contract

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/session.test.ts \
  src/renderer/routes/resolveSurface.test.ts \
  src/renderer/lib/ime.test.ts \
  src/renderer/state/appearance.test.ts
```

Update only exact file names if implementation consolidation changes them; retain equivalent coverage.

### Desktop unit/component suite

```bash
pnpm --filter @translunar/desktop test
```

### TypeScript

```bash
pnpm --filter @translunar/desktop typecheck
```

This checks Electron, renderer, and E2E TypeScript through the package scripts.

### Touched-path lint and format

```bash
pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e
pnpm exec prettier --check \
  apps/desktop/src/renderer \
  apps/desktop/tests/e2e \
  apps/desktop/package.json \
  pnpm-lock.yaml
```

### Desktop build

```bash
pnpm build:desktop
```

### Real-Engine desktop E2E

```bash
pnpm test:e2e:desktop
```

### Frozen-design static audit

These searches must produce no renderer matches; inspect dependency references separately so intact non-renderer Lucide use is not removed accidentally.

```bash
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
rg -n "theme|accent" apps/desktop/src/renderer
```

For the second search, only fixed appearance token/constants and design-appropriate names are allowed; settings controls or persistence are failures.

### Manual real-Engine demo

```bash
pnpm dev:desktop
```

Manual sequence:

1. cold launch and observe light-first boot/status;
2. reach Welcome or Project Home;
3. create a project;
4. import one supported source document;
5. edit and confirm one target, including an IME composition check;
6. inspect exact TM panel open/collapsed;
7. run QA and jump when an issue supports it;
8. pass the gate and export, or resolve gate issues first;
9. restart Electron/Engine;
10. verify Workbench resumes by RPC with the same document and no console errors.

## 4. Acceptance-to-test matrix

| Acceptance | Primary automated evidence | Manual/E2E evidence |
| --- | --- | --- |
| AC1 | boot/status/recovery component tests; token test | cold launch light-first; retry/restart smoke |
| AC2 | welcome routing/render test; CSS audit | E2E empty-data Welcome |
| AC3 | project list/open component test | E2E Project Home/Open |
| AC4 | create/import cancel/error/success tests | real-Engine E2E Create/Import |
| AC5 | RPC/controller hydration tests | Workbench E2E data after import/resume |
| AC6 | save/confirm/TM ordering tests | E2E edit/confirm/TM |
| AC7 | pure IME + TargetEditor tests | manual IME composition check |
| AC8 | failed flush transition tests | manual failure behavior if injectable without product seam |
| AC9 | QA run/list/jump tests | real-Engine E2E QA state |
| AC10 | gate/picker/export ordering tests | E2E passing export/output |
| AC11 | session parser/validation/clear tests | E2E relaunch with same user data |
| AC12 | reconnect generation/retention tests | manual Engine restart/reconnect |
| AC13 | token/static appearance test | visual audit on all surfaces |
| AC14 | role/name/focus tests and axe | E2E axe + keyboard walkthrough |
| AC15 | Playwright P0 spec | E2E run output |
| AC16 | lint/type/test/build/E2E commands | baseline exceptions recorded if any |
| AC17 | N/A | complete `pnpm dev:desktop` sequence |

## 5. Stop/escalation conditions

Report to the Orchestrator instead of broadening implementation when any of these is proven:

- a required P0 Engine method is absent from `DesktopApi.invoke` typing/exposure;
- DraftJournal cannot associate recoverable content with a valid session/segment and no existing authoritative mechanism does;
- Engine status/restart/reconnect APIs cannot support the required recovery behavior;
- canonical create/import/export requests require a main/preload change;
- real-Engine E2E cannot isolate data or provide deterministic source/export paths through existing test/Electron facilities;
- generated contracts are internally inconsistent enough that typed renderer use cannot compile.

A blocker report must cite exact files/types/runtime evidence and the smallest required contract decision. It must not request broad product research when direct repository evidence is sufficient.

## 6. Definition of implementation complete

Implementation is complete when all work-package gates G0–G5 are satisfied, every in-scope surface has success/loading/error/cancellation behavior, the real workflow passes through Electron and the Engine, and all retained behavior meets data ownership, save, IME, QA gate, accessibility, light/brown/Phosphor, and no-glass constraints. Scope may be reduced only by omitting optional example behavior; no required S0–S8 quality edge may be deferred as a placeholder.
