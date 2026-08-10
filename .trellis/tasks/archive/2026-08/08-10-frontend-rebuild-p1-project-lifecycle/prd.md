# Frontend rebuild P1 — Project lifecycle and discoverability

## Status

- Phase: planning
- Priority: P1
- Active task: `.trellis/tasks/08-10-frontend-rebuild-p1-project-lifecycle`
- Target branch: `task/08-10-frontend-rebuild-p1-project-lifecycle`
- Base branch: `refactor/frontend-3`
- Program order: P0 complete; P1 precedes P2, P3, and P4

## Problem

P0 restored a safe, Engine-authoritative single-document CAT workflow, but an existing project with several files still opens through a first-document fallback and the rebuilt shell does not expose the already-available lifecycle contracts. Users cannot deliberately switch documents, import a batch, reuse project defaults, recover deleted work, search across projects, inspect project progress, open the bundled example, or update/archive projects from the rebuilt frontend.

P1 must make those capabilities discoverable without weakening the P0 boot, recovery, editing, QA, export, resume, reconnect, IME, or save-ordering contracts.

## Goal

Deliver one coherent project-lifecycle slice in which users can:

1. switch safely among documents in a project;
2. add multiple source files with complete per-file results;
3. create, edit, delete, and use project templates;
4. move projects/documents to recycle, restore them, and explicitly purge them;
5. search active projects and jump to an authoritative project/document/segment;
6. inspect concise Engine-backed project insights;
7. materialize and open the bundled example project;
8. edit project metadata and archive/unarchive a project;
9. continue to use every P0 S0–S8 path without regression.

Every retained path must include loading, success, cancellation where applicable, typed failure, keyboard access, stale-response protection, and test evidence. P1 contains no dead destinations or roadmap placeholders.

## Product principles

- The Engine owns projects, documents, templates, recycle entries, search hits, analytics, revisions, lifecycle state, segments, QA, and export eligibility. React renders returned facts and owns only transient interaction state.
- Every transition away from an editable Workbench context uses the existing `SaveCoordinator.flush()` boundary. A failed flush preserves the current document, draft, focus, and surface.
- A document/session identity is persisted only after authoritative project/document/segment hydration succeeds. Session storage remains version 1 and identity-only.
- Domain mutations are never optimistic. The affected Engine projection is refreshed or replaced from a successful Engine response before success is rendered.
- P0 appearance locks remain: light default, advanced-brown interaction accent, solid surfaces, restrained motion, Phosphor icons, and no glass or `backdrop-filter`.
- UI labels are concise and functional. No filler subtitle, guiding microcopy, future-feature link, or disabled placeholder is added.
- The Workbench remains the densest and primary surface. Insights use compact rows/tables and do not become a marketing dashboard or bento layout.

## In-scope surfaces

| ID | Surface | Required outcome |
| --- | --- | --- |
| S9 | Workbench document switcher | Engine-ordered project documents are discoverable in Workbench; choosing another document flushes the current draft, hydrates `segment.editor.list`, then updates the session. |
| S10 | Multi-file import | `selectSourceDocuments` feeds one canonical `project.batchImport` request in `bestEffort` mode; every selected file receives an Engine diagnostic and successful documents become available immediately. |
| S11 | Templates | Paginated template list/get, safe create/update/delete, and create-from-template are available; revision and built-in restrictions are honored. |
| S12 | Recycle bin | Users can move projects/documents to recycle, list entries, restore them, and explicitly purge them using Engine methods and confirmations. |
| S13 | Global search | A real `search.global` destination searches active data and navigates project/document/segment hits through save-before-navigation and authoritative hydration. |
| S14 | Project insights (light) | `project.analytics.get` renders compact progress, document progress, productivity availability, and activity trends for a real project. |
| S15 | Example project | Welcome and Project Home expose a real `openExampleProject` action whose returned identity is revalidated and opened. |
| S16 | Project lifecycle actions | Project Home supports `project.update`, active/archived views, archive/unarchive through `project.setLifecycle`, and recycle through S12. |

## Requirements

