# Frontend rebuild P2 — Editor operations and asset hub

## Status

- Phase: planning
- Active task: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- Target branch: `task/08-10-frontend-rebuild-p2-editor-assets`
- Base: `refactor/frontend-3`
- Program order: P0 and P1 shipped before this task

## Problem

P0 and P1 provide a safe Workbench, multi-document navigation, project lifecycle, search, templates, recycle, and compact insights. Daily translation work still stops at target editing, exact TM lookup, QA, and export. The renderer does not expose the generated Engine operations for editor maintenance, review decisions, or the asset collections that professional translators need to search, curate, align, and exchange.

P2 must add those operations without moving business rules into React, weakening save-before-navigation, inventing domain state, or exposing later plugin/AI/collaboration/settings surfaces.

## Goal

Deliver a coherent Workbench extension and project-scoped Asset Hub where users can:

1. apply common editor operations to authoritative segments and see affected rows/counts immediately from Engine responses;
2. find and preview replacements before applying them, with revision/token safety;
3. manage tags, propagation, structural split/merge, safe source correction, comments, spelling/dictionary entries, Chinese conversion, and Engine-backed undo/redo/history;
4. use editor preferences only through `editor.preferences.get|update` where the generated API supports them;
5. review queued revisions in one light accept/reject panel when the existing review contracts are available;
6. list, create, mount, unmount, search, exchange, and inspect TM libraries and termbases;
7. create, inspect, refine, update, and apply alignment sessions through the core path;
8. import, search, remove, and optionally materialize reference corpora from alignment;
9. browse the Engine asset catalog and run, inspect, apply, roll back, and export curation findings;
10. retain every P0/P1 boot, recovery, IME, save, navigation, lifecycle, search, QA, export, and session-continuity guarantee.

## Product principles and locks

- Engine authority: durable projects, documents, segments, tags, comments, spell findings, preferences, operations, review revisions, TM/TB/alignment/corpus/catalog/curation facts and revisions come from generated RPC results.
- Save before leaving: any Workbench route to Asset Hub, review, Home, Search, QA, Export, Insights, or another document uses the existing `SaveCoordinator.flush()` boundary. Editor mutations flush a dirty active target before using its current revision.
- No optimistic domain state: mutation results replace affected rows/projections; failed or conflicting operations preserve the current surface and form state.
- Typed boundary: use `lib/rpc.ts`, `EngineParams`, `EngineResult`, and the existing `DesktopApi`; do not add stringly-typed methods, duplicate contracts, SQLite access, or renderer file parsing/scoring.
- Appearance: inherit light default, advanced-brown interaction accent, solid surfaces, Phosphor icons, restrained motion, IME-safe controls, and no glass/backdrop filter.
- Copy: concise functional labels and statuses only. No filler microcopy, tutorial text, dead destinations, or future-feature placeholders.
- Preferences: editor zoom/theme/nonprinting behavior may be surfaced only as fields of the generated editor preferences contract. Shell theme/accent and full Product Settings remain out of scope.

## In-scope surfaces

| ID | Surface | Required outcome |
| --- | --- | --- |
| E1 | Workbench editor command bar | Discoverable keyboard/pointer commands for all supported editor operations without turning the grid into a toolbar wall. |
| E2 | Editor operation panels | Tags, propagate, find/replace, split/merge, source correction, comments, spell/dictionary, Chinese conversion, and undo/redo/history use typed Engine sequences and preserve focus/error context. |
| E3 | Editor preferences | Read/update Engine editor preferences with validation and authoritative refresh; no renderer-owned appearance settings. |
| E4 | Light review queue | One Workbench/project panel lists queued review revisions and permits accept/reject with exact segment revision; failures retain the queue. |
| A1 | Asset Hub shell | One functional project-scoped destination with real TM, termbase, alignment, corpus, catalog, and curation sections. Every visible section has a complete empty/loading/error/success state. |
| A2 | TM libraries | List/create/mount/unmount; search and concordance; import/export using main-owned file dialogs and Engine diagnostics. |
| A3 | Termbases | List/create/mount/unmount; term search/upsert; import/export with writable/read-only and revision errors shown honestly. |
| A4 | Alignment | Create/list/get sessions, inspect links, refine through the existing Engine contract, manually update/refine link state, and apply selected confirmed links to a writable TM. |
| A5 | Corpora | List/import/search/remove reference corpora and expose `corpus.fromAlignment` when the selected alignment result has a natural valid path. |
| A6 | Catalog | Paginated `asset.catalog.list` with kind, query, locale, origin, and domain filters supported by the generated contract. |
| A7 | Curation | Start curation, inspect the returned run and paginated findings, apply selected findings, roll back, and export with honest empty/error/conflict/diagnostic states. |

## Functional requirements

### R1 — Editor command lifecycle and selection

