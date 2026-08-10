# Design — Frontend rebuild P2 editor operations and Asset Hub

## 1. Design summary

P2 extends the shipped P0/P1 renderer in place. It keeps `App.tsx`, the reducer/controller, `SessionContext`, identity-only session-v1, `SaveCoordinator`, feature operation tokens, typed `invokeEngine`, and the Workbench grid. P2 adds two bounded product areas:

1. a compact editor command layer and focused Workbench panels;
2. one project-scoped Asset Hub with real TM, termbase, alignment, corpus, catalog, curation, and light review projections.

Durable state and all domain calculations remain in the Engine. React owns only selected IDs, open panels, forms, query options, pagination inputs, busy/error states, and presentation formatting. Every mutation commits UI state from its typed result or from an authoritative refresh.

No route library, global state package, table/grid dependency, chart dependency, renderer parser, or appearance framework is required. Existing React 19, generated contracts, `lib/rpc.ts`, Phosphor, CSS tokens, Testing Library/Vitest, Playwright, and real Engine E2E are sufficient.

## 2. Evidence and fixed constraints

Current source establishes:

- `surfaces/Workbench.tsx` composes `SegmentGrid`, exact TM, document switching, P1 actions, and typed command callbacks.
- `workbench/TargetEditor.tsx` is a controlled textarea with IME and 229 guards; this contract must remain unchanged for normal target typing.
- `state/use-app-controller.ts` owns Engine hydration, save/navigation sequencing, operation generation, session commits, and current Workbench replacement.
- `state/app-state.ts` is the discriminated app surface model; session context contains complete Engine-ordered project documents and editor rows.
- P1 has per-feature operation tokens and invalidates them on reconnect.
- `DesktopApi` already exposes generic typed invoke, `selectCorpusInput()`, `selectExportPath()`, and `onEditorCommand()`.
- Generated contracts include every P2 method and complete result/param types. Editor mutations return rows/counts/focus; assets return paged and revisioned projections.
- P0/P1 closeouts are green and their specs are durable regression contracts.

Inherited locks:

- light default, advanced brown, solid surfaces, Phosphor, restrained/reduced motion, no glass;
- no filler/guiding copy or dead navigation;
- Engine authority and typed errors;
- save-before-navigation and identity-only session persistence;
- IME-safe editing and reconnect hydration;
- complete quality for every displayed P2 feature.

## 3. Proposed source boundaries

The exact split may consolidate trivial leaves, but ownership must remain bounded:

```text
apps/desktop/src/renderer/
  App.tsx
  styles.css
  shell/
    AppChrome.tsx                    # add only real Assets destination
  surfaces/
    Workbench.tsx                    # compact editor command/panel composition
    AssetHub.tsx                     # project-scoped section shell
  workbench/
    EditorCommandBar.tsx
    EditorFindReplace.tsx
    EditorTagsPanel.tsx
    EditorStructureDialog.tsx
    SourceCorrectionDialog.tsx
    SegmentCommentsPanel.tsx
    SpellDictionaryPanel.tsx
    ChineseConvertMenu.tsx
    EditorHistoryPanel.tsx
    EditorPreferencesPanel.tsx
    ReviewQueuePanel.tsx
  assets/
    AssetNavigation.tsx
    TmLibrariesPanel.tsx
    TermbasesPanel.tsx
    AlignmentPanel.tsx
    CorporaPanel.tsx
    AssetCatalogPanel.tsx
    CurationPanel.tsx
    AssetExchangeDialog.tsx
  state/
    app-state.ts
    use-app-controller.ts            # app/session/save boundaries only
    editor-operations.ts             # pure command/result helpers
    use-editor-operations.ts         # editor operation orchestration
    asset-state.ts                   # discriminated local asset states/reducers
    use-asset-controller.ts          # project-scoped asset orchestration
    asset-view.ts                    # presentation formatting/selection guards
  test/
    fake-desktop-api.ts
apps/desktop/tests/e2e/
  p0-vertical-slice.spec.ts
  p1-project-lifecycle.spec.ts
  p2-editor-assets.spec.ts
```

Boundary table:

