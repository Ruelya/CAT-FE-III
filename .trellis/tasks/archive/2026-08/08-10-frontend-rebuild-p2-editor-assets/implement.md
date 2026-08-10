# Implement — Frontend rebuild P2 editor operations and Asset Hub

## Status

- Phase: ready for implement (`task.py start` by Orchestrator)
- Active task: `.trellis/tasks/08-10-frontend-rebuild-p2-editor-assets`
- Branch: `task/08-10-frontend-rebuild-p2-editor-assets` (from `refactor/frontend-3`)
- Source of truth: `prd.md` + `design.md` (do not invent out-of-scope surfaces)

## Implementation locks (read first)

1. **Engine authority** — durable rows, scores, revisions, diagnostics, history, mounts, findings come only from generated RPC results.
2. **Save before leave / mutate** — dirty active target → `SaveCoordinator.flush()` before editor mutations and before Assets navigation; flush failure stops the sequence.
3. **No optimistic domain state** — commit from typed results or authoritative refresh; failure retains form/panel/projection.
4. **Op tokens** — editor and per-asset-domain tokens + app generation; reconnect invalidates all pending completions.
5. **Typed boundary** — `lib/rpc.ts` / `EngineParams` / `EngineResult` / existing `DesktopApi` only; no stringly methods, no renderer FS/parse/score.
6. **Appearance and copy** — light + brown accent, solid surfaces, Phosphor only, no glass/backdrop-filter, no Lucide, no filler microcopy or dead nav.
7. **Scope lock** — no main/preload/protocol/Engine widening unless WP0 reports a documented bridge blocker and Orchestrator expands scope.
8. **Controller split** — `use-app-controller` owns surface/session/save/reconnect only; editor and assets use dedicated hooks + pure helpers.

## Package map (design §3)

| Area | Primary paths |
| --- | --- |
| Shell | `apps/desktop/src/renderer/shell/AppChrome.tsx` — real Assets destination when project session exists |
| Surfaces | `Workbench.tsx` (command/panel compose), `AssetHub.tsx` (section shell) |
| Editor UI | `workbench/EditorCommandBar.tsx`, `EditorFindReplace.tsx`, `EditorTagsPanel.tsx`, `EditorStructureDialog.tsx`, `SourceCorrectionDialog.tsx`, `SegmentCommentsPanel.tsx`, `SpellDictionaryPanel.tsx`, `ChineseConvertMenu.tsx`, `EditorHistoryPanel.tsx`, `EditorPreferencesPanel.tsx`, `ReviewQueuePanel.tsx` |
| Assets UI | `assets/*` — navigation, TM, termbase, alignment, corpora, catalog, curation, exchange dialog |
| State | `app-state.ts` (+ `assets` surface), `editor-operations.ts`, `use-editor-operations.ts`, `asset-state.ts`, `use-asset-controller.ts`, `asset-view.ts` |
| Tests | renderer unit/integration under `state/` / colocated tests; `test/fake-desktop-api.ts`; E2E `apps/desktop/tests/e2e/p2-editor-assets.spec.ts` |

Trivial leaf consolidation is allowed if ownership stays bounded (design §3).

---

## WP0 — Preconditions and bridge verification

**Goal:** Prove contracts and file-dialog boundary before building import UI paths.

### Checklist

- [ ] Confirm generated catalog still exposes all P2 methods listed in PRD R2–R8 (editor, review, TM/TB, alignment, corpus, catalog, curation, preferences).
- [ ] Inspect `selectSourceDocument` main filter: does it accept TMX/TBX/CSV/TSV?
  - If **yes** — reuse for TM/TB import without bridge change.
  - If **no** — **stop TM/TB import UI only**, report exact bridge blocker; implement all non-file asset/editor paths.
- [ ] Confirm `selectCorpusInput()` and `selectExportPath(suggestedName)` remain suitable (design §15).
- [ ] Confirm P0/P1 foundations present: `SaveCoordinator`, session-v1, feature op-token pattern, typed fake desktop API, Workbench + TargetEditor IME contract.
- [ ] Do **not** regenerate protocol or add main/preload methods in this task unless Orchestrator lifts the scope lock after a reported blocker.

### Gate WP0

- Written note in PR / implement notes: dialog reuse decision + any blocker ID.
- No product code that reads DOM `File` paths or parses asset formats in the renderer.

---

## WP1 — App surface, Assets entry/return, chrome

