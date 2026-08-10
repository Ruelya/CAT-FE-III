# Design — Frontend rebuild P1 project lifecycle and discoverability

## 1. Design summary

P1 extends the existing P0 reducer/controller renderer; it does not replace it. The renderer remains a typed projection and interaction client over `DesktopApi`, with the Engine owning every durable lifecycle/search/analytics fact.

The design adds:

- session-aware document paging and switching inside Workbench;
- one canonical multi-file importer built on `project.batchImport`;
- four real workflow destinations (`templates`, `recycle`, `search`, `insights`);
- project editing, archive/unarchive, example opening, and recycle actions from existing Home/Workbench contexts;
- focused feature controllers/helpers so `use-app-controller.ts` does not absorb all P1 form and paging mechanics.

No route library, state library, chart package, or new appearance framework is needed. Existing React, generated contracts, `lib/rpc.ts`, CSS tokens, Testing Library, Vitest, Playwright, axe, and Phosphor are sufficient.

## 2. Evidence and fixed constraints

Current source establishes:

- P0 surfaces are a discriminated union in `state/app-state.ts` and composed in `App.tsx`.
- `SessionContext` currently carries one project/document/row projection.
- `AppChrome` currently shows Home/QA/Export only for session surfaces.
- `use-app-controller.ts` owns hydration and save-before-surface transitions; `SaveCoordinator` owns draft/journal generations.
- `DesktopApi` already exposes `selectSourceDocuments()` and `openExampleProject()` and generic typed Engine invocation.
- The generated catalog already includes every P1 method in the ledger below.
- P0 closeout is green with 144 unit tests and real-Engine Playwright evidence.

Inherited locks:

- Engine authority; no optimistic domain state;
- identity-only `translunar.renderer.session.v1`;
- flush before leaving/switching/destructive active-context actions;
- IME-safe target editing and reconnect rehydration;
- light default, advanced brown, solid surfaces, Phosphor, no glass;
- concise functional labels and no dead roadmap destination;
- P0 S0–S8 tests remain required.

## 3. Proposed source boundaries

Existing files remain authoritative. P1 adds focused modules under the established layout:

```text
apps/desktop/src/renderer/
  App.tsx
  styles.css
  shell/
    AppChrome.tsx                  # real global/session destinations only
    ConfirmDialog.tsx              # reusable accessible destructive confirmation
  surfaces/
    ProjectHome.tsx               # active/archive list + project actions
    ImportDocument.tsx            # becomes canonical multi-file import surface
    Workbench.tsx                 # document/add-file chrome integration
    Templates.tsx                 # list/select/use entry
    TemplateEditor.tsx            # create/update form (may consolidate if small)
    RecycleBin.tsx
    GlobalSearch.tsx
    ProjectInsights.tsx
  workbench/
    DocumentSwitcher.tsx
    BatchImportSummary.tsx
  state/
    app-state.ts
    use-app-controller.ts         # boot/session/save transition coordinator
    lifecycle-controller.ts       # project/template/recycle commands if hook size warrants
    document-navigation.ts        # paging + pure destination/result helpers
    template-definition.ts        # unknown-preserving P1 key decode/merge
    search-navigation.ts          # pure hit destination resolution
    analytics-view.ts             # pure presentation formatting, no analytics derivation
  test/
    fake-desktop-api.ts
apps/desktop/tests/e2e/
  p0-vertical-slice.spec.ts
  p1-project-lifecycle.spec.ts
```

Exact file consolidation is allowed when a leaf is trivial, but these ownership boundaries are required:

| Boundary | Owns | Must not own |
| --- | --- | --- |
| `App` / app reducer | Current surface and session-bearing navigation state | Template/recycle form fields, search text, analytics calculations |
| Main app controller | Boot/reconnect, authoritative hydration, session persistence, shared save-before-transition | JSX, raw template definition manipulation, renderer-generated domain data |
| Feature surface/controller | Loading/paging/form/pending/error state for one P1 feature | Direct `window.translunar`, local domain persistence, cross-session save policy |
| Pure helpers | Bounded page aggregation, template merge/narrowing, hit resolution, display formatting | RPC, storage, React effects |
| Presentational leaf | Semantic rendering and intent callbacks | Engine calls and state-machine transitions |