| Boundary | Owns | Must not own |
| --- | --- | --- |
| App reducer/controller | Surface, session identity/hydration, shared Workbench flush, reconnect generation, Assets entry/return | Asset forms, curation policy state, TM scoring, alignment partitions |
| Editor operation hook/controller | Active-row command sequences, operation tokens, Engine result application, panel error/pending state | JSX details, local inverse operations, tag validation, structural text rules |
| Asset controller | Section query/form/paging, revision-aware mutation sequences, refresh-after-success | Filesystem parsing, matching/scoring, alignment algorithm, durable caches |
| Pure helpers | Result merge/replace by stable ID, preview/selection guards, formatting | RPC, storage, React effects, domain derivation |
| Presentational panels | Semantic layout, controlled values, intent callbacks | Direct `window.translunar`, session writes, business decisions |

The already-large app controller should not absorb all P2 local states. It provides a small gateway for `goAssets`, `backToWorkbench`, and authoritative Workbench row replacement. Editor and asset hooks call the same typed RPC adapter and accept app generation/session references explicitly.

## 4. Surface and state model

### 4.1 App surface

Add one app surface:

```text
assets {
  projectId
  projectName
  returnTo: workbench | projects
  session: SessionIdentity | null
  section: tm | termbase | alignment | corpus | catalog | curation
}
```

Large asset results and forms stay in `useAssetController`, not in the global reducer. The surface stores only route identity/return context. This keeps app state serializable enough for reducer tests and prevents `app-state.ts` from becoming a duplicate database.

Review remains a panel within Workbench/Assets context rather than a top-level destination. Editor panels are Workbench overlays/docks and do not change app surface.

### 4.2 Local discriminated states

Representative finite states:

- editor panel: `closed | loading | ready | applying | error`;
- find/replace: `find | preview | applying` plus committed preview and query options;
- TM/TB exchange: `idle | choosing | importing|exporting | result | error`;
- alignment: `sessions | session | creating | updating | refining | applying`;
- curation: `library | running | run | applying | rollingBack | exporting`;
- review queue: `loading | ready | deciding | error`.

Each state retains the relevant authoritative projection on mutation failure. It never transitions to a success status until the Engine response commits.

### 4.3 Persistence

No new renderer persistence is needed. Editor preferences are durable only through `editor.preferences.*`. Query text, selected rows, panel choice, asset tab, paging, import diagnostics, and draft forms are memory state. Shell appearance remains fixed and existing panel collapse preference remains untouched.

## 5. Shared operation contract

### 5.1 Workbench editor mutation sequence

```text
intent(command, segment selection)
  -> capture { appGeneration, editorOpId, documentId, selected IDs }
  -> if active target is dirty/composing: SaveCoordinator.flush()
  -> on flush failure: retain Workbench/draft/focus; stop
  -> re-read authoritative row(s) from current state
  -> invoke generated command with exact revision(s)
  -> verify generation/op/document/selection still current
  -> apply Engine result rows/counts/focus atomically
  -> reattach SaveCoordinator to authoritative active row
  -> refresh dependent panel projection only where result does not contain it
```

Composition blocks target-affecting actions while active, including tag changes, conversion, propagation, split/merge, replace apply, source correction, undo, and redo. Read-only find/history/comment list may proceed if they do not alter target/focus, but their completion is still token-guarded.

### 5.2 Asset mutation sequence

```text
intent(section action)
  -> capture { appGeneration, sectionOpId, projectId, entity/revision }
  -> command-level duplicate guard
  -> optional main-owned file dialog
       canceled -> idle, no Engine call
  -> invoke typed Engine method
  -> verify op/project/section still current
  -> commit returned projection
  -> refresh only authoritative dependent list/get pages after success
  -> retain form/entity/error on failure
```

List and search requests use independent query op IDs so an older page/query cannot overwrite a newer one. Mutation op IDs are separate from list op IDs, allowing the current list to remain visible while an action is pending.

### 5.3 Enter/leave Asset Hub

Entering from Workbench uses the P1 save-before-transition primitive. A failed flush does not change surfaces or fire asset queries. On success, Assets loads the default TM section for the current project. Entering from Project Home has no draft flush and requires a real project selection.

Returning to Workbench calls the existing full session hydration before replacing the surface; it does not trust asset-side cached project/document revisions. Assets entered from Home returns Home.

## 6. Applying `EditorMutationResult`

A pure helper applies Engine mutations to the current Workbench context:

1. require the same project/document generation;
2. index returned rows by stable segment ID;
3. replace matching current rows;
4. for split/merge/undo/redo or any response whose IDs/order differ, perform an authoritative bounded `segment.editor.list` refresh rather than inventing ordinal placement;
5. use returned `counts` directly;
6. use returned `focusSegmentId` when present and verified; otherwise keep current focus if still present, then select the nearest Engine-ordered row after refresh;
7. attach save coordinator only after the committed row is authoritative.

For operations that affect other documents (project undo/redo or propagation), the active document is refreshed if the returned row set cannot prove completeness. No optimistic row insertion/deletion occurs.

## 7. Editor panels and method flows

### 7.1 Command registry

Create one typed command registry consumed by the command bar, keyboard listener (`DesktopApi.onEditorCommand`), and optional command palette affordance. It contains stable IDs, labels, availability predicates, and intent callbacks, but no business execution. Suggested IDs mirror method purpose (`editor.findReplace`, `editor.comment`, `editor.undo`) and do not masquerade as generated RPC names.

The compact Workbench bar shows only frequent actions plus an overflow/palette; it does not place every command as a full button. Keyboard shortcuts are displayed from Engine preferences where mapped, while the existing target confirm shortcut remains unchanged.

### 7.2 Tags and propagation

- Tags panel reads `sourceTags`, `targetTags`, and `tagIssues` from the active `SegmentEditorRow`.
- User edits target placement using source tag IDs/payload already returned; submit sends the full desired `targetTags` and exact segment revision.
- Returned rows and tag issues replace the row. React performs only presentational range constraints; Engine validates membership/pairs/order/nesting.
- Propagate is a confirmed single action. It sends active segment/revision and commits every returned row/count.

### 7.3 Find/replace

Find state separates input from committed results. Blank input makes no RPC. New query resets offset. Matches render segment ID, field, matched text, range, and revision; selecting one focuses the matching authoritative row, loading a bounded row page/refresh if needed.

Replace flow:

```text
query/options/replacement
  -> segment.replace.preview
  -> render changedSegments, replacementCount, item before/after/revision
  -> explicit Apply
  -> flush active dirty target
  -> segment.replace.apply({ preview })
  -> token/revision validation by Engine
  -> authoritative result apply/refresh
```

Changing query/options/replacement invalidates the committed preview and disables apply until a new preview succeeds.

### 7.4 Structural/source operations

- Split uses selection offsets from current text controls, converted according to the generated contract boundary; no split text is precomputed as domain output. A confirmation shows selected offsets and source/target snippets as current data only.
- Merge requires two adjacent Engine-ordered rows selected explicitly and sends both IDs/revisions. Eligibility errors remain typed.
- Source correction opens a labelled editor with required reason and current source. It sends `sourceText` and exact revision; no alternate OCR path is added. Unsafe workflow states remain Engine rejection.
- Structural results trigger complete active-document editor-row refresh because row identity/order may change.

### 7.5 Comments, spell/dictionary, Chinese conversion

Comments panel lazily lists current segment comments, supports create/edit/resolve/delete, and uses per-comment action guards/revisions. Delete uses `ConfirmDialog`. Returned comments are merged by stable ID; after delete, re-list to avoid local domain inference.

Spell uses the active text and correct project locale selected explicitly (source or target). Provider `available=false` is a valid state. Findings are display ranges/suggestions only; applying a suggestion goes through normal target draft editing and save, not a spell mutation. Dictionary add/remove refreshes `dictionary.list` after success.

Chinese conversion exposes exactly the six generated `ChineseConversionProfile` values with concise labels. It is a target mutation using the active row revision and Engine result.

### 7.6 Undo/redo/history

History is project-scoped and paged via `editor.history`. Undo/redo buttons derive enabled state from the most recent successful history result, but command calls remain authoritative and may reject stale state. After undo/redo, commit returned rows/counts then refresh active document rows and history. A new mutation refreshes the history capability when the panel is open.

No renderer keyboard stack or inverse payload is stored.

### 7.7 Preferences

Preferences form starts only from `editor.preferences.get`. Keep the entire returned object as `basePreferences`, overlay controlled P2 fields, and send the complete object on update. The current contract supports zoom, editor theme string, show-nonprinting, autocomplete, CJK spacing, punctuation assistance, and shortcuts.

The editor theme field applies only to editor content where the Engine-defined value is supported. It must not modify global `APPEARANCE_THEME`, accent tokens, shell localStorage, or initial color scheme. Unknown/unsupported values remain visible/readable and are not silently coerced before Engine validation.