### R1 — S9 document switching and session safety

- `SessionContext` must include an Engine-backed project document collection loaded through bounded `document.list` paging; the UI must neither silently truncate nor invent recency ordering.
- Workbench exposes a keyboard-accessible document switcher in its document/action chrome. It names the active document, identifies the current selection, and supports empty/loading/error/retry states.
- Selecting the already-active document is a no-op.
- Selecting another document first flushes the current target/journal save. On failure, no document hydration or session write occurs and the user remains in the current editor with the draft intact.
- After a successful flush, the controller validates the selected document belongs to the active project, invokes `segment.editor.list`, and enters the new Workbench only after complete hydration.
- The versioned session identity is replaced only after hydration succeeds. A failed or stale switch retains the prior session record and context.
- Pending exact-TM, confirm, QA, export, search, analytics, or older switch results cannot update a newly active document.
- When a recycled active document leaves other active documents, the next document is chosen only after a fresh Engine list; if none remain, clear the document session and route to the existing Import surface.

### R2 — S10 canonical multi-file import

- P1 uses one canonical path: `selectSourceDocuments()` followed by one `project.batchImport` call with `atomicity: "bestEffort"` and one `{ path }` item per selected file in picker order.
- Folder recursion is omitted from the P1 UI. The renderer never reads files, derives relative paths, or walks folders.
- Picker cancellation is represented by an empty path array and causes zero Engine import calls, no error, and no route change.
- Duplicate submission is prevented while picker/import is pending.
- The UI renders the authoritative `succeeded`, `failed`, and per-item status/message/document fields without converting mixed completion into all-success or all-failure.
- After any success, documents are refreshed through `document.list`. When importing into an empty project, the first successful Engine-returned document is hydrated and opened; the full import summary remains available in Workbench.
- When adding files from an existing Workbench, the active document does not change automatically. New documents become selectable after refresh and the full import summary remains visible until dismissed or superseded.
- If all items fail, the current surface/session remains unchanged, diagnostics remain actionable, and retry starts a new picker/import operation.

### R3 — S11 templates

- A real Templates destination is discoverable from Project Home and lists `project.template.list` results with deterministic paging, loading, empty, and typed error states.
- Selecting a template invokes `project.template.get` for its current/referenced revision before edit or use.
- P1 template forms support `name`, `description`, `sourceLocale`, `targetLocale`, and `domain`. Create encodes those project defaults into the existing `definition` object.
- Update preserves unknown keys from the fetched definition while replacing only P1-owned keys, and sends the exact fetched `expectedRevision`. The renderer must not erase unexposed references/defaults.
- Built-in templates can be viewed and used but cannot expose update/delete actions.
- Custom template create/update success is followed by an authoritative list/get refresh; revision conflict or validation failure preserves form values and shows the typed Engine error.
- Delete requires explicit confirmation, sends the selected custom template revision, and refreshes the list only after success.
- Create-from-template sends template ID/revision, a validated project name, and user-visible locale/domain overrides where needed. The returned project and dependency diagnostics are rendered from the Engine.
- A created project does not create a resumable session until it has a usable document. Create-from-template routes to the multi-file Import surface; diagnostics remain visible there.
- Template UI never requests or stores credentials and does not expose P2–P4 asset, AI, plugin, or settings administration.

### R4 — S12 recycle lifecycle

- Project Home can move an active/archived project to recycle through `recycle.delete` with Engine revision, entity type, and a required non-empty reason.
- The Workbench document switcher can move a document to recycle through the same contract after flushing if the document is active.
- A Recycle destination lists `recycle.list` results with deterministic paging and shows Engine display name, entity type, deletion time, retention time, and reason.
- Restore invokes `recycle.restore` only after explicit confirmation. Purge invokes `recycle.purge` only after a separate permanent-action confirmation. Repeated activation cannot duplicate either mutation.
- Restore/purge success refreshes recycle and relevant project/document projections. Failure keeps the entry visible with an associated typed error.
- Recycled data does not appear in normal Project Home or default global search results. Recycle is the only P1 surface that deliberately shows recycle entries.
- Deleting the active document or current project cannot leave a dangling stored session. Re-route from fresh Engine data only after the delete succeeds.
- No renderer-side retention countdown, restore eligibility, or purge result is fabricated.