The existing 1,492-line controller should not become a monolith with every P1 form reducer. Common session/navigation commands remain there; feature-local query/edit state should stay in its surface or a focused feature hook/controller.

## 4. Application and surface model

### 4.1 Extended discriminated union

Keep all P0 variants and add:

- `templates`
- `recycle`
- `search`
- `insights(projectId, returnContext)`

The existing `import-document` surface becomes multi-file-capable and gains optional return/diagnostic context. Workbench remains `workbench(ctx, activeSegmentId, ...)`; `SessionContext` is extended with `documents`.

Feature surfaces should own finite local states such as:

- template mode: `list | create | edit | use`;
- recycle command: `idle | confirming-delete | confirming-restore | confirming-purge | pending`;
- search: query, submitted query, page, pending/error;
- insights: loading/data/error and return context;
- project dialog: edit/archive/unarchive/recycle and pending/error.

### 4.2 Context shape

Conceptually:

```text
SessionContext
  session: { version: 1, projectId, documentId }
  project: Project
  document: Document
  documents: Document[]          # all Engine-returned active docs, bounded paging
  rows: SegmentEditorRow[]
  counts: SegmentCounts | null
```

`documents` is a presentation cache replaced from `document.list`. It is not persisted. The current `document` must be one of the returned project documents; hydration rejects cross-project candidates.

### 4.3 Chrome and discoverability

Use a compact two-level model rather than a permanent feature-heavy rail:

- **Persistent `AppChrome`:** brand/identity, Home, Search where startup is resolved; QA/Export/Insights only for a valid session/project context.
- **Project Home navigation:** labelled Projects, Templates, Recycle destinations; active/archived list view belongs to Projects.
- **Workbench action bar:** document switcher and Add files beside existing document actions.

Every chrome item is a working transition. `aria-current="page"` (or equivalent current semantics) marks a destination. Phosphor supplies all new icons. There are no controls for P2–P4.

## 5. Shared navigation contract

### 5.1 One save-before-transition boundary

Add/retain a controller primitive with this behavior:

1. Capture operation generation and current surface/session.
2. If the current surface is Workbench, call `SaveCoordinator.flush()`.
3. On flush failure, patch the Workbench transition error and return a failure result; do not run destination RPC.
4. Run the destination loader/hydrator.
5. Before committing state, verify operation generation and origin/session assumptions.
6. Write or clear session identity only at the destination's defined commit point.
7. Replace the surface atomically with the complete result.

Use it for:

- Home, Search, QA, Export, Insights;
- switch document;
- search result navigation;
- active-document recycle;
- example open when invoked from any future session-bearing context.

Project Home/Template/Recycle actions do not need a Workbench flush unless their command affects the current session; command guards still apply.

### 5.2 Stale operation domains

Use independent operation counters where independence matters:

- global session/navigation operation;
- project open/document switch;
- batch import;
- template query/mutation;
- recycle query/mutation;
- search query/page/navigation;
- analytics query;
- example open.

A new query/mutation invalidates older results in the same domain. Reconnect increments the broader app generation and invalidates all feature completions.

## 6. Document paging, switching, and import

### 6.1 Bounded document paging

Create one shared `listAllDocuments(projectId)` helper, parallel to the existing editor-row pagination helper:

1. call `document.list` with project ID, offset, and bounded limit;
2. append Engine order while deduplicating only exact repeated IDs defensively;
3. stop when collected items reach `total` or a short/empty page proves completion;
4. reject a non-advancing page/offset or a cross-project document as typed invalid Engine data;
5. never sort in React.

This helper feeds project open, session hydration, search jump, example fallback, import refresh, and the Workbench switcher.

### 6.2 Document switch flow

