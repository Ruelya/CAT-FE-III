# Implementation plan — Frontend rebuild P1 project lifecycle and discoverability

## 1. Execution rules

- Work only on `task/08-10-frontend-rebuild-p1-project-lifecycle`, based on `refactor/frontend-3` as recorded in task metadata.
- Extend the P0 renderer in place. Do not replace the reducer/controller/session/save architecture or reintroduce a root renderer monolith.
- Deliver S9–S16 as one coherent quality slice. Do not add P2–P4 navigation, placeholder surfaces, settings, archive-file UX, folder recursion, or advanced analysis.
- Domain state is Engine-owned. Use generated contract method relationships through `lib/rpc.ts`; do not duplicate protocol interfaces, use `any`, or optimistically mutate revisions/lifecycle/counts/results.
- Keep the existing session-v1 shape unchanged and identity-only. Persist only after authoritative hydration.
- All Workbench exits, document switches, and active-document destructive actions must pass through the existing `SaveCoordinator.flush()` boundary.
- Canonical multi-file decision is frozen: `selectSourceDocuments()` → one `project.batchImport` request with `atomicity: "bestEffort"` and `{ path }` items. No repeated `document.import`; no folder UI.
- Reuse current CSS tokens/Phosphor. No glass, no new Lucide renderer imports, no theme/accent settings, no bento marketing layout, and no filler microcopy.
- Treat accessibility, stale-response suppression, typed errors, cancellation, duplicate guards, and P0 regression as requirements inside each work package.
- Read only the relevant generated definitions when implementing. Do not edit main/preload/Engine/contracts unless a verified blocker is reported to the Orchestrator first.

## 2. Work packages

### WP0 — Bind exact contracts and capture the green P0 baseline

**Purpose:** convert the plan ledger into exact implementation types and prove the branch starts from the shipped P0 lane.

**Checklist**

- [ ] Read every spec and archive reference in `implement.jsonl`.
- [ ] Inspect the current complete definitions for `SessionContext`, `AppSurface`, `AppController.commands`, session persistence, `SaveCoordinator.flush`, `AppChrome`, `App`, the typed fake, and P0 E2E landmarks.
- [ ] Inspect only exact generated request/result definitions for the P1 ledger in `design.md`.
- [ ] Confirm at code/test level that recycle `entityType` literals are exactly `project` and `document`.
- [ ] Confirm the current `document.list` paging request fields and `segment.editor.list` pagination helper behavior.
- [ ] Confirm `ExampleProjectResult` optional ID/error shape and existing main implementation behavior without changing the bridge.
- [ ] Confirm the P1 template definition keys used by Engine storage (`sourceLocale`, `targetLocale`, `domain`) and record them as typed renderer-owned keys only.
- [ ] Run baseline desktop typecheck/unit tests and focused P0 E2E. Record any pre-existing failure before product edits.
- [ ] Do not add dependencies unless implementation proves a blocker and Orchestrator approves the scope change.

**Validation**

```bash
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts
```

**Gate G0**

- Every P1 method/API binds through existing generated contracts and `DesktopApi`; P0 baseline is known.
- If a required method, entity type, or hydration result cannot satisfy the design without main/preload/Engine changes, stop and report exact file/type/runtime evidence. Do not widen scope silently.

**Risk points:** broad generated `unknown` template definition, recycle literal mismatch, existing list helper assumptions, E2E build staleness.

**Acceptance coverage:** foundation for AC1–AC23.

---

### WP1 — Extend typed state, pure lifecycle helpers, and the shared navigation boundary

**Purpose:** establish safe P1 state and operation primitives before rendering feature surfaces.

**Expected paths**

- `apps/desktop/src/renderer/state/app-state.ts`
- `apps/desktop/src/renderer/state/use-app-controller.ts`
- focused new helpers under `state/` or `routes/`
- colocated tests

**Checklist**