## 8. Review queue panel

Decision: include the light queue because generated contracts are already present and fit one panel.

Flow:

- `review.queue({ projectId, documentId?, status: "pending", offset, limit })`;
- render document name, segment ordinal, author, reason, before/proposed source/target/tag differences as text/structured tags;
- Accept: `review.accept({ reviewId, expectedSegmentRevision })` returning `EditorMutationResult`;
- Reject: `review.reject(...)` returning `ReviewRevision`;
- after either success, refresh queue; after accept, also refresh/apply active document rows when relevant;
- failure retains item and associated error.

`review.list`, `review.create`, `review.stats`, interop review files, and reviewer configuration are not required for this light panel.

## 9. Asset Hub shell

Asset Hub uses one semantic heading and a labelled tablist/section navigation. Sections are functional only: TM, Termbases, Alignment, Corpora, Catalog, Curation. Project identity stays visible. Dense tables share paging controls and status/error regions, but each controller owns its method-specific state.

The section URL is not persisted. A reconnect revalidates the project and reloads the active section, invalidating all in-flight operations before mutations re-enable.

## 10. TM and termbase design

### 10.1 TM libraries

List calls `tm.library.list({ projectId, offset, limit })`, preserving `items` and `mounts` as separate Engine projections. Rows join mount display by stable library ID only. Create fields follow generated params. Mount/unmount use exact mount revision and generated `AssetMountMode`; list refresh occurs after success.

Search uses `tm.search`, with project/source/target locales defaulted from authoritative project data and user-controlled query/threshold/library/origin/domain filters. Render `kind`, Engine `score`, substitutions, library, and unit provenance without recomputation.

Concordance uses `tm.concordance` for broader bilingual lookup. The exact generated result is rendered, including corpus hits when returned. It is not aliased to `tm.search` or `tm.lookupExact`.

Import/export use a shared exchange dialog:

- source uses an existing trusted open-file selector. Because no generic asset input method exists, P2 may use `selectSourceDocument()` for TMX/CSV/TSV/TBX input only if its main filter already permits these types. Current evidence suggests that filter is document-oriented, so implementation must first verify it. If it does not permit asset formats, report a bridge blocker rather than reading a dropped/file path in React or widening main/preload silently.
- output uses `selectExportPath(suggestedName)` with a correct suggested extension; the existing main save dialog derives filters from extension.
- cancellation returns idle; diagnostics/results remain visible after Engine completion.

This is the one implementation risk that may affect import UI while leaving all non-file TM/TB functionality implementable.

### 10.2 Termbases

List/create/mount/unmount mirror TM boundaries and use `TermbaseMount.revision`. Term search sends project/text/selected termbases and renders spans, source term, entries, translations, preferred/forbidden flags. Upsert owns a controlled entry/translation form and sends the complete generated input; the returned entry is authoritative.

TB import/export uses the same trusted file-boundary rule as TM. Writable/read-only state is displayed from Engine and mutation failures do not alter it optimistically.

## 11. Alignment design

### 11.1 Create/list/get

Create uses project documents already available through bounded P1 document paging, plus fresh `project.get`/`document.get` revisions at submit. Source and target must be distinct; Engine decides deeper eligibility. Keep generated bounded options behind an Advanced expander with current defaults loaded from form constants grounded in protocol-safe values; ordinary users choose documents and reason.

List and get page sessions/links. Session detail displays stable link groups, confidence basis points, evidence, origin, status, and revisions. Text remains plain text.

### 11.2 Update/refine

The generated mutation is tagged:

- `setStatus` for selected link expected revisions/status;
- `replaceLinks` for a selected contiguous range plus complete proposed manual partitions.

UI supports status confirmation/rejection first, and one explicit link-repartition editor for the core manual update. It sends only selected existing segment IDs returned in the session; Engine validates ordering/partition.

Refine requires selected link revisions, profile ID, and reason. P2 may accept a profile ID already known by the user/current project or fetch profiles only if an existing non-settings read contract is already used elsewhere. It does not add credentials or AI configuration. The returned `AiRun` is shown as submitted/running/failed identity; because `alignment.session.refine` itself does not return updated links, the panel offers/does bounded refresh of `alignment.session.get` after completion/explicit refresh rather than claiming suggestions exist immediately.

### 11.3 Apply