```text
select document B
  -> no-op if B active
  -> shared Workbench flush
  -> validate B exists in fresh/current Engine document collection
  -> document.get(B)
  -> segment.editor.list(B), bounded
  -> construct SessionContext(project, B, documents, rows, counts)
  -> persist session-v1(project, B)
  -> replace Workbench and attach SaveCoordinator to B's selected row
  -> request exact TM for current row
```

The old session and Workbench remain mounted until the destination context is ready. Switch loading can disable the switcher/action bar without replacing the editor. A failed hydrate reports an associated transition error and retains the old context/session.

### 6.3 Canonical P1 batch import

Decision: use `project.batchImport`, not repeated `document.import` calls.

Rationale:

- it is the existing purpose-built multi-file method;
- one response preserves per-file diagnostic completeness;
- Engine owns filter/relative-path behavior and best-effort semantics;
- one command is easier to guard against duplicates and stale completion.

Flow:

```text
selectSourceDocuments()
  -> []: cancel, no Engine call
  -> project.batchImport({ projectId, atomicity: "bestEffort", items: paths.map(path => ({path})) })
  -> render exact result diagnostics
  -> if succeeded > 0: fresh document.list
       empty-project origin -> choose first successful diagnostic document if valid,
                               otherwise first fresh Engine document; hydrate it
       Workbench origin     -> retain active doc, replace ctx.documents
  -> retain summary until dismissed/superseded
```

Do not expose folder selection in this task. Do not invent `relativePath`, read files, or loop one `document.import` per selection.

## 7. Templates

### 7.1 List/get/use

Templates is a Project Home destination with bounded pages. View/use first fetches `project.template.get({ templateId, revision })`, ensuring edit/use acts on an authoritative revision.

Create-from-template uses:

- selected `templateId` and `templateRevision`;
- required project `name`;
- visible locale/domain defaults decoded from definition, with user overrides;
- no dependency remap UI in P1.

The returned `diagnostics` are shown without rewriting their status. Success routes to the multi-file import surface with the returned project and diagnostics; no session is stored until a document hydrates.

### 7.2 Unknown-preserving definition handling

Generated contracts deliberately expose `definition` as `unknown`. One pure boundary helper validates only the P1-editable projection:

```text
P1TemplateDefaults = {
  sourceLocale: string
  targetLocale: string
  domain: string
}
```

Rules:

- non-object/null/array definition becomes an explicit invalid-definition state for edit, while view/use may still offer explicit locale/domain overrides;
- create writes a plain object containing the three P1 keys;
- update shallow-copies the fetched plain object and replaces only those three keys;
- unknown asset/profile/editor/reference keys survive unchanged;
- no recursive secret inspection or domain validation is duplicated in renderer; Engine validation remains authoritative.

Custom templates send fetched `expectedRevision` on update/delete. Built-in templates expose no mutation controls even though command guards also reject the action.

## 8. Recycle and project lifecycle

### 8.1 Distinct states

- `project.setLifecycle`: active ↔ archived only.
- `recycle.delete`: active/archived project or document → recycle entry.
- `recycle.restore`: recycle entry → previous safe state.
- `recycle.purge`: permanent final removal.

The UI never maps recycle to `project.setLifecycle("trash")`; this avoids two competing deletion paths.

### 8.2 Delete/restore/purge

Project/document delete confirmation collects a required concise reason and passes:

- `entityId`;
- exact Engine `entityType` (`project` or `document`, verified at WP0);
- current `expectedRevision`;
- reason.

Restore and purge use the recycle `entryId`; purge has distinct permanent-action language. All destructive dialogs:

- are true modal dialogs;
- initially focus Cancel;
- trap focus and restore it;
- do not confirm on Escape;
- guard duplicate submission in command code.

After success, refetch affected projections. Active-document delete chooses the first remaining Engine document only after fresh paging, or routes Import if none. Active-project delete clears session only after success and resolves Home from fresh lists.

### 8.3 Project update and archive views

Project Home has active and archived list filters backed by `project.list({ lifecycle })`. Project update first binds to the current Engine `Project` and submits every required field plus unchanged `configuration`. It never reconstructs configuration from a partial form.