- [ ] Add real `templates`, `recycle`, `search`, and `insights` surface variants with complete payloads; retain all P0 variants.
- [ ] Extend `SessionContext` with the Engine-backed active project document collection.
- [ ] Add a bounded, Engine-order-preserving `listAllDocuments(projectId)` helper with page progression, cross-project validation, duplicate/non-advancing protection, and tests.
- [ ] Reuse or generalize segment-row paging without changing P0 result semantics.
- [ ] Implement a shared save-before-transition primitive used by Home/QA/Export and all new Workbench exits.
- [ ] Define operation identities/generations for navigation, document switch, batch import, templates, recycle, search, insights, and example materialization.
- [ ] Ensure reconnect invalidates stale P1 completions and can request feature refresh after revalidation.
- [ ] Keep feature-local form/query state out of the main reducer/controller where it does not cross surfaces.
- [ ] Add pure tests for document aggregation, session commit timing, stale operation suppression, and post-delete destination resolution.

**Validation**

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/session.test.ts \
  src/renderer/routes/resolveSurface.test.ts \
  src/renderer/state/save-coordinator.test.ts
# Also run exact new lifecycle helper test paths.
pnpm --filter @translunar/desktop typecheck
```

**Gate G1**

- P0 state/transition tests remain green; P1 has typed surface payloads, bounded document paging, one shared flush boundary, and stale-response guards before UI work.

**Risk points:** growing the existing controller indiscriminately, replacing the session before hydrate, unbounded paging, feature operation IDs colliding.

**Acceptance coverage:** AC1, AC2, AC10, AC16, AC18, AC21.

---

### WP2 — Deliver S9 Workbench document switching

**Purpose:** remove P0's first-document ambiguity while preserving draft/session safety.

**Expected paths**

- `apps/desktop/src/renderer/workbench/DocumentSwitcher.tsx`
- `apps/desktop/src/renderer/surfaces/Workbench.tsx`
- `apps/desktop/src/renderer/state/use-app-controller.ts`
- App/controller/component tests

**Checklist**

- [ ] Hydrate/refresh the complete project document list whenever a session is established or reconnected.
- [ ] Render a labelled keyboard-accessible document switcher in Workbench chrome, with active state, pending disablement, error/retry, and stable document identities.
- [ ] Make active-document selection a guarded no-op.
- [ ] On another-document selection: flush current draft, validate ownership, hydrate document/rows/counts, then commit Workbench and session-v1.
- [ ] Keep old Workbench/session intact until the complete new context is ready.
- [ ] On flush/hydrate failure, preserve draft/focus/active document and show a typed transition error.
- [ ] Attach `SaveCoordinator` and exact-TM selection only after the new Workbench context commits.
- [ ] Ignore an older switch completion when a later navigation/reconnect wins.
- [ ] Add integration tests using deferred save/document/segment promises to assert call order and zero premature storage writes.

**Validation**

```bash
# Run exact DocumentSwitcher and controller integration test paths.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G2**

- Multi-document Workbench discovery and switching are complete; dirty save failure cannot change document or session; successful switching is authoritative and stale-safe.

**Risk points:** save coordinator still attached to old row after commit, TM response from prior document, switch pending UI trapping focus.

**Acceptance coverage:** AC1, AC2, AC16, AC19, AC21.

---

### WP3 — Deliver S10 canonical multi-file import and add-files flow

**Purpose:** replace P0's single picker/mutation path with one complete Engine batch flow.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/ImportDocument.tsx`
- `apps/desktop/src/renderer/workbench/BatchImportSummary.tsx`
- `apps/desktop/src/renderer/surfaces/Workbench.tsx`
- controller and typed fake/tests

**Checklist**

- [ ] Change Import action to `selectSourceDocuments`; empty array is a no-op with no error.
- [ ] Build exactly one `project.batchImport` request with `bestEffort` and picker-order `{ path }` items; do not send invented `relativePath` or loop `document.import`.
- [ ] Guard picker/import against repeated activation in both UI and command layers.
- [ ] Render Engine totals and every diagnostic status/path/relative path/message/document field that is present.
- [ ] Refresh authoritative documents after any success.
- [ ] For an empty/new project, prefer a valid first successful diagnostic document; otherwise choose first fresh Engine document, hydrate, then write session and enter Workbench.
- [ ] For Add files in an existing Workbench, first use the shared flush boundary, retain the active document, refresh `ctx.documents`, and show the summary in Workbench.
- [ ] Keep all-failed summary/current context retryable and do not claim import success.
- [ ] Retain template dependency diagnostics alongside initial Import when the project came from a template.
- [ ] Update the typed fake to support path arrays and authoritative batch responses.
- [ ] Add tests for cancellation, one-item P0 compatibility, mixed/all-failed results, duplicate guard, initial-open fallback, Workbench retain-active, and stale import completion.

