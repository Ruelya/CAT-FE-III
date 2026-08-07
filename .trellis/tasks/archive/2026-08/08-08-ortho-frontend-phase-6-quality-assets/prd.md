# ORTHO Phase 6 — Quality and assets surfaces

## Goal

Deliver **expression-only** quality- and asset-class surfaces from `docs/design-ii/09-implementation.md` §期6, `docs/design-ii/screens/quality.md`, and `docs/design-ii/screens/assets.md`:

1. **QA 复核 (`qa-review`)** — three-column layout (distribution / issue list / evidence) plus **in-place target fix** without leaving the page.
2. **导出复核 (`export-review`)** — delivery **gate page** that answers can-export / why-not / what-degrades, with a visible **degradation checklist**.
3. **资产 Surface (`translation-memory` label 资产)** — five horizontal tabs: **TM · 术语 · 养护 · 对齐 · 互操作**, ORTHO restyle of `AssetCurationPanel`, `AlignmentCorpusPanel`, `InteropPanel`, plus real TM/term hubs (replace the exact-lookup stub).

Branch: `implement/ortho-frontend`. i18n: **en + zh**. Preserve QA / export / asset / term / alignment / interop Engine APIs and parent navigation contracts. No new IPC, contracts, or npm deps.

## Context (done / do not redo)

| Phase | Delivered (leave alone except surface wiring) |
| --- | --- |
| 0–1 | Shell, tokens, Band/Index/Instrument, `useViewTransition`, command palette |
| 2–4 | Workbench Masthead / Matrix / grid / Stack dual-pane / PreviewDock |
| 5 | Project home 35/65, Setup 30/70, Insights vertical tabs + panel extracts |

**Do not** rework Workbench grid/stack/preview, engine, `@translunar/contracts`, preload, or invent new Engine methods for health matrices / export formats / term CRUD if missing.

## Current baseline (evidence)

| Surface / file | Approx LOC | Today |
| --- | --- | --- |
| `QaReviewPage.tsx` | ~1,211 | Command bar + summary strip + **filter rail / issue list / detail** (not ORTHO 分布/清单/证据); ruleId as title; evidence is value chips, not source/target with spans; **no in-place fix**; profile editor modal; reviewer queue band below |
| `ExportReviewPage.tsx` | ~301 | Gate check + blocker list + override + `document.export`; **no degradation checklist**; hero/marketing copy pattern |
| `WorkbenchPages.tsx` `TranslationMemoryPage` | ~100 | Exact `tm.lookupExact` only; 34-key-era stub |
| `AssetCurationPanel.tsx` | ~1,778 | Full AC RPC flow; own CSS with **literal palette vars**; still mounted under Insights |
| `AlignmentCorpusPanel.tsx` | ~2,219 | Alignment + corpora modes; own CSS; Insights mount |
| `InteropPanel.tsx` | ~888 | Table→TM + bilingual DOCX; Insights mount |
| `TaskPackagePanel.tsx` | ~1,420 | Insights “流程”; **not** an assets tab (≤5 tabs on assets) |
| Routing | `surface-types.ts` | Six surfaces; index 4 label already **资产** (`translation-memory` id) |

Contracts already available and **must stay green**:

- QA: `qa.profile.list/clone/update`, `qa.run`, `qa.run.list`, `qa.issue.list/waive/revoke`, `qa.report.export`, `qa.gate.check`, `review.stats`, `review.queue`, plugin provenance utils
- Segment fix: `segment.updateTarget` (+ existing revision discipline)
- Export: `document.export` → `ExportDocumentResult.degradation`; workspace `Document.degradation` for pre-export list
- TM: `tm.library.list/create/mount/unmount`, `tm.lookupExact`, `tm.search` (and any already-used concordance only if Workbench already owns it — do not expand unless panel already called it)
- Terms: `termbase.list/create/mount/unmount/import/export`, `term.search`
- Curation / alignment / interop / task package: existing panel invoke sets only

Utils that stay semantic-stable: `plugin-provenance-utils.ts`, `asset-curation-utils.ts`, `alignment-corpus-utils.ts`, `workbench-utils.ts`, `i18n/*`.

## Requirements

### R1 — QA review three-column (分布 / 清单 / 证据)

- Replace the legacy command-bar + filter-rail + list + detail + bottom review-band collage with a **single primary grid**:
  - **Left (~180px)**: Live Matrix (segment → issue severity: none / warn / error / waived), severity chips with counts, rule multi-filter (human-readable labels, not raw machine IDs as sole title), scope document/project, link/action to open profile editor.
  - **Center (1fr)**: issue rows (not cards): 3px severity edge, `severity · rule display name`, `段 n · message with concrete values`, plugin provenance strip when applicable, waived desaturation; group by severity (collapsible); keyboard ↑↓ / Enter open segment / F8 next-prev when practical.
  - **Right (~420px)**: evidence — segment id + document, **source/target text** from `segments` prop (or honest empty), highlight using `evidence.sourceSpans` / `targetSpans` with `--signal-wash` + underline when spans exist; rule meta; actions **定位到段** · **就地修复** · **忽略…** (waiver §G8 actor+reason required); related segments list when `relatedSegmentIds` present.