Archive/unarchive sends the exact current revision. On conflict, retain action context and reload only when the user requests retry/refresh; do not silently replay against a newer revision.

Project archive file export/restore is deliberately omitted to keep S9–S16 coherent without adding archive dialogs and recovery diagnostics.

## 9. Search

### 9.1 Query state

The search surface owns current input separately from the last submitted query. Submit:

- trims input;
- returns locally for blank input;
- calls `search.global({ text, includeRecycled: false, offset, limit })`;
- replaces result only if query operation remains current.

Changing pages repeats the submitted query with a deterministic offset. New text submission resets offset to zero. Normal P1 UI does not expose advanced field/date/locale/status filters.

### 9.2 Search result navigation

Classify hits:

1. `segmentId` + `documentId`: hydrate project/document, verify segment in returned editor rows, focus it;
2. `documentId`: hydrate document and select its first row;
3. project-only: standard open-project resolver (fresh document list; empty → Import).

A hit with a document belonging to another project or a missing segment is stale/invalid. Keep the result screen and show a typed navigation error. Do not fall back to a different segment while claiming the requested hit was opened.

If Search is entered from Workbench, the transition to Search flushes first. Because Search then owns no draft, activating a hit only runs validation/hydration. Search retains query/results in its surface state when navigation fails.

## 10. Insights

Use only `project.analytics.get({ projectId })` with Engine defaults for idle/trend bounds unless product evidence requires explicit values.

Presentation groups:

- project progress: confirmed/draft/untranslated/reviewed/QA blockers + basis-point completion;
- document progress: compact table keyed by document ID and joined only for display names from an authoritative document list;
- productivity: active editing and throughput when `available`, otherwise unavailable/reason;
- activity: semantic table/list of trend bucket time range and Engine event counts, optionally paired with a simple CSS/SVG bar path.

The text/table representation is canonical for accessibility; any visual trend is presentational and derives one-to-one from Engine values. Formatting milliseconds/dates and converting basis points to a percentage label is presentation formatting, not analytics recomputation.

Do not display analytics result `ai` or `assets` sections in P1. Do not call `analysis.profile.*` or `analysis.run*`.

## 11. Example project

`openExampleProject()` is a shell operation returning `{ ok, projectId?, documentId?, message?, code? }`.

Flow:

1. guard duplicate invocation;
2. call shell API;
3. on `ok: false`, normalize its code/message to surface error;
4. on `ok: true`, require project ID and validate `project.get`;
5. if document ID exists, hydrate it after ownership validation;
6. if absent, fresh `document.list`: first Engine document or Import;
7. write session only after full document/segment hydration;
8. ignore stale completion after navigation/reconnect.

This avoids trusting a shell success payload as domain state.

## 12. P1 method ledger

| Capability | Method / API | Input facts used | Authoritative result / UI commit |
| --- | --- | --- | --- |
| Project documents | `document.list` | project ID, bounded offset/limit | Engine-ordered document collection in `SessionContext` |
| Document validation | `document.get` | document ID | Ownership/revision/name before hydrate |
| Segment hydration | `segment.editor.list` | document ID, paging | Workbench rows; target document session commit after completion |
| Multi-file picker | `selectSourceDocuments` | none | Path array; empty means cancellation |
| Batch import | `project.batchImport` | project ID, `bestEffort`, `{path}` items | Exact summary/diagnostics, then fresh document list |
| Template list | `project.template.list` | offset/limit | Paged authoritative templates |
| Template get | `project.template.get` | ID + optional revision | Authoritative definition/revision |
| Template create | `project.template.create` | name, description, P1 definition | Returned custom template |
| Template update | `project.template.update` | ID, expected revision, name/description, unknown-preserving definition | Returned next revision |
| Template delete | `project.template.delete` | ID + expected revision | Empty success, then list refresh |
| Project from template | `project.createFromTemplate` | template ID/revision, name, locale/domain overrides | Project + dependency diagnostics; route Import |
| Recycle list | `recycle.list` | offset/limit | Recycle entries |
| Move to recycle | `recycle.delete` | entity type/ID/revision, reason | Recycle entry, then relevant refresh/reroute |
| Restore | `recycle.restore` | entry ID, optional reason | Empty success, then recycle/Home refresh |
| Purge | `recycle.purge` | entry ID, optional reason | Empty success, then recycle refresh |
| Global search | `search.global` | trimmed text, `includeRecycled:false`, offset/limit | Paged hits and total |
| Insights | `project.analytics.get` | project ID | Progress/productivity/trends; no renderer estimation |
| Example | `openExampleProject` | none | Candidate IDs only; Engine validation/hydration before commit |
| Project read/list | `project.get`, `project.list` | project ID or lifecycle/offset/limit | Authoritative edit data and active/archive Home views |
| Project update | `project.update` | complete current required fields/config, expected revision | Returned project, then projection refresh |
| Archive/unarchive | `project.setLifecycle` | project ID, expected revision, active/archived | Returned project, then filtered list refresh |
| Save before nav | `segment.editor.updateTarget` via `SaveCoordinator.flush()` | current draft generation/revision | Required predecessor; failure blocks subsequent call |