**Validation**

```bash
# Run exact ImportDocument, batch summary, and App integration test paths.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G3**

- One-file P0 import and P1 multi-file import both work through the canonical batch method; partial results are never hidden; document/session outcomes follow the design.

**Risk points:** success diagnostic lacks document, picker returns duplicate paths, summary lost during automatic Workbench transition, P0 E2E dialog stub return shape.

**Acceptance coverage:** AC3, AC4, AC19, AC21.

---

### WP4 — Deliver S11 Templates

**Purpose:** make reusable project defaults safe and complete without exposing later administration.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/Templates.tsx`
- optional `TemplateEditor.tsx`
- `apps/desktop/src/renderer/state/template-definition.ts`
- surface/controller/helper tests

**Checklist**

- [ ] Add Templates as a real Project Home destination with current-state semantics and paginated `project.template.list`.
- [ ] Fetch `project.template.get` before edit/use and guard stale selection responses.
- [ ] Implement pure decoding/creation/update merge for `sourceLocale`, `targetLocale`, and `domain` over an unknown definition.
- [ ] Reject edit of non-object definitions with explicit state; never cast unchecked.
- [ ] Preserve every unknown fetched definition key on update.
- [ ] Create/update forms include labelled name/description/locales/domain, required validation, pending/error behavior, and exact fetched revision.
- [ ] Built-in templates show View/Use only; command code also rejects mutation.
- [ ] Delete custom templates only through reusable destructive confirmation and exact revision; refresh list after success.
- [ ] Create from template with validated project name and locale/domain overrides; render dependency diagnostics and route Import without session persistence.
- [ ] Preserve form/selection on Engine validation/conflict failure and guard duplicate mutation.
- [ ] Add tests for paging, get-before-use/edit, unknown definition, merge preservation, built-in guards, revision conflict, deletion focus/confirm behavior, diagnostics, and session timing.

**Validation**

```bash
# Run exact template helper/surface/controller test paths.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G4**

- Template list/get/create/update/delete/use is fully functional and revision-safe; P1 edits cannot erase unexposed template configuration; new projects reach Import honestly.

**Risk points:** `unknown` definition narrowing, empty built-in locale defaults requiring overrides, conflict replay, diagnostics overflowing compact UI.

**Acceptance coverage:** AC5, AC6, AC15–AC17, AC21.

---

### WP5 — Deliver S12 Recycle and S16 project update/archive lifecycle

**Purpose:** provide complete reversible/permanent lifecycle actions with safe active-session behavior.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/ProjectHome.tsx`
- `apps/desktop/src/renderer/surfaces/RecycleBin.tsx`
- `apps/desktop/src/renderer/shell/ConfirmDialog.tsx`
- Workbench document action integration
- controller/component tests

**Checklist**

- [ ] Add Engine-filtered Active/Archived views to Project Home with deterministic paging.
- [ ] Add project Edit dialog/form that sends all required current fields, unchanged configuration, and exact revision through `project.update`.
- [ ] Add archive/unarchive actions through `project.setLifecycle` for only `archived`/`active`; refresh the authoritative filtered list.
- [ ] Add project recycle and document recycle through `recycle.delete` with exact identity/revision/type and a required non-empty reason.
- [ ] Flush before recycling the active document; reroute only after success and a fresh document list.
- [ ] Clear/reroute an active project session only after project recycle succeeds.
- [ ] Implement Recycle destination with bounded `recycle.list`, empty/loading/error/paging states, and Engine metadata.
- [ ] Add distinct Restore and Purge confirmations; purge wording/state is permanently destructive, initial focus remains Cancel, Escape never submits.
- [ ] Call `recycle.restore`/`recycle.purge` exactly once and refresh after success; retain entry/error on failure.
- [ ] Ensure normal project/search calls exclude recycled data and no UI path uses `project.setLifecycle("trash")`.
- [ ] Test complete update request/config preservation, active/archive conflict behavior, delete reason/revision, active-doc last/remaining routing, restore/purge duplicate/failure paths, dialog keyboard/focus, and no dangling session.