Apply requires an open session, selected eligible links with revisions, current session revision, selected writable TM/library revision, and reason. Engine returns inserted/duplicate counts, TM IDs, library/session revisions, and terminal status. The panel replaces session state from this result, refreshes TM list, and prevents reapplying a terminal session.

## 12. Corpus design

- List: `corpus.list` by project/status with paging.
- Import: `selectCorpusInput()` then `corpus.import` with current project revision, explicit name/kind/locales/filter/reason. Empty selector means cancel. Diagnostics come from returned corpus.
- Search: `corpus.search` by query/side/corpus IDs with paging; render corpus, entry, match kind/side.
- Remove: confirmed `corpus.remove` with corpus ID/revision/reason, then list refresh.
- From alignment: session/link picker already loaded in Alignment can open a corpus form. Submit `corpus.fromAlignment` with exact project/session/link revisions/name/reason. The action is shown only for non-empty selected links in a valid project session.

`corpus.reindex` is omitted from the P2 surface because list/import/search/remove/from-alignment form a complete daily path and reindex was not requested. No disabled reindex control appears.

## 13. Catalog design

`asset.catalog.list` is a cross-collection read-only table with controlled query, kind, project, locales, domain, origin, and created-date filters from generated params. A new filter/query resets offset. Rows are stable by asset item ID and show only returned fields. Quality score basis points may be formatted as a percent; no quality value is calculated when null.

Activating a catalog row may switch to its owning TM/TB/corpus section only when kind/collection identity provides a valid destination. Otherwise it remains a read-only detail row. No dead “Open” button is shown.

## 14. Curation design

### 14.1 Run and findings

Curation starts from a selected TM library. Because `curation.run` requires a complete `CurationPolicy`, define a validated controlled form with all generated numeric fields and optional created bounds. Defaults are explicit form defaults, submitted visibly, and never presented as Engine recommendations.

`curation.run` returns a `CurationRunSnapshot`; the current run view renders run status/mode/revision, summary, units, drift groups, term candidates, and pagination. Since there is no run-list method, P2 offers current/new run inspection plus retrieval by known run ID via `curation.run.get`. It does not label that as a historical run list.

`curation.finding.list` pages findings. Empty `items/total=0` is rendered as an empty findings state even when run summary exists.

### 14.2 Apply/rollback/export

Apply sends selected finding IDs, exact run/library revisions, and reason. Rollback is a separate destructive confirmation with exact revisions. Results replace run/library revisions/status and trigger run/finding/library refresh.

Export sends exact revisions, format, optional score threshold, and a trusted save path. Result shows path, format, rows, bytes, SHA-256, and revisions. Cancel performs no Engine call; failed export retains run and form.

Provider curation mode may expose `providerProfileId` only as an optional ID input/read-only selector if profiles are already safely available. Offline mode is complete and default. No AI settings are added.

## 15. File-dialog boundary

Known bridge capabilities:

- corpus input: `selectCorpusInput()` — suitable;
- output: `selectExportPath(suggestedName)` — suitable by suggested extension;
- TM/TB input: no clearly generic asset selector in `DesktopApi`.

Implementation first inspects the current `selectSourceDocument` main filter. If it accepts TMX/TBX/CSV/TSV, reuse it without bridge change. If not, the task must report that exact blocker before changing main/preload because the P2 scope lock forbids silent cross-layer widening. Under no condition may the renderer read filesystem paths from DOM files, parse asset formats, or bypass trusted dialogs.

This is an implementation verification point, not an external research question.

## 16. Error, cancellation, conflict, and reconnect policy

- Dirty active segment: flush before target-affecting command or Assets navigation; failure stops sequence.
- Revision/token conflict: preserve panel/form/preview and current authoritative projection; explicit refresh/retry only.
- File cancellation: no Engine call, no error, no projection change.
- Import diagnostics: preserve every returned diagnostic and inserted/skipped count; do not collapse partial outcomes.
- Provider unavailable/refine failed: keep alignment/curation context and typed error; do not imply an updated session/run.
- Stale response: ignore by app generation + feature op + project/document/section identity.
- Reconnect: invalidate editor and asset operation IDs, retain draft/forms, rehydrate session/project, reload current editor rows or asset section, then enable mutation.
- Missing/recycled project/document: follow existing P1 invalid-session policy; do not clear session on transport errors.
- Conflict after a long-running curation/alignment call: retain the returned or previous snapshot as identified and require a fresh get before mutation.