### R5 — S13 global search and navigation

- App chrome exposes one real Search destination after startup; Workbench entry to Search awaits `SaveCoordinator.flush()`.
- Search submits a trimmed non-empty query to `search.global` with `includeRecycled: false`. Empty input causes no Engine request.
- Results and totals come from the Engine and support deterministic previous/next paging. The UI renders only available project, document, field, snippet, workflow, and location data.
- Results are keyed by stable Engine identity/location data, never array position alone.
- Activating a document/segment hit validates project and document ownership, hydrates editor rows, verifies an optional segment ID against the returned rows, persists the resulting session, and focuses the segment only after success.
- Activating a project-only hit uses the standard open-project resolver: no documents routes to Import; otherwise an Engine-ordered document is hydrated.
- A save, validation, missing-hit, transport, or hydrate failure preserves the search results/query and does not claim navigation success.
- Results from an older query/page or prior Engine generation are ignored.

### R6 — S14 compact project insights

- Insights are available from an active Workbench session and from a Project Home project action; Workbench entry awaits pending-save flush.
- The surface invokes only `project.analytics.get` for P1. It does not add `analysis.*` workflows.
- Render project progress, per-document progress, QA blockers, productivity metrics/availability, and trend buckets directly from `ProjectAnalyticsSummary`.
- Basis points, durations, and timestamps may be formatted for presentation, but counts/availability and trend values cannot be estimated or recomputed from visible segments.
- An unavailable optional metric is labelled unavailable using Engine availability/reason data; it is never rendered as a fabricated zero.
- Layout uses compact headings, rows, tables, and a restrained trend visualization with an accessible text/table equivalent. It must not use a tile/bento marketing composition.
- Loading, empty-trend, retryable error, and stale-response behavior are explicit. Returning to a prior Workbench revalidates/hydrates the session.
- AI contribution and asset-health administration are not surfaced in P1 even if fields are present in the analytics result.

### R7 — S15 bundled example project

- Welcome and Project Home expose a concise Open example action backed only by `openExampleProject()`.
- Duplicate activation is prevented while the shell action and subsequent hydration are pending.
- On `{ ok: true }`, returned project/document IDs are treated as candidates, not trusted snapshots. The controller validates through Engine RPC and hydrates segments before writing session identity or entering Workbench.
- If a successful shell result omits a document ID, the standard `document.list` resolver chooses an Engine-returned document or routes an empty example project to Import.
- `{ ok: false }`, malformed success identity, transport failure, or hydrate failure remains on the originating surface with the returned/typed error and a retryable action.
- The example action neither creates fake renderer data nor adds tutorial/settings scope.

### R8 — S16 project metadata and active/archive lifecycle

- Project Home has active and archived Engine-backed views using `project.list` lifecycle filters. Switching views replaces the list from Engine data.
- Edit loads the current project and submits the complete required `project.update` request: project ID, exact expected revision, name, source locale, target locale, domain, and the unchanged configuration unless the form explicitly owns a P1 field.
- Form validation checks required non-empty values and prevents duplicate submit; Engine domain policy remains authoritative.
- Archive invokes `project.setLifecycle` with `lifecycle: "archived"` and the exact current revision. Unarchive uses `lifecycle: "active"`.
- Lifecycle and update successes refresh the affected list/project context. Conflicts and other failures keep the dialog/action context and display the typed Engine error.
- Moving to recycle uses R4 rather than treating `project.setLifecycle("trash")` as an interchangeable UI path.
- Project archive file export/restore is omitted from P1.

### R9 — Routing, chrome, and discoverability