- Workbench keeps the existing segment grid and `TargetEditor` as the editing authority; P2 adds a compact command surface and focused panels rather than replacing IME/save behavior.
- Commands identify a stable segment ID or explicit selected segment IDs. They never use array position as a durable identity.
- A command that mutates the active segment first flushes its pending draft. If flush fails, no editor RPC follows and the active draft/focus/surface remain intact.
- Before mutation, the controller uses the latest authoritative row revision. After success, returned `EditorMutationResult.rows`, `counts`, and optional `focusSegmentId` replace affected state; the save coordinator is attached to the authoritative focused row.
- Each editor operation has a generation/op token. Late results from a previous segment, document, surface, reconnect, or command invocation cannot replace newer rows.
- Busy guards exist in both controls and command functions. Cancellation closes a panel without an Engine call; it is not shown as an error.
- Typed `conflict`, `not_found`, capability, validation, and transport failures remain visible next to the originating command and never imply success.

### R2 — Segment editing operations

- Tags sends the selected target tag structure through `segment.tag.set` and renders returned tags/issues. Source tags remain Engine-owned; the renderer does not infer tag pair validity.
- Propagate invokes `segment.propagate` with the authoritative active segment revision and renders all affected returned rows/counts.
- Find invokes `segment.find` with field/query/match options and deterministic paging. Results are selectable by segment ID and field; blank query makes no request.
- Replace preview invokes `segment.replace.preview` without writing. The UI shows before/after and affected counts from the response. Apply sends the complete returned preview/token through `segment.replace.apply`; stale token/revision failure retains the preview for retry or dismissal.
- Split and merge require explicit eligible selection and confirmation. They send exact revisions/IDs, use Engine-returned rows/counts/focus, and never renumber or combine text in React.
- Source correction is offered only through a reason-confirmed action and calls `segment.correctSource` with source text and exact revision. Confirmed/signed or otherwise unsafe rows show the typed Engine rejection; the renderer does not bypass policy.
- Comments list/create/update/resolve/delete use `segment.comment.*` with comment revisions. Resolved state, authors, timestamps, and text are rendered from Engine results.
- Spell check uses `segment.spell.check` for a bounded active source/target text and locale, showing provider availability and findings. Dictionary list/add/remove uses `dictionary.*`; no local dictionary is persisted by the renderer.
- Chinese conversion presents the supported generated profiles and calls `segment.chinese.convert` with the exact segment revision. Returned rows replace the edited row and tag issues are rendered from Engine.
- Undo/redo/history call `editor.undo`, `editor.redo`, and `editor.history` with project identity. The UI reflects `canUndo`, `canRedo`, operation metadata, and returned rows; it never creates a local inverse or fabricates history.

### R3 — Editor preferences

- On opening the preferences panel, invoke `editor.preferences.get`; loading/error states are explicit.
- Update sends the complete current `EditorPreferences` object returned by the Engine, preserving fields not edited by the P2 form.
- Zoom/theme-of-editor/nonprinting and assistance fields are shown only when supported by the generated contract. Shell appearance remains fixed light/brown and has no DIY theme/accent controls.
- Conflict or validation failure preserves form values and the last authoritative preference projection.

### R4 — Review queue

- Include a light panel if the generated `review.queue`, `review.accept`, and `review.reject` contracts remain consumable without adding a new bridge or review-import workflow.
- Queue items are Engine-paged and keyed by review ID/segment ID. Accept/reject sends the exact expected segment revision and refreshes the queue only after success.
- A failed decision retains the item and typed error. Review create, interop import/export, full review workflow, and reviewer administration remain out of scope.

### R5 — Asset Hub navigation and shared behavior

- Asset Hub is a real project-scoped surface, not a disabled nav item or a marketing dashboard. All displayed tabs/sections are implemented in this task.
- Entering Asset Hub from Workbench flushes first; failed flush retains Workbench and draft. Returning to Workbench revalidates/hydrates the current session as P1 does.
- Asset Hub sections own query/form/paging/pending state locally; the controller owns project identity, save boundaries, reconnect generation, and surface commits.
- All pages use Engine `total`, `offset`, `limit`, and returned deterministic order. React does not sort, score, deduplicate domain records, or estimate counts.
- Asset operations use independent op tokens for TM, termbase, alignment, corpus, catalog, and curation. Reconnect invalidates all pending feature completions.

### R6 — TM and termbase operations

- TM libraries support list/create/mount/unmount with exact mount/library revisions and mode/writable state from Engine.
- TM search supports query, locale, threshold, library filters, context/origin filters exposed by the generated contract, deterministic paging, and authoritative scores/substitutions. Concordance renders Engine TM/corpus hits without recomputing matches.
- TM and termbase import use one narrow trusted desktop file selector for TMX/TBX/CSV/TSV when the existing bridge has no suitable input dialog. This selector may be added across shared API, main, and preload; parsing and persistence remain Engine-owned.
- Termbases support list/create/mount/unmount, term search, term upsert with translations/status/flags, and import/export with row diagnostics and exact revisions where provided.
- Read-only mounts, unknown IDs, stale revisions, malformed exchange input, and canceled dialogs produce no optimistic changes. Import/export never reads or parses files in React.