**Validation**

```bash
# Run exact ProjectHome, RecycleBin, ConfirmDialog, and lifecycle controller tests.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G5**

- Project update, archive/unarchive, recycle, restore, and purge are distinct, authoritative, accessible, conflict-safe, and session-safe.

**Risk points:** stale expected revision after list refresh, deleting final project document, confirmation focus restoration, restored entity list visibility.

**Acceptance coverage:** AC7, AC8, AC13, AC14, AC16, AC17, AC21.

---

### WP6 — Deliver S13 global search and save-safe direct navigation

**Purpose:** make project/document/segment content discoverable with no false jump.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/GlobalSearch.tsx`
- `apps/desktop/src/renderer/state/search-navigation.ts`
- `apps/desktop/src/renderer/shell/AppChrome.tsx`
- controller/helper/component tests

**Checklist**

- [ ] Add Search as a real persistent-chrome destination after startup; mark current state semantically.
- [ ] Use the shared flush boundary when entering Search from Workbench.
- [ ] Separate editable query from submitted query; trimmed blank submit makes zero RPC calls.
- [ ] Invoke `search.global` with `includeRecycled: false`, bounded offset/limit, and no invented advanced filters.
- [ ] Render authoritative total/hits/snippets as text with paging, loading, empty, and typed errors.
- [ ] Ignore older query/page completion after a later submit.
- [ ] Add pure hit classification for project/document/segment destinations.
- [ ] Navigate project-only hits through standard project-open resolution; document/segment hits through project/document validation and row hydration.
- [ ] Verify a requested segment exists before session commit/focus; mismatches retain query/results with navigation error.
- [ ] Persist session only after successful hydration, and restore target focus after render.
- [ ] Test blank/query/paging/stale results, safe snippets, save failure entering Search, every hit kind, cross-project/missing segment failures, and session timing.

**Validation**