- Extend the existing discriminated surface state with real `templates`, `recycle`, `search`, and `insights` variants; do not add a URL router or third-party global store.
- App chrome contains only implemented destinations. Home and Search are global after hydration; Workbench, QA, Export, and Insights appear only when a valid session/project context makes them functional.
- Project Home exposes Projects, Templates, and Recycle as real, labelled destinations. Search remains available through chrome and project actions where useful.
- Workbench document/add-file controls belong in the document/action chrome, not in a global settings area.
- Current destination uses semantic current-state indication; icon-only controls use Phosphor plus accessible names and visible tooltips/titles.
- Navigating from Workbench to Home, Search, Insights, QA, Export, another document, or an active-document destructive action must share one save-before-transition command boundary.
- No destination exists for P2–P4 scope.

### R10 — Engine authority, concurrency, and error behavior

- Use generated `EngineParams`/`EngineResult` relationships through the existing `lib/rpc.ts`; do not create duplicate domain interfaces or stringly typed unregistered methods.
- Main, preload, and Engine need no P1 product change: the existing bridge already exposes `selectSourceDocuments` and `openExampleProject`, and generic `invoke` covers the P1 Engine ledger.
- Every async command has an operation/generation identity. Late list, search, analytics, template, recycle, switch, import, or example responses cannot replace a newer surface/session.
- Cancellation never produces an error banner or follow-on mutation. Domain/transport failures preserve actionable context.
- Mutation buttons are guarded in both UI state and command code. UI disabling alone is not the invariant.
- After reconnect, context-bearing P1 surfaces revalidate the relevant project/session and refresh their projection before mutations are enabled.

### R11 — Visual and accessibility quality

- Reuse `tokens.css`/`styles.css`; use solid light surfaces, advanced-brown interaction states, independent semantic colors, Phosphor icons, and no glass material.
- Dense project/document/result data uses semantic lists or tables with responsive wrapping and no horizontal viewport overflow at the supported compact desktop size.
- All fields have programmatic labels; dialogs trap/restore focus as appropriate; destructive dialogs default focus to Cancel; Escape never confirms an action.
- Busy/error/status changes have textual or live-region communication and do not rely on color alone.
- Search results, document options, project actions, template actions, recycle actions, and insight navigation are keyboard reachable with visible focus.
- Motion is restrained and honors `prefers-reduced-motion`.

### R12 — Test and regression coverage

- Add unit coverage for document paging/switch resolution, template definition merge/guards, search hit resolution, analytics formatting/availability, and lifecycle/recycle routing decisions.
- Extend the typed `DesktopApi` fake and App/component integration coverage for every P1 method sequence, cancellation, conflict/failure retention, stale response, duplicate guard, and save-before-navigation branch.
- Add real-Engine Electron E2E for multi-file import/switch, templates/create-from-template, recycle/restore/purge, search jump, insights, example project, update/archive/unarchive, and relaunch/session continuity.
- Keep the existing P0 renderer unit suite and `tests/e2e/p0-vertical-slice.spec.ts` green.
- E2E uses isolated data and existing main-process dialog control where deterministic native selections are required; no test-only product bridge or mocked Engine is added.
- Stable P1 landmarks may use `data-testid`; ordinary assertions prefer roles, labels, names, and rendered Engine data.

## Acceptance criteria

### P1 surface acceptance