### R7 — Alignment and corpus operations

- Alignment create validates same-project source/target document identity and sends current project/document revisions plus bounded options supported by the generated contract.
- Session list/get renders status, document pair, revisions, link paging, confidence, evidence, membership, and link status exactly as returned.
- Session update supports the generated mutation shape for manual link partition/status changes. Refine invokes the existing Engine operation with selected link revisions and provider profile identity; no AI settings/credential administration is added. Provider unavailable or invalid-result errors remain typed and retryable.
- Apply requires selected link IDs/revisions, a writable TM, current library/session revisions, and a reason. Duplicate/inserted counts and terminal session result come from Engine.
- Corpus import uses existing `selectCorpusInput`; list/search/remove use project/corpus revisions and a confirmed destructive action. `corpus.fromAlignment` is offered only when selected session/link data satisfies the generated request; otherwise the control is absent.
- Corpus search renders corpus/entry/match data and deterministic paging. No corpus text or provenance is invented.

### R8 — Catalog and curation

- Catalog list supports generated filters and paginates `asset.catalog.list`; rows show collection, kind, locale, source/target, origin, quality/curation state where returned.
- Curation starts with the selected library, current library revision, project, reason, and bounded policy form. The returned run snapshot is authoritative.
- Findings use `curation.finding.list` pages keyed by finding ID. Apply sends selected finding IDs and exact run/library revisions; rollback sends exact run/library revisions and a reason; both refresh only after success.
- Export obtains a destination path through the existing desktop dialog and invokes `curation.export` with format and exact revisions. It renders bytes/row/hash/path from Engine.
- Empty finding sets, unavailable provider mode, row-level diagnostics, conflicts, and failed export are explicit. No “clean” result is fabricated from a missing response.

### R9 — Accessibility, visual quality, and regression

- Every new control has a semantic name, visible focus, keyboard path, and status text/live-region where busy/error changes matter. Icon-only controls use Phosphor and title/aria-label.
- Dialogs use the existing modal contract: Cancel-first focus, focus trap/restore, Escape does not confirm, and destructive actions remain mounted until success/cancel.
- Dense assets use lists/tables and confined scrolling; no viewport-level horizontal overflow at supported compact desktop sizes.
- Search snippets and asset text render safely as text; no `dangerouslySetInnerHTML`, filesystem access, or domain parsing in renderer.
- P0/P1 visual static checks remain green: light-first, brown accent, no glass/backdrop filter, no Lucide renderer imports, reduced motion.

## Acceptance criteria

- [ ] **AC1 — Command safety:** Every P2 editor mutation flushes dirty active target first, uses an authoritative revision, blocks duplicate invocation, ignores stale/reconnect results, and preserves the originating draft/focus on failure.
- [ ] **AC2 — Tags and propagation:** Tag set and propagation invoke the exact generated methods and replace affected rows/counts from `EditorMutationResult`; tag validation/issues are Engine-rendered.
- [ ] **AC3 — Find/replace:** Find is blank-safe and pageable; preview performs no write; apply requires the returned preview/token and shows authoritative changed rows/counts; stale/conflict apply retains the preview.
- [ ] **AC4 — Split/merge/source:** Split, merge, and reason-confirmed source correction send exact IDs/revisions, handle unsafe/invalid responses, and never calculate structural text/revisions in React.
- [ ] **AC5 — Comments/spell/CJK:** Comment CRUD/resolve, spell availability/findings/dictionary, and Chinese conversion are accessible, typed, cancel-safe, and covered by success/failure/duplicate tests.
- [ ] **AC6 — Undo/preferences:** Undo/redo/history and editor preferences use generated Engine results, preserve unedited preference fields, and contain no shell theme/accent DIY controls.
- [ ] **AC7 — Review panel:** If contracts are available, queue/accept/reject are one complete panel with exact revision, refresh-after-success, and failure retention. If the contract is blocked, the task records the blocker and does not expose a dead review destination.
- [ ] **AC8 — Asset Hub:** Asset Hub entry/return uses save-before-navigation, all displayed sections have real loading/empty/error/success states, and no visible section is a placeholder.
- [ ] **AC9 — TM:** Library lifecycle, mount state, search, concordance, import, and export use generated contracts, typed revisions/diagnostics, deterministic paging, main-owned dialogs, and no renderer matching/parsing.
- [ ] **AC10 — Termbase:** Termbase lifecycle, mount state, search, upsert, import, and export work for writable/read-only/error cases with authoritative entries, flags, translations, diagnostics, and revisions.
- [ ] **AC11 — Alignment:** Create/list/get/update/refine/apply supports the core path with session/link paging, confidence/evidence, revision/conflict guards, honest provider errors, and TM apply results.
- [ ] **AC12 — Corpus:** List/import/search/remove work with confirmation and exact revisions; `fromAlignment` is available when the generated request can be satisfied and has no unsafe fallback.
- [ ] **AC13 — Catalog/curation:** Catalog paging/filtering and curation run/finding list/apply/rollback/export render authoritative rows, counts, states, hashes, diagnostics, and empty/error conditions without fabricated success.
- [ ] **AC14 — Async authority:** Unit/integration tests prove feature op tokens, reconnect invalidation, stale query suppression, mutation guards, and refresh-after-success for each asset domain.
- [ ] **AC15 — Accessibility/visual:** New panels/dialogs/tables pass keyboard/focus/semantic checks, have no serious/critical axe findings in stable states, no viewport overflow, no glass CSS, and no new Lucide renderer import.
- [ ] **AC16 — P0/P1 regression:** Existing boot/recovery/session/IME/SaveCoordinator/document switch/import/search/templates/recycle/insights/QA/export flows remain green, including save-before-navigation and relaunch continuity.
- [ ] **AC17 — Real Engine evidence:** Isolated Electron coverage exercises editor mutation, find/replace preview/apply, at least one structural operation, TM/TB search/import/export, alignment core path, corpus search/remove, catalog, curation, and review decisions when available, with no renderer console errors.
- [ ] **AC18 — Automated quality gates:** Focused renderer tests, full desktop tests, typecheck, touched-path lint/format, desktop build, contract consistency, existing P0/P1 E2E, and the new P2 real-Engine E2E pass; unrelated baseline failures are recorded separately.