**Goal:** Project-scoped Asset Hub is a real navigable surface with save-before-navigation (PRD R5, design §4.1, §5.3).

### Checklist

- [ ] Extend `app-state` with `assets` surface: `projectId`, `projectName`, `returnTo: workbench | projects`, `session`, `section: tm | termbase | alignment | corpus | catalog | curation`.
- [ ] Large asset results/forms stay **out** of the global reducer (local asset controller only).
- [ ] `goAssets` from Workbench: `SaveCoordinator.flush()` → on success switch surface + default section `tm`; on failure retain Workbench/draft.
- [ ] `goAssets` from Project Home: no draft flush; requires real project selection.
- [ ] `backToWorkbench`: full session rehydration (P1 pattern) before replacing surface; do not trust asset-side cached document revisions.
- [ ] Assets entered from Home returns Home.
- [ ] `AppChrome`: enable real Assets destination only when valid; no dead/disabled marketing nav.
- [ ] Reconnect: invalidate editor + all asset op IDs; revalidate project; reload active section (design §9, §16).

### Gate WP1

- Unit/integration: flush-fail keeps Workbench; flush-success reaches Assets; return rehydrates; reconnect invalidates pending asset ops.
- Maps AC1 (nav flush), AC8 (real destination), AC16 (P0/P1 continuity).

---

## WP2 — Editor operation infrastructure

**Goal:** Shared mutation sequence, pure result apply, command registry, operation hook (PRD R1, design §5.1, §6, §7.1).

### Checklist

- [ ] Pure `editor-operations.ts`:
  - Apply `EditorMutationResult`: same project/document generation; replace rows by stable segment ID; use Engine `counts`/`focusSegmentId`; decide structural/undo refresh vs ID replace (design §6).
  - Selection guards: stable IDs only (never array index); adjacent merge eligibility presentation only.
  - Preview invalidation helpers; command availability predicates (no row, composing, dirty/flush required).
- [ ] `use-editor-operations.ts` orchestration:
  - Capture `{ appGeneration, editorOpId, documentId, selected IDs }`.
  - Target-affecting: composition block → flush if dirty → re-read authoritative revision **after** flush → invoke → verify token/generation still current → commit → reattach SaveCoordinator.
  - Busy guards on controls + command functions; cancel closes panel without Engine call (not an error).
  - Typed conflict/not_found/capability/validation/transport errors stay next to originating command.
- [ ] Typed command registry: stable UI IDs (e.g. `editor.findReplace`, `editor.comment`, `editor.undo`), labels, availability, intent callbacks — **not** RPC name masquerading.
- [ ] `EditorCommandBar`: compact frequent actions + overflow; keyboard via existing `DesktopApi.onEditorCommand()`; do not replace TargetEditor IME/confirm path.
- [ ] Wire Workbench to open panels via registry intents only.

### Gate WP2

- Unit tests: row replace, structural refresh decision, focus validation, counts authority, stale op ignore after document/segment/reconnect switch, flush fail stops RPC.
- Maps AC1, AC14 (editor tokens).

---

## WP3 — Tags, propagate, find/replace, structure, source

**Goal:** Core segment mutation panels (PRD R2 partial, design §7.2–7.4). AC2–AC4.

### Checklist

- [ ] **Tags** (`EditorTagsPanel`): read source/target tags + tagIssues from active row; edit target using Engine-returned source tag IDs; submit full `targetTags` + exact revision via `segment.tag.set`; replace row/issues from result. No pair/nesting validation in React.
- [ ] **Propagate**: confirm → `segment.propagate` with active revision → commit all returned rows/counts.
- [ ] **Find** (`EditorFindReplace`): blank query = no RPC; field/query/match options; deterministic paging from Engine; select by segment ID + field; focus row (bounded refresh if needed).
- [ ] **Replace**: `segment.replace.preview` (no write) → show before/after + counts → Apply flushes dirty → `segment.replace.apply({ preview })`; option/query/local doc change invalidates preview; stale/conflict retains preview.
- [ ] **Split/merge** (`EditorStructureDialog`): explicit selection + confirm; exact IDs/revisions; no structural text inventing; after success bounded full active-document editor list refresh.
- [ ] **Source correction** (`SourceCorrectionDialog`): reason-required; `segment.correctSource` with source text + revision; Engine rejection for unsafe rows retained as typed error.

### Gate WP3

- Fake-desktop integration: preview no-write; apply shape + conflict retention; blank find; structural refresh path; tag/propagate result apply; composition blocks mutations.
- Maps AC2, AC3, AC4.