- Page header: title + last run time · checked segment count + **运行 QA**; history popover from existing `qa.run.list` (no fake telemetry).
- Empty: no completed run → §D6 (`qa.noCompletedRun` style) + run action.
- **Reviewer queue**: fold into center column secondary group `待处理提案 n` when `review.queue` non-empty (accept/reject only if existing review accept/reject RPCs are already used elsewhere; otherwise keep current “open segment” behavior — **do not invent** review decision methods).
- **Profile editor**: restyle as **420px drawer** (expression); keep `qa.profile.clone` for built-in immutability and `qa.profile.update` for custom; mandatory-review toggle keeps `project.update` configuration path already present.
- Extract subcomponents under `components/quality/` so orchestrator is not a 1.2k monolith of JSX; preserve all invoke names/payloads.

### R2 — In-place fix (就地修复)

- Right column offers a constrained target editor (edit target text + save).
- Persist via **`segment.updateTarget`** with revision from the matching entry in `segments` (or re-fetch via existing `segment.list` / editor list **only if already used** on this page — prefer props + post-save `onRefresh` / local issue reload).
- **Ctrl+Enter**: save and advance to next open issue when possible.
- After successful save: reload issues (and parent refresh as needed); do not require navigation to Workbench.
- Failure: inline error; do not claim silent success.
- Tag tooling: only if existing shared tag helpers can be reused without Workbench coupling; otherwise plain text target editor is complete for this slice (residual: full TagCapsule parity).

### R3 — Export review gate + degradation checklist

- Reframe as **delivery gate** (not marketing hero):
  - Top **§A8 banner**: blocked (`--err` edge, optional hatch) vs clear (`--ok` + 可以导出).
  - **Gate rows** always show four checks (including passes): blocking errors · warnings · checked segments · unconfirmed/open policy counts when data exists on `QaGateResult` / run; use real fields only (no invented “全部已确认” if API does not provide unconfirmed count — use residual honest line from gate/run only).
  - Actions: **查看问题 →** (`onNavigate("qa-review")` or open segment), **重新检查** (`qa.gate.check`).
- **Export content** block: primary path remains **original format** via existing `document.export` + `selectExportPath`. Extra formats (bilingual DOCX / XLIFF / TMX) only if already invokable from this page or Interop; **do not invent** format RPCs — residual UI disabled with honest note if absent.
- **降级清单** (required):
  - **Pre-export**: list `document.degradation` (code, message, structuralPath when present); empty → honest “no recorded degradation findings”.
  - **Post-export**: show `ExportDocumentResult.degradation` on success (and path / open-folder only if already available; else path text).
  - Rows clickable only when a segment/document location is already resolvable; otherwise static list.
- Override: keep actor+reason + `qaOverride` on `document.export`; danger styling for override export; secondary confirm when practical without new dialog system.
- Progress: busy state with deterministic progress / stage copy if already present; **no** circular spinner; leaving page does not need new background job system (existing await export is fine; residual async job if none).
- Extract layout helpers under `components/quality/` as needed; neutralize marketing kickers.

### R4 — Assets surface five tabs

- Evolve `translation-memory` surface into **Assets** shell:
  - Header: `资产` + **overview strip** with mono counts from **real** list totals only (`tm.library.list`, `termbase.list`, corpora counts if Alignment/corpus list already returns them, last curation run if curation already exposes it). Missing cross-project grand totals → honest project-scoped facts; **no fake 128,436**.
  - **§E2 horizontal tabs** (≤5): `翻译记忆` · `术语库` · `养护` · `对齐与语料` · `互操作`.
  - Default tab: **养护** when design default preferred and panel loads; else TM if load cost forces — document choice in implement notes; prefer **养护** per `assets.md` §3.1 when practical.
- **TM tab**: two-column library list + detail (health summary from available library fields / curation residual, search via `tm.search` and/or `tm.lookupExact`, mount/create using existing library RPCs). Live Matrix only from real bucket data or inert decorative field labeled non-interactive if data insufficient.
- **Terms tab**: new presentation panel (or extract) using `termbase.list` / mount / `term.search` / import-export already on engine; status chips preferred/allowed/forbidden/pending only if contract fields exist.
- **Curation / Alignment / Interop tabs**: mount existing panels with ORTHO surface CSS (token discipline; remove literal `--curation-*` hard colors where touched).
- **TaskPackagePanel**: remains Insights process tab; optional light token pass if CSS collisions; **not** a sixth assets tab.
- Insights may continue mounting the same panel components so Phase 5 capabilities stay reachable (shared modules, dual host OK).
- Remove / neutralize legacy `SurfaceHeader` back-bar redundancy only where Shell already provides navigation — keep document identity if useful; no double Band.