- [ ] **AC1 — S9 document list:** A multi-document project shows every reachable Engine document through bounded paging in the Workbench switcher, identifies the active document, and exposes no invented recency/order.
- [ ] **AC2 — S9 save-before-switch:** With a dirty target, selecting another document calls the save flush before document/segment hydration. Forced save failure makes zero switch hydration/session writes and preserves the original editor/draft; success hydrates the chosen document and persists its identity.
- [ ] **AC3 — S10 canonical batch import:** File picker cancellation makes zero `project.batchImport` calls. A non-empty selection makes one `bestEffort` request whose items preserve selected paths/order, blocks duplicates while pending, and renders all Engine diagnostics.
- [ ] **AC4 — S10 partial and successful outcomes:** Mixed success/failure is represented accurately. Documents refresh after success; initial import opens the first successful Engine document while retaining the summary; Workbench add-files retains the active document; all-failed import retains the current surface and retry path.
- [ ] **AC5 — S11 template listing and CRUD:** Template list/get paging, custom create/update/delete, built-in read/use restrictions, expected-revision conflicts, confirmation, and authoritative refresh are covered by integration tests and accessible controls.
- [ ] **AC6 — S11 create from template:** A selected template revision plus validated project name/locales/domain invokes `project.createFromTemplate`; Engine diagnostics remain visible and the new project reaches Import without a premature session write.
- [ ] **AC7 — S12 recycle delete:** Project and document recycle actions send the authoritative entity identity/revision and required reason only after confirmation. Active-context deletion flushes first and resolves the next session/Home/Import destination from fresh Engine data.
- [ ] **AC8 — S12 restore and purge:** Recycle paging renders Engine entries; restore and separately confirmed purge invoke the exact entry ID once, refresh after success, preserve the entry/error after failure, and never show recycled items in normal Home/search results.
- [ ] **AC9 — S13 search query:** Empty input performs no RPC; a valid query invokes `search.global` with recycled data excluded, renders authoritative total/hits/snippets, pages deterministically, and ignores an out-of-order earlier query.
- [ ] **AC10 — S13 search navigation:** Project-only, document, and segment hits route through standard validation/hydration. A Workbench-origin query flushes before leaving; a valid segment is focused after hydration; stale/missing/failed hits retain query/results and make no false session transition.
- [ ] **AC11 — S14 insights:** `project.analytics.get` renders compact project/document progress, QA blockers, productivity availability, and trends; unavailable metrics are not zeroed; loading/error/empty-trend states and Workbench return are complete; no `analysis.*` call or bento layout exists.
- [ ] **AC12 — S15 example:** Welcome and Project Home can call `openExampleProject` once, validate its candidate IDs through the Engine, hydrate Workbench, and persist session only after success. Shell/hydration failure remains retryable on the origin surface.
- [ ] **AC13 — S16 update:** Project edit submits the complete current project fields/configuration with exact revision, preserves form state on failure/conflict, and refreshes Engine-backed Home/context after success.
- [ ] **AC14 — S16 lifecycle:** Active and archived Home views are Engine-filtered; archive/unarchive call `project.setLifecycle` with exact revision and refresh the correct view; recycle is a distinct `recycle.delete` action; no archive file workflow is added.
- [ ] **AC15 — Real destinations:** Chrome and Home expose only implemented Home/Search/Workbench/QA/Export/Insights/Templates/Recycle destinations in valid contexts, current-state semantics are present, and every displayed destination is functional by keyboard and pointer.
- [ ] **AC16 — Authority and stale responses:** Unit/integration tests prove no optimistic project/document/template/recycle/search/analytics state, duplicate mutation, or stale response can replace a newer Engine projection/session.
- [ ] **AC17 — P1 accessibility/visual contract:** New dialogs/actions/fields/results have names and visible focus; destructive dialogs focus Cancel and never confirm on Escape; P1 stable surfaces have no serious/critical axe findings, no viewport-level horizontal overflow, no new Lucide renderer import, no glass CSS, and reduced motion is honored.

### P0 regression acceptance

- [ ] **AC18 — P0 boot/recovery/resume/reconnect:** Light-first boot, Engine status/retry/restart, multi-record draft recovery/discard, valid session resume, invalid session clearing, and generation-safe reconnect remain green.
- [ ] **AC19 — P0 create/import/edit:** Welcome/Project Home → Create → Import → Workbench remains complete using the P1 batch importer; target drafts, journal generations, IME guards (including key code 229), confirm ordering, exact TM, and focus advancement retain P0 behavior.
- [ ] **AC20 — P0 QA/export:** Workbench → QA → optional issue jump and Workbench → gated Export retain save-before-nav, real Engine projections, failed-gate zero-export behavior, picker cancellation, and successful real output.
- [ ] **AC21 — P0 session continuity:** Document switch, search jump, example open, template-created project import, and active-document recycle write/clear the unchanged session-v1 identity only after authoritative hydration; relaunch resumes the final valid document.
- [ ] **AC22 — Automated quality gates:** Focused P1 tests, the complete desktop Vitest suite, desktop TypeScript, touched-path ESLint/Prettier, desktop build, contract consistency, existing P0 E2E, new P1 real-Engine E2E, and final repository-required checks pass. Unrelated baseline failures, if any, are recorded separately and cannot mask a touched-path failure.
- [ ] **AC23 — Manual real-Engine walkthrough:** `pnpm dev:desktop` completes multi-file add/switch, template use, search jump, insights, project update/archive/unarchive, recycle/restore, example open, QA/export, and relaunch without DevTools intervention, renderer console errors, lost drafts, or dead controls.