Explicitly unused in P1: `project.archive.export`, `project.archive.restore`, `selectProjectArchive*`, `selectSourceFolder`, repeated `document.import` for multi-file, and all `analysis.*` methods.

## 13. State ownership and persistence

| State | Owner | Persistence | Rule |
| --- | --- | --- | --- |
| Project/document/template/recycle/search/analytics facts and revisions | Engine | Engine | Replace after successful reads/mutations. |
| Active project/document identity | App controller/session module | Existing localStorage session-v1 only | Validate and hydrate before write. |
| Document list in current session | `SessionContext` presentation cache | Memory | Fresh Engine paging after import/recycle/reconnect. |
| Target draft/save/composition | Existing SaveCoordinator/DraftJournal | Preload journal while pending | Unchanged P0 contract. |
| Surface and return context | App reducer | Memory | Discriminated variants, no URL storage. |
| Search text/results, template forms, dialog reason, import summary | Owning feature surface/controller | Memory | Retain on associated failure; disposable. |
| Active/archive tab, paging offsets | Owning feature surface | Memory | Query inputs only, not domain facts. |
| Appearance | Existing tokens/appearance constants | None | Fixed light/brown; no settings. |

No new localStorage key is required.

## 14. Error, cancellation, conflict, and reconnect policy

- **Picker cancellation:** empty selected files; no error and no batch call.
- **Shell example rejection:** show returned code/message; no session mutation.
- **Revision conflict:** preserve form/dialog data and current Engine projection; require explicit reload/retry.
- **Mixed batch import:** render every Engine diagnostic; do not throw away successes because one item failed.
- **Save failure:** remain on original Workbench/document and stop the sequence.
- **Invalid/stale search hit:** remain in Search with query/results and associated error.
- **Stale response:** ignore based on feature operation and app generation.
- **Reconnect:** disable mutations, keep projection/forms/draft, then:
  - session surfaces: full project/document/documents/rows rehydrate;
  - insights: revalidate project then refresh analytics;
  - search/templates/recycle/Home: refresh the active query/list;
  - dialogs close only if their referenced entity is proven unavailable; never imply mutation success.
- **Identity proven recycled/missing:** clear session only under existing invalid-session policy and resolve Home/Import from fresh Engine data.

## 15. Accessibility and visual behavior

- Document selection uses a labelled native select/menu pattern unless a custom listbox is justified and fully tested. Native semantics are preferred.
- Lists/tables use stable row identities and accessible action names including the entity name where repeated controls exist.
- Template/project forms use labelled inputs and action-associated errors.
- Destructive confirmation uses one reusable dialog contract with Cancel initial focus, focus trap/restore, and non-confirming Escape.
- Search snippets render as text; never use `dangerouslySetInnerHTML`.
- Analytics charts, if present, have a semantic table/list equivalent and do not rely on color.
- Current navigation and active document state are communicated semantically, not only by brown fill.
- Compact desktop layout wraps action clusters and confines data table overflow within labelled regions rather than overflowing the viewport.
- Existing light/brown/no-glass/reduced-motion/focus token contracts are reused without adding a theme layer.