---

## WP4 — Comments, spell/dictionary, CJK, undo/history, preferences

**Goal:** Remaining editor panels (PRD R2 remainder + R3, design §7.5–7.7). AC5–AC6.

### Checklist

- [ ] **Comments**: lazy `segment.comment.*` list/create/update/resolve/delete with comment revisions; delete uses existing ConfirmDialog; merge by stable ID; re-list after delete.
- [ ] **Spell**: `segment.spell.check` on bounded active source/target + explicit locale; show `available=false` honestly; suggestions only via normal draft edit/save (no spell mutation apply).
- [ ] **Dictionary**: `dictionary.list|add|remove`; refresh list after success; no local dictionary persistence.
- [ ] **Chinese conversion**: expose exactly the six generated `ChineseConversionProfile` values; `segment.chinese.convert` + revision; commit returned rows/tag issues.
- [ ] **Undo/redo/history**: `editor.undo|redo|history` project-scoped; enablement from last successful history result but commands remain authoritative; after undo/redo commit rows then refresh active document rows + history; no local inverse stack.
- [ ] **Preferences**: open → `editor.preferences.get`; keep full `basePreferences`; overlay P2 fields; update sends complete object; never mutate shell `APPEARANCE_THEME`/accent/localStorage; unknown theme values not silently coerced.

### Gate WP4

- Integration: comment revision guards; spell unavailable; dictionary refresh; CJK success/failure/duplicate busy; preferences full-object update + error retention; undo/redo refresh.
- Maps AC5, AC6.

---

## WP5 — Light review queue

**Goal:** One complete accept/reject panel when contracts consumable (PRD R4, design §8). AC7.

### Checklist

- [ ] `ReviewQueuePanel` (Workbench-adjacent panel, not top-level destination).
- [ ] `review.queue` pending, paged, keyed by review/segment ID.
- [ ] Accept/reject with exact `expectedSegmentRevision`; accept applies/refreshes active document rows when relevant; always refresh queue after success.
- [ ] Failure retains item + typed error.
- [ ] Do **not** expose review create/list-stats/interop/admin. If runtime contract blocked, record blocker and hide destination (no dead UI).

### Gate WP5

- Fake tests: accept/reject success refresh; failure retention; stale decision ignore.
- Maps AC7.

---

## WP6 — Asset Hub shell and shared asset controller

**Goal:** Section shell + orchestration skeleton (PRD R5, design §9, §5.2). AC8, AC14.

### Checklist

- [ ] `AssetHub.tsx` + `AssetNavigation.tsx`: semantic heading; real tablist/nav for TM | Termbases | Alignment | Corpora | Catalog | Curation only.
- [ ] Every displayed section wired (no placeholder tab).
- [ ] `asset-state.ts` / `use-asset-controller.ts`: per-section query/form/paging/pending; independent list vs mutation op IDs; project/section identity checks.
- [ ] Shared paging/status/error regions; Engine `total`/`offset`/`limit` and returned order only (no React sort/score/dedupe).
- [ ] `asset-view.ts`: presentation formatting, selection guards, safe score/timestamp/diagnostic formatting.
- [ ] Empty/loading/error/success states for each section shell before domain completeness is claimed.

### Gate WP6

- Integration: section switch resets stale list op; reconnect invalidates; project mismatch ignores late results.
- Maps AC8, AC14.

---

## WP7 — TM libraries and termbases

**Goal:** Full TM/TB daily path (PRD R6, design §10). AC9–AC10. Depends on WP0 dialog decision.

### Checklist

- [ ] **TM**: `tm.library.list` (items + mounts joined by library ID only); create; mount/unmount with exact mount revision + `AssetMountMode`; refresh after success.
- [ ] **TM search** `tm.search`: project/locale defaults from authoritative project data; user filters; Engine scores/substitutions rendered as returned.
- [ ] **Concordance** `tm.concordance` separate from search/lookupExact; render corpus hits when returned.
- [ ] **Termbases**: list/create/mount/unmount; term search; term upsert complete generated input; writable/read-only from Engine.
- [ ] **Exchange** (`AssetExchangeDialog`): import via trusted open dialog per WP0; export via `selectExportPath` + extension; cancel → idle, no Engine call; diagnostics/counts preserved; no React parse.
- [ ] Read-only/stale revision/malformed input/canceled dialog: no optimistic projection change.

### Gate WP7