```bash
# Run exact search helper/surface/App integration test paths.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G6**

- Search is globally discoverable, stale-safe, recycle-excluding, and can open only validated project/document/segment destinations without losing a draft or query context.

**Risk points:** duplicate hit identity keys, stale segment after index update, snippet markup handling, search surface state lost on failed navigation.

**Acceptance coverage:** AC9, AC10, AC15–AC17, AC21.

---

### WP7 — Deliver S14 compact insights and S15 example project

**Purpose:** expose honest project status and a complete bundled starting path without expanding analysis/tutorial scope.

**Expected paths**

- `apps/desktop/src/renderer/surfaces/ProjectInsights.tsx`
- `apps/desktop/src/renderer/state/analytics-view.ts`
- `apps/desktop/src/renderer/surfaces/Welcome.tsx`
- `apps/desktop/src/renderer/surfaces/ProjectHome.tsx`
- `apps/desktop/src/renderer/shell/AppChrome.tsx`
- controller/helper/component tests

**Checklist**

- [ ] Add Insights action for valid project contexts and route Workbench entry through flush.
- [ ] Invoke only `project.analytics.get`; render project/document progress, QA blockers, productivity availability, and trend events from Engine data.
- [ ] Join document names only from authoritative document list; preserve unknown/unavailable document mapping explicitly.
- [ ] Format basis points/durations/timestamps in pure helpers; never derive productivity or substitute zero for unavailable metrics.
- [ ] Use compact semantic rows/tables and an accessible trend representation; avoid bento/cards wall and omit AI/assets sections.
- [ ] Complete loading, empty-trend, error/retry, stale response, return-Home/Workbench behavior.
- [ ] Add Open example on Welcome and Project Home through existing `openExampleProject` only.
- [ ] Normalize false/error results; validate candidate project/document IDs through Engine and fallback to fresh document list when document ID is absent.
- [ ] Persist example session only after row hydration; route an empty example project to Import.
- [ ] Guard duplicate/stale example completion and retain origin context on failure.
- [ ] Test analytics available/unavailable/empty/error/stale/no-analysis-calls; example false/missing project/no document/hydrate failure/success/session timing.

**Validation**

```bash
# Run exact analytics and example component/controller tests.
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
```

**Gate G7**

- Insights are dense, honest, accessible, and analytics-only; the example action always validates before opening and is fully retryable.

**Risk points:** mapping analytics document IDs to names, misleading basis-point formatting, example packaged-path failure, showing returned IDs as trusted state.

**Acceptance coverage:** AC11, AC12, AC15–AC17, AC21.

---

### WP8 — Converge App integration, chrome, accessibility, and P0 regression

**Purpose:** verify S0–S16 behave as one product before expensive real-Engine P1 E2E.

**Checklist**

- [ ] Compose every new surface in `App.tsx`; no surface is unreachable and no chrome destination is dead.
- [ ] Extend `AppChrome` carefully: global Home/Search and contextual QA/Export/Insights only when valid; Home Projects/Templates/Recycle remain real labelled destinations.
- [ ] Audit every Workbench exit/switch/active destructive action against the shared flush primitive.
- [ ] Extend the typed `DesktopApi` fake for all P1 paths without weakening method-to-result typing.
- [ ] Add/extend App integration flows that cross feature boundaries: batch import → switch → search jump → insights; template → project → import; recycle active doc/project → restore.
- [ ] Force all high-risk negative branches: save failure, revision conflict, mixed import, stale query/switch, reconnect, optional example IDs, purge failure.
- [ ] Audit pending/duplicate guards in UI and command code.
- [ ] Audit labels, current state, focus order, modal focus/restore/Escape, live statuses, semantic lists/tables, text-only snippets, and chart equivalent.
- [ ] Run axe on stable component surfaces if existing harness supports it; E2E axe remains required.
- [ ] Audit copy for concise functional labels/errors only.
- [ ] Audit 1250x744 and larger responsive behavior; prevent viewport horizontal overflow.
- [ ] Re-run all P0 unit tests and ensure IME/save/recovery/session/QA/export behavior is unchanged.

**Validation**

```bash
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop typecheck
pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e
pnpm exec prettier --check apps/desktop/src/renderer apps/desktop/tests/e2e
```

**Gate G8**

- Desktop unit/component suite is green; all real destinations are reachable; accessibility and failure states are complete; S0–S16 transition invariants converge.

**Risk points:** App prop explosion, fake API drifting from DesktopApi, hidden focus after modal/surface changes, duplicate nav paths bypassing flush.

**Acceptance coverage:** AC1–AC21.

---

### WP9 — Add real-Engine P1 E2E and preserve P0 E2E

**Purpose:** prove lifecycle/discoverability through Electron, preload, real Engine, storage, dialogs, and relaunch.

**Expected paths**

- `apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts`
- existing `apps/desktop/tests/e2e/p0-vertical-slice.spec.ts` only where P1 Import UI requires selector/dialog adaptation
- deterministic TXT/HTML fixtures under existing test fixture conventions

**Checklist**

- [ ] Launch with isolated temporary user data and real Engine; capture renderer console/page errors.
- [ ] Control multi-file picker returns through existing Electron dialog handling; add no product test bridge.
- [ ] Flow A: create project → select several files → inspect complete batch result → switch documents → edit target and immediately switch to prove flush → relaunch and assert selected doc resume.
- [ ] Flow A: run global search over imported/edited content → open document/segment hit → inspect project insights.
- [ ] Flow B: create/edit custom template → create project from template → inspect diagnostics → import → update project → archive → archived view → unarchive.
- [ ] Flow C: create disposable entities → recycle document/project → verify normal Home/search exclusion → restore → recycle again → purge → verify recycle removal.
- [ ] Flow D: open bundled example from Welcome or Project Home → assert authoritative Workbench and valid resume identity.
- [ ] Run keyboard traversal and axe with zero serious/critical violations on stable Workbench switcher, Templates, Recycle, Search, Insights, and lifecycle dialogs.
- [ ] Assert no viewport-level horizontal overflow at 1250x744 and one wider representative viewport; use numeric geometry tolerance where required.
- [ ] Keep P1 test identities isolated so destructive flows do not invalidate later assertions.
- [ ] Update and run P0 E2E against the one-item batch-import UI; preserve create/import/edit/confirm/TM/QA/export/resume/Home Open outcomes.
- [ ] Avoid mocking `DesktopApi.invoke` or the Engine in E2E.

**Validation**

```bash
pnpm build:desktop
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p1-project-lifecycle.spec.ts
pnpm test:e2e:desktop
```

**Gate G9**

- P0 and P1 Playwright specs pass against the real Engine with isolated data, valid relaunch continuity, no console/page errors, no serious/critical axe issues, and no viewport overflow.

**Risk points:** dialog return shape, template fixture dependencies, recycle retention/purge ordering, search indexing settlement, Windows file locks, example path materialization.

**Acceptance coverage:** AC1–AC17, AC19–AC23.

---

### WP10 — Final convergence and release-quality validation

**Purpose:** prove every requirement and acceptance item and prevent scope/design drift.

**Checklist**

- [ ] Cross-check R1–R12 and AC1–AC23 against tests/runtime evidence; record manual-only evidence separately.
- [ ] Confirm P1 uses one `project.batchImport(bestEffort)` call and no renderer loop over `document.import`.
- [ ] Confirm no folder picker/recursion, archive-file actions, `analysis.*` calls, P2–P4 destinations, or dead links.
- [ ] Confirm template update preserves unexposed definition keys and built-in mutation is impossible.
- [ ] Confirm recycle is `recycle.delete/restore/purge` and active/archive is `project.setLifecycle`; no UI uses lifecycle `trash`.
- [ ] Confirm localStorage schema/key remain session-v1 identity only plus existing disposable P0 preference.
- [ ] Confirm all Engine revisions/counts/lifecycle/results are authoritative and no mutation is optimistic.
- [ ] Confirm every Workbench navigation/switch/active delete flushes before destination mutation/read.
- [ ] Confirm new icons are Phosphor and renderer has no glass/new Lucide use.
- [ ] Run focused and final commands below. Capture unrelated repository-wide baseline failures separately while proving touched paths clean.
- [ ] Run manual `pnpm dev:desktop` sequence and inspect console.

**Gate G10**

- All touched-scope/final commands pass; P0 and P1 real-Engine E2E pass; manual walk passes; no unresolved blocker/major issue remains; no scope-forbidden UI exists.

## 3. Validation command set

Run from repository root.

### Focused lifecycle units

Use actual created file names; the final set must include equivalent coverage:

```bash
pnpm --filter @translunar/desktop exec vitest run \
  src/renderer/state/session.test.ts \
  src/renderer/routes/resolveSurface.test.ts \
  src/renderer/state/save-coordinator.test.ts \
  src/renderer/state/document-navigation.test.ts \
  src/renderer/state/template-definition.test.ts \
  src/renderer/state/search-navigation.test.ts \
  src/renderer/state/analytics-view.test.ts