## 16. Test strategy

### 16.1 Pure units

- document page aggregation: empty, several pages, Engine order, duplicate/non-advancing guard, cross-project rejection;
- switch destination: active no-op, valid other doc, missing candidate, session commit timing;
- template definition: unknown/null/array, decode P1 defaults, create shape, unknown-preserving update merge;
- search hit classification: project/document/segment, mismatched/missing identities;
- analytics view formatting: basis points, duration, available/unavailable metrics, empty trends;
- project/recycle destination resolution after active document/project removal.

### 16.2 Component/App integration with typed fake

Use deferred promises for ordering assertions:

- dirty save succeeds/fails before switch, Search, Insights, active document recycle;
- document list paging and late switch suppression;
- batch cancel, request shape, mixed diagnostics, all-failed, initial import open, Workbench retain-active behavior;
- template list/get/create/update/delete/use, built-in action restrictions, unknown definition preservation, revision conflict;
- recycle list/delete/restore/purge, distinct confirmations, duplicate guard, active context reroute;
- search blank/query/paging/stale results and project/document/segment navigation failure/success;
- insights loading/error/unavailable/trends and no `analysis.*` invocation;
- example false/optional IDs/hydrate failure/success and session timing;
- project update complete request/config preservation and active/archive filters;
- reconnect refresh behavior for representative P1 surfaces.

### 16.3 Real-Engine desktop E2E

Add `p1-project-lifecycle.spec.ts` while retaining P0 spec. Use isolated user data, deterministic source fixtures, and existing dialog stubbing through Electron main context rather than a product test API.

Keep flows coherent but separable for failure diagnosis:

1. **Documents/import/search/insights:** create or open project → select several source files → assert diagnostics → switch documents → edit/flush switch → search target/source → jump to segment → insights → relaunch resumes selected doc.
2. **Templates/project lifecycle:** create template → edit template → create project from template → import source → update project → archive → archived view → unarchive.
3. **Recycle:** create disposable document/project → recycle → verify absent from normal list/search → restore → recycle again → purge → verify entry absent.
4. **Example:** from Welcome or Home, open example → validate Workbench → switch/search if bundled content supports it.
5. Axe and keyboard checks on stable Templates, Recycle, Search, Insights, Project Home dialogs, and Workbench document switcher; assert no renderer console/page errors and no viewport-level overflow.

Do not force all destructive actions against the same project needed by later assertions. Use isolated fixtures/entities within the same isolated profile or separate launches.

### 16.4 P0 regression

Run the complete desktop unit suite and existing `p0-vertical-slice.spec.ts`. Its one-file picker assumptions may be updated to drive the new multi-file UI while preserving its S0–S8 outcome and real Engine evidence.

## 17. Key trade-offs

| Decision | Benefit | Cost / mitigation |
| --- | --- | --- |
| `project.batchImport` once vs repeated `document.import` | Complete per-file diagnostics, canonical Engine batch semantics, fewer partial renderer sequences | Existing P0 import component/tests must adapt; retain its single-selection outcome through a one-item batch. |
| No folder UI | Keeps file ownership and P1 acceptance focused without recursive relative-path UX | Folder import is a later explicit slice; `selectSourceFolder` remains unused. |
| Four real surfaces rather than a large tabbed “hub” monolith | Clear discriminated states, smaller ownership, direct tests | More surface variants; shared navigation/controller helpers prevent duplicated save rules. |
| Native/simple document control | Strong keyboard/AT behavior and compact density | Less custom visual flourish; correct for professional Workbench. |
| Shallow unknown-preserving template merge | P1 can safely edit locales/domain without erasing later settings | Deep nested editing deferred; fetched plain-object guard and tests are mandatory. |
| Analytics only, no `analysis.*` | Complete light insight view from an existing summary method | No run/profile UX; unavailable metrics remain honest. |
| Active/archive via `setLifecycle`, recycle via `recycle.delete` | One unambiguous UI path for each lifecycle meaning | `ProjectLifecycle` includes `trash`, but P1 intentionally does not expose that route. |
| No project archive file flow | Prevents S16 from ballooning into file portability/restore UX | Archive export/restore remains explicit later scope. |
| Retain controller plus focused feature ownership | Preserves proven P0 coordination without a new store | Requires discipline not to append all local P1 state to the 1,492-line hook. |