### R5 — Expression-only + API preservation

- **No** engine / contracts / preload / new IPC methods.
- **No** semantic changes to `*-utils.ts` pure helpers except additive presentation helpers with tests.
- CSS: `styles/30-surfaces/quality.css` + `assets.css` (and neutralize obsolete `qa-*` / `export-*` / `tm-*` rules in mega `styles.css` when replacing).
- Tokens only; ban permanent box-shadow, circular spinners, decorative filler, rule-id-only titles.
- Prefer extracts so page orchestrators trend ≪ current monolith sizes.

### R6 — i18n + a11y

- All new chrome strings in `i18n/messages.ts` **en + zh**.
- Severity groups, empty states, gate rows, degradation labels, assets tabs, in-place fix labels, waiver, drawer titles.
- Matrices: title + legend + keyboard when interactive.
- Tabs: `tablist` / `tab` / `tabpanel`; listbox or grid patterns for issue list; icon-only controls labeled.

## Acceptance criteria

- [ ] **AC1** QA page primary layout is three columns: distribution · issue list · evidence (not filter-rail + bottom queue as the main composition).
- [ ] **AC2** Issue rows show human severity + display name and concrete message; waived state is visually distinct; plugin findings show provenance when snapshots exist.
- [ ] **AC3** Evidence column shows source/target (from loaded segments) with span highlight when evidence spans exist; empty evidence is honest.
- [ ] **AC4** **就地修复** saves via `segment.updateTarget` and reloads issues without requiring Workbench navigation; waive still requires actor+reason via `qa.issue.waive`.
- [ ] **AC5** Run QA / profile list-edit-clone / report export / scope filters / run history data still use the same Engine methods as today.
- [ ] **AC6** Export page is a gate layout with clear blocked/clear banner; export disabled when gate blocked unless override fields complete.
- [ ] **AC7** Degradation checklist is visible pre-export from `document.degradation` and post-export from export result degradation array.
- [ ] **AC8** `document.export` + `qa.gate.check` + override payload shapes unchanged.
- [ ] **AC9** Assets surface exposes exactly five tabs: TM / terms / curation / alignment / interop; Index Spine still lands on this surface as 资产.
- [ ] **AC10** TM and terms tabs use existing library/termbase/search RPCs (not exact-lookup-only stub as the whole surface).
- [ ] **AC11** Curation / alignment / interop panels remain functional with prior Engine flows; ORTHO styling applied (token surfaces; no new deps).
- [ ] **AC12** Overview counts / matrices never invent telemetry; residual when data missing.
- [ ] **AC13** en + zh for all new Phase 6 chrome.
- [ ] **AC14** Utils tests for touched pure helpers stay green; `pnpm` desktop typecheck green for renderer changes; no new engine methods.

## Out of scope

- Phase 7: AI control three-tab rewrite, selection AI menu, plugin permission matrix deep rewrite.
- Phase 8: settings Surface, coach marks, full dark dual-track, density screenshot matrix.
- Workbench **审校模式** mode bar (`quality.md` §3) — separate from QA Surface.
- New export formats, background export job system, or degradation **preview** RPC.
- Full TM maintenance bench batch ops / penalty drawer if not already implemented.
- Perfect Live Matrix health buckets without backend aggregation (honest residual OK).
- Moving TaskPackagePanel into assets tabs.
- Engine matching buckets, new QA rule catalog API, contracts changes.

## Assumptions

| Assumption | Confidence | Fallback |
| --- | --- | --- |
| Pre-export degradation list = `Document.degradation` is sufficient for gate page | High | Show empty honest state; post-export list still required |
| In-place fix can use `segments` prop + `segment.updateTarget` without new loaders | High | Call existing list methods already used in desktop if revision missing |
| `tm.search` + `termbase.list` / `term.search` are enough for TM/terms tabs | High | Keep lookupExact + residual empty states |
| Dual-hosting panels on Insights + Assets is OK | High | Insights keeps mounts; Assets is canonical chrome |
| Default assets tab = 养护 | Medium | Default TM if curation first paint too heavy |
| Unconfirmed segment count may be absent on gate | High | Omit row or show only fields on `QaGateResult`/`QaRun` |
| Branch `implement/ortho-frontend` continues serial ORTHO work | High | Per `task.json` |

## Notes

- Spec anchors: `screens/quality.md`, `screens/assets.md`, `09-implementation.md` §期6, `05-components.md` (A8 Banner, D4 Matrix, D6 Empty, D8 Diff, E2 Tabs, A6 Drawer), `.trellis/spec/frontend/*`.
- Quality bar: complete coherent expression for the three surfaces — shrink feature inventiveness, not finish quality of kept layouts.
- `research_needed: []` — baseline contracts and files are in-repo; implement can proceed without a research spawn.