## 17. Accessibility and visual behavior

- Command bar uses semantic buttons/menus and one labelled overflow; editor panels have headings and focus restoration.
- Find/replace and history use lists/tables with keyboard activation and visible selected state. Shortcuts expose `aria-keyshortcuts` where valid.
- Tag controls expose tag display text and pair/protection state in text, not color alone.
- Split/merge/source correction/apply/rollback/remove use the existing modal dialog behavior; destructive actions initially focus Cancel.
- Asset tabs use a real tablist or labelled navigation with current semantics. Data tables use table semantics where tabular, lists where row actions need responsive stacking.
- At compact desktop width, command clusters wrap and tables scroll inside labelled regions; viewport does not overflow.
- Phosphor is the only renderer icon source. CSS reuses current tokens; no glass, dark shell, gradients as filler, or marketing cards.
- Empty/loading/error copy is concise: e.g. `No findings`, `Loading libraries`, typed error. No explanatory subtitle blocks.

## 18. Test strategy

### 18.1 Pure unit tests

- editor result application: row replacement, structural refresh decision, focus validation, counts authority;
- command availability: no row, composing, dirty/flush required, adjacent merge selection, stale preview invalidation;
- stable asset keys and mount joins without sorting/domain calculation;
- alignment selection/mutation request guards and terminal apply guards;
- curation policy validation and revision update decisions;
- safe formatting for scores, basis points, timestamps, diagnostics, and unavailable values.

### 18.2 Renderer integration with typed fake

Use deferred promises and invocation recording:

- dirty flush success/failure before tag/propagate/replace/split/merge/CJK/undo/Assets;
- stale editor result after segment/document/reconnect switch;
- find paging/blank/stale, preview no-write, apply request shape/conflict retention;
- comment revisions and delete refresh; spell unavailable/dictionary refresh;
- preferences get/full-object update/error retention;
- review queue/accept/reject and active-row refresh;
- TM/TB list/create/mount/unmount/search/concordance/import/export cancel/diagnostics/conflicts;
- alignment create/get/update/refine/apply and terminal/duplicate outcomes;
- corpus import cancel/search/remove/fromAlignment;
- catalog filters/paging/stale results;
- curation run/get/findings/apply/rollback/export empty/error/conflict;
- reconnect invalidation for representative editor and each asset mutation family.

Extend `fake-desktop-api.ts` with typed method defaults and configurable/deferred results; do not use untyped cast-all mocks.

### 18.3 Real-Engine Electron E2E

Add a focused P2 spec with isolated data. Keep flows separable:

1. **Editor:** open project → edit/flush → tags or propagation → find → replace preview/apply → structural operation on disposable segments/document → comments/spell/CJK → undo/redo/history → preferences.
2. **TM/TB:** create/mount, search, term upsert/search, exchange import/export where trusted dialogs support formats, verify diagnostics/output and persistence after relaunch.
3. **Alignment/corpus:** create source/target documents/session → inspect/update link status → optional refine unavailable/success evidence → apply confirmed links to writable TM → create corpus from alignment/import → search/remove.
4. **Catalog/curation/review:** catalog finds known assets → offline curation run/findings and empty path → apply/rollback/export → queue accept/reject for prepared revision when available.
5. Run axe/no-console/overflow and keyboard focus checks on stable Workbench editor panels and each Asset Hub section.

Use disposable entities for structural edits, remove/rollback, and review decisions so one test cannot corrupt another. Existing P0 and P1 real-Engine specs remain required.

### 18.4 Static and build checks

- no `backdrop-filter`, `-webkit-backdrop-filter`, or `lucide-react` in renderer;
- no Node/Electron/fs imports in renderer;
- generated contract drift green;
- touched lint/format, desktop typecheck/tests/build;
- P0/P1 renderer suites and Electron E2E green.

## 19. Trade-offs