## 18. Risks and mitigations

| ID | Risk | Impact | Mitigation / gate |
| --- | --- | --- | --- |
| D-R1 | `project.batchImport` diagnostics omit document on a success | Initial-open ambiguity | Refresh document list; prefer valid success diagnostic doc, otherwise first fresh Engine document. Test both shapes. |
| D-R2 | Template definition is `unknown` and may contain later-feature keys | Update could corrupt templates | Fetch before edit; require plain object; shallow-copy and replace only P1 keys; unit-test preservation. |
| D-R3 | Recycle entity-type literals differ | Runtime deletion failure | Confirm exact Engine/storage acceptance in WP0; use one typed constant helper and real-Engine E2E. |
| D-R4 | Active document delete conflicts with unsaved target or stale revision | Data loss/dangling session | Flush first; use exact current revision; reroute only after success and fresh list. |
| D-R5 | Search hit references stale or recycled identity | Wrong navigation/session | Validate project/document ownership and exact segment presence; retain Search on failure. |
| D-R6 | Paged list helper loops on malformed/non-advancing response | Hang | Bound calls/offset progression and fail explicitly; pure tests. |
| D-R7 | P1 async operations race with reconnect/document switch | Cross-surface corruption | App generation + feature operation IDs; deferred integration tests. |
| D-R8 | Insights become visually sparse or marketing-like | Violates Workbench density | Compact semantic tables/rows, limited optional chart, no bento/cards wall. |
| D-R9 | Controller growth becomes unreviewable | Regression risk | Keep only shared navigation/session commands in app controller; extract pure helpers and feature-local state. |
| D-R10 | E2E destructive flow contaminates another assertion | Flaky acceptance | Isolated user data and disposable project/document identities per flow. |
| D-R11 | Example materialization result is partial or fails on packaged paths | Dead welcome action | Treat result IDs as candidates, support no-document fallback, real-Electron test false/success paths. |
| D-R12 | Existing P0 E2E targets one-document Import UI | Regression/test churn | Preserve accessible Import landmark/action and update deterministic dialog return to one-element multi-picker result. |

## 19. Rollback and compatibility

- No database migration, Engine schema, protocol generation, main IPC, preload bridge, dependency, or localStorage migration is planned.
- Session record remains v1; older P0 builds can reopen the final P1 active document because only project/document identity is stored.
- New surfaces are additive renderer state. Rollback removes P1 variants/modules and restores P0 Home/Import/Chrome behavior without touching Engine data.
- Project/template/recycle mutations are durable Engine actions and cannot be undone by reverting renderer source. Restore/unarchive must be used before rollback when operationally desired.
- Batch-imported documents remain normal Engine documents and are compatible with P0's first-document fallback.
- CSS changes reuse existing tokens; no theme migration is introduced.
- If implementation proves a required P1 contract cannot be consumed without main/preload/Engine changes, stop and report the exact blocker rather than silently broadening this task.

## 20. Design completion gate

Implementation may start when:

- S9–S16 each maps to a real surface/control and authoritative method sequence;
- the multi-file canonical choice is fixed to one `project.batchImport(bestEffort)` call;
- every Workbench exit/switch/destructive active action maps to the shared flush boundary;
- session commit/clear points are explicit;
- template unknown-field preservation and recycle path separation are explicit;
- P0 regression and P1 unit/integration/real-Engine E2E lanes are defined;
- no P2–P4 destination or dead link is present;
- no unresolved external research is required.