- Fake: list/create/mount/unmount; search/concordance paging/stale; import/export cancel + diagnostics + conflict; read-only mutation failure.
- Maps AC9, AC10.

---

## WP8 — Alignment and corpora

**Goal:** Core alignment + corpus paths (PRD R7, design §11–12). AC11–AC12.

### Checklist

- [ ] **Alignment create**: distinct same-project source/target docs; fresh project/document revisions; bounded advanced options with protocol-safe defaults.
- [ ] **List/get**: session + link paging; confidence/evidence/status/revisions as text from Engine.
- [ ] **Update**: `setStatus` first; one explicit repartition path using only returned segment IDs (`replaceLinks`).
- [ ] **Refine**: link revisions + profile ID + reason; show `AiRun` identity/status only; bounded `alignment.session.get` refresh after completion — never claim new links from refine response alone. No AI settings UI.
- [ ] **Apply**: selected eligible links + revisions, session revision, writable TM + library revision, reason; commit inserted/duplicate counts and terminal status; block reapply on terminal session; refresh TM list.
- [ ] **Corpus**: list/import (`selectCorpusInput`)/search/remove (confirm + revision); `corpus.fromAlignment` only when selected session/links satisfy generated request; **no** reindex control.

### Gate WP8

- Fake: create/get/update/refine unavailable/success; apply terminal/duplicate; corpus cancel import/search/remove/fromAlignment guards.
- Maps AC11, AC12.

---

## WP9 — Catalog and curation

**Goal:** Catalog browse + offline-complete curation (PRD R8, design §13–14). AC13.

### Checklist

- [ ] **Catalog**: `asset.catalog.list` filters + paging; reset offset on filter change; rows by stable item ID; format quality basis points only when non-null; optional section jump only when kind/collection identity is valid (no dead Open).
- [ ] **Curation start**: selected TM library + complete controlled `CurationPolicy` form (all generated numeric fields); defaults explicit form defaults, not Engine recommendations.
- [ ] Run view from `curation.run` snapshot + `curation.run.get` by known ID; **no** invented historical run list.
- [ ] Findings: `curation.finding.list` paged; empty findings explicit even if summary exists.
- [ ] Apply selected findings + exact run/library revisions; rollback confirmed destructive; export via trusted save path + format/revisions; cancel export no Engine call.
- [ ] Provider mode: optional profile ID only if safely available; offline mode complete/default; no AI settings surface.

### Gate WP9

- Fake: catalog stale/filter/page; curation run/get/findings empty; apply/rollback/export conflict/error/success.
- Maps AC13, AC14 (curation tokens).

---

## WP10 — Accessibility, visual locks, tests, E2E, quality gates

**Goal:** AC15–AC18 and design §17–18.

### Checklist

#### A11y / visual

- [ ] Semantic names, visible focus, keyboard paths; icon-only controls have title/aria-label (Phosphor only).
- [ ] Dialogs: Cancel-first focus, trap/restore, Escape does not confirm; destructive stays mounted until success/cancel.
- [ ] Dense tables/lists; confined horizontal scroll; no viewport overflow at compact desktop widths.
- [ ] No `dangerouslySetInnerHTML`; no glass/`backdrop-filter`/`-webkit-backdrop-filter`; no new `lucide-react` in renderer.
- [ ] Live regions for busy/error where status changes matter.

#### Unit / pure (design §18.1)

- [ ] Editor result apply, command availability, asset key/mount join, alignment guards, curation policy validation, safe formatters.

#### Integration / fake (design §18.2)

- [ ] Extend `fake-desktop-api.ts` with typed defaults and deferred promises for all P2 methods used.
- [ ] Representative coverage listed in design §18.2 (flush, stale, find/replace, review, each asset family, reconnect).

#### Real-Engine E2E

- [ ] Add `apps/desktop/tests/e2e/p2-editor-assets.spec.ts` with isolated profile/disposable entities.
- [ ] Separable flows: editor mutations; TM/TB; alignment/corpus; catalog/curation/review (when seedable).
- [ ] axe / no-console / overflow / keyboard checks on stable panels and each Asset Hub section.
- [ ] Keep existing `p0-vertical-slice` and `p1-project-lifecycle` green.

#### Static / build

- [ ] Touched-path lint/format; desktop typecheck; desktop unit tests; desktop build; contract consistency if project script exists; full desktop test suite; E2E P0/P1/P2.
- [ ] Unrelated baseline failures recorded separately (do not paper over).

### Gate WP10 (definition of done)