```

### Desktop unit/component suite

```bash
pnpm --filter @translunar/desktop test
```

### TypeScript

```bash
pnpm --filter @translunar/desktop typecheck
```

### Contracts (expected unchanged, consistency still required)

```bash
pnpm contracts:check
```

### Touched-path lint and format

```bash
pnpm exec eslint apps/desktop/src/renderer apps/desktop/tests/e2e
pnpm exec prettier --check \
  apps/desktop/src/renderer \
  apps/desktop/tests/e2e \
  .trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle
```

### Desktop build

```bash
pnpm build:desktop
```

### Focused and complete real-Engine E2E

```bash
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p0-vertical-slice.spec.ts
pnpm --filter @translunar/desktop exec playwright test tests/e2e/p1-project-lifecycle.spec.ts
pnpm test:e2e:desktop
```

### Frozen-design static audits

The first search must produce no renderer matches. The later searches require inspection: only existing appearance constants/tokens and contract/type references may remain; settings controls, forbidden method use, or future destinations fail the gate.

```bash
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
rg -n "selectSourceFolder|project\.archive\.(export|restore)|analysis\.(profile|run)" apps/desktop/src/renderer
rg -n "setLifecycle.*trash|lifecycle:.*trash" apps/desktop/src/renderer
rg -n "localStorage|SESSION_STORAGE_KEY" apps/desktop/src/renderer
```

### Final repository-required gates

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:desktop
```