## Out of scope

- Advanced editor operations: split/merge, find/replace, comments, spelling, or new undo UI.
- TM library administration, termbase administration, alignment, corpora, asset curation, and template controls for those later modules.
- Source re-import preview/apply and drag/drop import.
- Folder-recursive import in the P1 UI.
- PDF OCR, advanced filter configuration, interop, task packages, or project archive file export/restore.
- Plugins, AI surfaces, collaboration, cloud sync, or multi-user roles.
- Full Product Settings, backup/update/data-directory UI, install history, theme switcher, accent customization, or dark theme.
- Analytics `analysis.*` runs/profiles, AI contribution UI, asset-health administration, billing, pricing, or worker-surveillance views.
- Template credential/reference remapping UI beyond rendering Engine dependency diagnostics and accepting the P1 locale/domain overrides.
- React Bits, glass material, bento marketing dashboards, or motion-heavy presentation.
- Main/preload/Engine/protocol changes unless implementation proves an existing contract blocker and reports it before widening scope.

## Assumptions

| ID | Assumption | Confidence |
| --- | --- | --- |
| A1 | Generated contracts and `DesktopApi.invoke` already expose every P1 Engine method, while `DesktopApi` directly exposes `selectSourceDocuments` and `openExampleProject`; no bridge change is required. | High — verified in current source. |
| A2 | `project.batchImport` with `bestEffort` is the canonical P1 import path; `{ path }` items allow the Engine to own relative-path/filter decisions and diagnostics. | High — verified generated contract. |
| A3 | A successful batch diagnostic contains a `document` for each imported item, allowing deterministic first-success opening after initial import. If absent, implementation will refresh `document.list` and choose Engine order without inventing association. | Medium-high. |
| A4 | The Engine-recognized P1 template definition keys are `sourceLocale`, `targetLocale`, and `domain`; updates can object-merge those keys into the fetched unknown definition without dropping unexposed keys. | Medium-high — source-backed storage decoder, but generated protocol intentionally types definition broadly. |
| A5 | `entityType` values `project` and `document` are accepted by `recycle.delete`; exact literals must be confirmed from current Engine/storage tests during WP0. | Medium-high. |
| A6 | Actor fields are optional and the Engine provides the canonical default. P1 supplies required user reasons but does not invent identity/account settings. | High — generated fields are optional. |
| A7 | `openExampleProject` normally returns both IDs. Its optional-ID type requires a documented fallback through project validation and `document.list`. | High. |
| A8 | `project.analytics.get` can return unavailable optional metrics; compact P1 insights can be complete without invoking `analysis.*` first. | High — generated availability contracts. |
| A9 | Existing P0 `SaveCoordinator`, draft journal, session-v1, typed RPC, Electron dialog automation, Vitest, Playwright, and axe infrastructure remain the correct foundations. | High — P0 closeout is green. |
| A10 | Pagination metadata is deterministic and advances when more results exist. Helpers will guard a non-advancing/malformed page as a typed error instead of looping indefinitely. | Medium-high. |

## Success boundary

P1 is complete only when S9–S16 work together as a lifecycle flow and S0–S8 remain green. Scope is intentionally reduced by omitting folder recursion, archive files, source re-import, advanced analysis, and later administration. It is not acceptable to retain first-document ambiguity, hide partial import failures, erase unknown template fields, navigate before save, fabricate insights/search state, leave a dangling session after recycle, or expose any non-functional destination.