All PRD AC1–AC18 checkboxes can be evidenced. Success boundary (prd): no placeholder sections, no token-unsafe apply, no invented scores/counts.

---

## Ordered delivery sequence

```text
WP0  bridge/contracts verify
  → WP1  assets surface + nav
  → WP2  editor infra + command bar
  → WP3  tags / find-replace / structure / source   (parallel ok after WP2)
  → WP4  comments / spell / CJK / history / prefs   (parallel ok after WP2)
  → WP5  review panel (after WP2; optional after WP3)
  → WP6  asset hub shell + controller
  → WP7  TM/TB                 (parallel ok after WP6)
  → WP8  alignment/corpus      (parallel ok after WP6)
  → WP9  catalog/curation      (after WP6; TM list helpful for curation)
  → WP10 tests + e2e + gates (incremental tests preferred per WP)
```

Prefer **tests with each WP** rather than deferring all coverage to WP10. WP10 is the integration/E2E/regression close gate.

---

## Validation commands

Run from repo root unless noted. Prefer focused filters while iterating; full suite before handoff.

### Continuous (per WP)

```bash
# Renderer unit/integration (desktop package)
pnpm --filter @translunar/desktop test

# Typecheck desktop (electron + renderer + e2e tsconfigs)
pnpm --filter @translunar/desktop typecheck

# Optional: single-file vitest while developing
pnpm --filter @translunar/desktop exec vitest run src/renderer/state/<file>.test.ts
```

### Static / visual locks

```bash
# Repo lint (touched paths + existing policy)
pnpm lint

# Glass / Lucide hard fails (renderer) — both must return no matches
rg -n "backdrop-filter|-webkit-backdrop-filter" apps/desktop/src/renderer
rg -n "lucide-react" apps/desktop/src/renderer
```

### Build

```bash
pnpm --filter @translunar/desktop build
# or
pnpm build:desktop
```

### Real-Engine Electron E2E

```bash
# Requires engine build (script wires cargo + playwright)
pnpm test:e2e:desktop
```

Ensure new `p2-editor-assets.spec.ts` is included by Playwright config (same suite as P0/P1).

### Contract / full gates (handoff)

```bash
pnpm typecheck
pnpm --filter @translunar/desktop test
pnpm test:e2e:desktop
```

If a project contract-consistency script exists, run it; otherwise rely on typecheck + generated imports.

### Manual smoke (implementer / verify)

1. Open project → Workbench: dirty target → Assets nav cancels leave and keeps draft when flush fails.
2. Tags / find / replace preview-apply / one structural op on disposable doc.
3. Asset Hub each tab: loading → empty or data → one mutation success + one cancel dialog.
4. Reconnect mid-list: no cross-project overwrite; mutations re-enable after hydrate.
5. Preferences change does not alter shell chrome theme/accent.

---

## Risk checkpoints (from design §20)

| ID | When to check | Action if hit |
| --- | --- | --- |
| D-R1 | WP0 / WP7 import | Report bridge blocker; ship non-file paths |
| D-R2 | WP2/WP3 structural/undo | Full active-document rehydrate when rows incomplete |
| D-R3 | Every editor mutation | Flush then re-read revision |
| D-R4 | Find/replace | Invalidate preview on local change |
| D-R5–D-R6 | WP8 | Segment IDs only; refine is not new links |
| D-R7 | WP9 | Current/get/findings only |
| D-R8 | WP4 prefs | Editor content only |
| D-R9 | All WPs | Keep hooks split from app controller |
| D-R10 | WP10 E2E | Seed via public Engine methods; split flows |
| D-R11 | WP6–WP9 | Per-domain op IDs + generation |
| D-R12 | WP6/WP10 | Dense tables, internal scroll, no bento |

---

## Out-of-scope reminders (do not implement)

- PDF OCR, interop/task packages, archive, plugins, AI credentials/settings UI, collaboration, full Product Settings, shell theme DIY, glass, React Bits, dead nav, renderer SQLite/FS/domain algorithms, full review workflow, corpus reindex control, silent main/preload/protocol changes.

## Handoff criteria for review

- [ ] All WPs checklist items done or explicitly blocked with recorded reason.
- [ ] AC1–AC18 evidenced by tests and/or real-Engine E2E.
- [ ] P0/P1 E2E still green.
- [ ] No glass/Lucide regressions; typecheck/build green.
- [ ] `implement.jsonl` / `check.jsonl` still list frontend specs used during implementation.