### Manual real-Engine walkthrough

```bash
pnpm dev:desktop
```

Sequence:

1. launch into Welcome or Project Home; open the bundled example once and verify a real Workbench;
2. return Home, create a project, and import several supported files;
3. inspect batch diagnostics, switch documents, edit a target, and switch immediately to verify flush;
4. search imported/edited content and jump to a document/segment;
5. inspect compact project insights;
6. create/edit/use a template and import a file into the created project;
7. update project metadata, archive it, find it in Archived, and unarchive it;
8. recycle and restore a disposable document/project, then separately purge a disposable recycle entry;
9. run existing QA and gated Export on a retained valid document;
10. restart Electron/Engine and verify the final valid session resumes with no renderer console errors.

## 4. Acceptance-to-test matrix

| Acceptance | Primary unit/integration evidence | Real/manual evidence |
| --- | --- | --- |
| AC1 | document aggregation + switcher tests | P1 multi-doc Workbench E2E |
| AC2 | deferred flush/switch/session tests | edit then immediate switch E2E |
| AC3 | batch cancel/request/guard tests | multi-picker P1 E2E |
| AC4 | mixed/all-failed/refresh tests | diagnostic + selected doc E2E |
| AC5 | template CRUD/built-in/conflict tests | template lifecycle E2E |
| AC6 | create-from-template/diagnostic/session tests | template-created project E2E |
| AC7 | recycle delete + active reroute tests | disposable entity E2E |
| AC8 | list/restore/purge/confirm tests | recycle exclusion/restore/purge E2E |
| AC9 | blank/query/paging/stale tests | real search result E2E |
| AC10 | hit classifier/hydrate/failure tests | search segment jump E2E |
| AC11 | analytics formatting/availability/no-analysis tests | real insights E2E |
| AC12 | example result/hydrate/session tests | real example materialization E2E |
| AC13 | complete update/config/conflict tests | project edit E2E |
| AC14 | active/archive lifecycle tests | archive/unarchive E2E |
| AC15 | chrome/App semantic navigation tests | keyboard traversal E2E |
| AC16 | deferred stale/duplicate/authority tests | no console/domain inconsistency E2E |
| AC17 | role/focus/dialog/axe/overflow tests | axe + compact viewport E2E/manual |
| AC18 | complete P0 unit/integration suite | P0 E2E + reconnect manual |
| AC19 | P0 IME/save/TM/edit tests + one-item batch | P0 E2E + manual IME |
| AC20 | P0 QA/gate/export ordering tests | P0 real export E2E |
| AC21 | session write/clear timing tests | relaunch after P1 navigation E2E |
| AC22 | command set | final logs |
| AC23 | N/A | complete `pnpm dev:desktop` walkthrough |

## 5. Stop/escalation conditions

Report to the Orchestrator instead of broadening implementation when any of these is proven:

- a required P1 generated method cannot be invoked through the current `DesktopApi` typing/exposure;
- `project.batchImport` cannot represent picker-selected files or returns no safe way to identify/refetch successes;
- template definition cannot be updated without destructive loss despite fetch-and-merge;
- recycle entity-type/revision contracts cannot safely delete project/document from the renderer;
- example materialization cannot return/resolve a valid Engine project through the existing bridge;
- project analytics cannot provide the light in-scope projection without `analysis.*` setup;
- P1 real-Engine E2E cannot isolate data or deterministically select multiple files through existing Electron test facilities;
- a required change would alter Engine schema, generated protocol, main/preload surface, or session persistence version.

A blocker report must cite exact files/types/runtime evidence and the smallest required decision. Implementation should self-read focused source first; no broad research is planned.

## 6. Definition of implementation complete

Implementation is complete when gates G0–G10 pass, every S9–S16 operation has complete success/loading/cancel/error/conflict/stale behavior, all save/session/Engine-authority invariants hold, P0 S0–S8 remains green, both focused and full real-Engine E2E pass, and no P2–P4 or dead destination appears. Scope may be reduced only by removing an explicitly out-of-scope feature, never by leaving an in-scope path unsafe, inaccessible, fake, or untested.