## Out of scope

- PDF OCR UI, interop packages, task packages, archive import/export, and source re-import UI.
- Plugins, AI settings/credential administration, AI assistant/prompt UI, collaboration, cloud sync, roles, and full Product Settings.
- Shell theme/accent customization, dark theme, glass material, React Bits, dead nav, and marketing/bento asset dashboards.
- Renderer-side SQLite, filesystem reads, TM/TB/corpus parsing, matching/scoring, alignment algorithms, curation heuristics, spell dictionaries, or revision logic.
- Full review import/export, reviewer administration, discussion threads beyond the segment comment contracts, and a separate review-management product surface.
- Corpus reindex UI unless required by the existing asset surface for a complete import/search/remove path; do not expose an unimplemented control.
- New main/preload/Engine/protocol work. If a generated method or existing desktop dialog is not consumable, stop and report the exact blocker before widening scope.

## Assumptions

| ID | Assumption | Confidence |
| --- | --- | --- |
| A1 | P0/P1 renderer, `SaveCoordinator`, session-v1, operation-token pattern, generic typed RPC, `selectCorpusInput`, `selectExportPath`, and the typed desktop fake are the implementation foundations. | High — current source/spec evidence. |
| A2 | The current generated contract catalog already registers all listed P2 editor, review, TM, termbase, alignment, corpus, catalog, and curation methods. | High — verified in `protocol.generated.ts` and `contracts/src/index.ts`. |
| A3 | Existing main/preload dialogs are sufficient for corpus input and exchange output; no asset-specific bridge is needed. | High — `DesktopApi` evidence. |
| A4 | Editor mutation results return enough authoritative rows/counts to replace the affected Workbench projection; rehydration may be used after undo/redo or structural changes if a response omits a needed row. | Medium-high. |
| A5 | Alignment refine is consumed as an Engine capability with honest unavailable/provider errors; P2 adds no AI configuration surface. | Medium. |
| A6 | A generated `curation.run` result plus `curation.run.get`/`curation.finding.list` is the intended run inspection/list path; the renderer will not invent an unregistered run-list method. | High — current method catalog. |
| A7 | The current Engine accepts `projectId`/document/library/corpus revisions required by generated params and enforces writable/read-only policy. | High — generated contracts and backend specs. |
| A8 | P2 can be delivered without migrations or protocol regeneration. If not, implementation pauses and reports a cross-layer blocker rather than adding backend scope silently. | High. |

## Research needed

- None. The brief and current generated contracts/specs are sufficient for planning. Implementation should report an exact contract/bridge blocker if a runtime assumption above fails.

## Success boundary

P2 is complete only when editor operations and Asset Hub flows are real, typed, authoritative, cancellable, stale-safe, accessible, and test-backed, while P0/P1 workflows remain intact. It is not sufficient to expose buttons that only open panels, preview changes without token-safe apply, show invented asset scores/counts, or leave any displayed asset section without a complete Engine-backed path.