| Decision | Benefit | Cost / mitigation |
| --- | --- | --- |
| One Asset Hub surface with focused section controllers | Discoverable daily assets without global nav sprawl; shared project/reconnect boundary | Complex surface; keep states per section and no placeholder tabs. |
| Editor panels over Workbench replacement | Preserves proven grid, IME, save, focus, exact-TM behavior | Panel density; compact command bar, overflow, responsive confined regions. |
| Full refresh after structural/undo ambiguity | Engine-ordered correctness and simpler row invariants | Extra RPC; operation result still provides immediate counts and focus, refresh is bounded. |
| Include light review queue | Existing contracts fit one complete accept/reject panel | No create/stats/full workflow; label scope honestly. |
| Offline curation complete; provider mode optional | Daily curation works without P4 AI settings | Provider refinement is honest unavailable/ID-only where config absent. |
| No corpus reindex control | Complete requested corpus path without extra lifecycle | Reindex remains callable elsewhere/later; no dead control. |
| No invented curation run list | Matches actual catalog (`run`, `run.get`, findings) | Known-run/current-run UX instead of misleading history list. |
| Verify TM/TB file selector before implementation | Preserves trusted file boundary and scope lock | Import may reveal a bridge blocker; report before cross-layer change. |
| Engine preferences, not shell appearance | Honors generated capability without violating fixed product look | Editor theme remains content-local and Engine-validated. |

## 20. Risks and mitigations

| ID | Risk | Impact | Mitigation / gate |
| --- | --- | --- | --- |
| D-R1 | TM/TB input formats are excluded by existing open dialogs | Import UI blocked | Verify main filter first. Do not bypass renderer trust boundary; report exact bridge blocker before widening scope. |
| D-R2 | `EditorMutationResult.rows` is partial or cross-document | Stale/misordered Workbench | Stable-ID replace only when provable; bounded active-document rehydrate for structural/undo/propagation ambiguity. |
| D-R3 | Active target save changes revision before command payload | False conflict/data loss risk | Flush first, then re-read row/revision from live state; never capture revision before flush. |
| D-R4 | Replace preview becomes stale after edits | Unsafe bulk apply | Invalidate preview on option/local document change; Engine token/revision validation; retain conflict context. |
| D-R5 | Alignment manual partition UI sends invalid memberships | Failed update/confusing UX | Construct only from returned segment IDs; validate local completeness/duplicates for UX; Engine remains final validator. |
| D-R6 | Refine returns `AiRun`, not updated links | False success claim | Show run identity/status only; explicit/bounded session refresh before displaying new links. |
| D-R7 | Curation has no run-list method despite brief wording | Misleading “list runs” UI | Implement current/new run + `run.get` by known ID and findings paging; document exact contract truth. |
| D-R8 | Preferences `theme` could leak into shell appearance | Violates P0/P1 visual lock | Apply only to editor content; never change global appearance constants/tokens/storage. |
| D-R9 | P2 controller size becomes unreviewable | Regression risk | Separate editor/asset hooks and pure helpers; global controller only route/save/session coordination. |
| D-R10 | E2E fixture cannot naturally create review/curation/alignment data | Acceptance gaps | Seed through public Engine methods in isolated profile; split flows; report only hard contract blockers. |
| D-R11 | Many concurrent lists overwrite section state after reconnect | Cross-project data | Per-domain op IDs plus app generation/project/section checks; deferred integration tests. |
| D-R12 | Asset tables overflow or become a card wall | Visual/accessibility failure | Semantic dense tables/lists, internal overflow, compact breakpoints, no bento/glass. |

## 21. Rollback and compatibility

- No protocol, migration, database, main/preload, dependency, or session-storage change is planned.
- App surface addition and renderer modules can be removed to restore P1 without altering stored session identity.
- Editor/asset mutations are durable Engine operations; source rollback does not undo them. Use Engine undo/curation rollback/corpus lifecycle where applicable before product rollback.
- Preferences persist in the Engine and remain valid for clients that ignore them.
- Existing exact TM panel, normal target save/confirm, QA/export, templates/search/recycle/insights remain compatible.
- If a required method is unavailable at runtime despite generated types, stop that feature and report the capability mismatch. Do not add fake fallback data.

## 22. Design completion gate

Implementation may start because:

- every P2 scope item maps to an existing generated method and a concrete surface sequence;
- save/flush, revision, response-apply, stale-op, cancellation, reconnect, and session boundaries are explicit;
- review fits one bounded complete panel;
- curation contract truth (current/get/findings rather than invented run-list) is explicit;
- trusted file-dialog verification is identified as the only bridge risk;
- unit, integration, real-Engine E2E, static, and P0/P1 regression lanes are defined;
- no external research is needed and no later P3/P4 destination is exposed.
