# ORTHO Phase 5 — Project surfaces

## Goal

Deliver **expression-only** project-class surfaces from `docs/design-ii/09-implementation.md` §期5 and `docs/design-ii/screens/project.md`:

1. **Project home** — 35/65 asymmetric layout, plate/seam project cards, horizontal §E2 tabs (projects / search / templates / recycle), optional `project-open` FLIP when practical without new deps.
2. **Setup wizard** — 30/70 layout, semantic form groups, §E5 Stepper (fixed sticky/overflow defects).
3. **Project insights** — §E3 vertical tab list with groups, overview metric blocks each bound to a user action, extract large subpanels into dedicated files.

Branch: `implement/ortho-frontend`. i18n: **en + zh**. Preserve open / create / archive / recycle / template / search Engine APIs and parent navigation contracts.

## Context (done / do not redo)

| Phase | Delivered (leave alone except wiring from App/shell) |
| --- | --- |
| 0–1 | Shell, tokens, surfaces, motion base, `useViewTransition` |
| 2 | Workbench Masthead / FilterRail / DocumentMatrix / ActiveAxis |
| 3 | Segment grid cells, lamps, tags, batch, inline QA |
| 4 | Stack dual-pane + Preview dock extracts under `components/workbench/` |

**Do not** rework Workbench grid/stack/preview, engine, contracts, preload, or invent new IPC for project lifecycle.

## Current baseline (evidence)

| File | Approx LOC | Layout today |
| --- | --- | --- |
| `ProjectHome.tsx` | ~1,244 | Header + **left 230px-style nav** (4 tabs) + content; rounded-card grid; utils intact in `project-home-utils.ts` |
| `SetupView.tsx` | ~815 | Header brand + top/side step buttons + flat form fields; no semantic groups; decorative meta possible |
| `ProjectInsightsPage.tsx` | ~1,677 | **Horizontal** tab strip (12 items) + all subpanels inline; overview is metric dashboards **without** required decision actions |
| App routing | — | `mode: home \| setup \| workspace`; `ProjectHome.onOpen` / `SetupView.onCreated` / insights via WorkbenchPages |

Logical contracts already green and **must stay green**:

- `project-home-utils.ts` (+ tests): snippet parse, template definition clone/sanitize
- Engine methods: `project.list/get/create/createFromTemplate/setLifecycle`, `project.batchImport`, `project.template.*`, `project.analytics.get`, `project.archive.export/restore`, `search.global`, `recycle.*`, `document.*`, `analysis.*`, `history.list`
- Bridge: `selectSource*`, `selectProjectArchive*`, `resolveDroppedPaths`
- Parent: `onOpen(projectId, documentId?, segmentId?, segmentOrdinal?)`, `onCreate` → setup mode, `onCreated` → open workspace, save-before-nav from Workbench

## Requirements

### R1 — Project home (35/65)

- **Remove** permanent left 230px four-item nav column.
- Layout: **35% composition rail** + **65% content**.
  - Left: brand plate (Ink + bevel discipline from shell/BrandMark) + inert matrix/field decoration (CSS tokens only; no fake live data) + **asset summary** from *real* aggregated or per-list data already available (e.g. project counts, analytics when loaded). If no cross-project TM/term/corpus totals exist in current APIs, show honest available workspace facts (project count, active lifecycle totals, last refresh) — **do not invent metrics or new RPC**.
  - Right: masthead row (title / search focus or open search tab / **新建项目**) + **§E2 horizontal Tabs** (≤4 items, legal): `项目 n` · `搜索` · `模板 n` · `回收站`.
- Tabs content preserves existing behavior:
  - **Projects**: card grid + Active/Archived §C8 segmented control + pagination (`PROJECT_PAGE_SIZE` / `project.list` offset).
  - **Search**: existing `GlobalSearchPanel` / home search path; same `search.global` field ids; mark parsing only via `parseSearchSnippet` (no `dangerouslySetInnerHTML`).
  - **Templates**: list + create/edit/delete via existing template RPCs + dialog; definition clone rules unchanged.
  - **Recycle**: list + restore / permanent purge (name-confirm for purge).
- **Empty state** (§D6): not a huge dashed rectangle; copy + primary **新建项目** (+ open example only if `App` already exposes that path — do not invent).
- Delete filler counts like bare “0 projects in this view”; put counts on tab labels (`项目 4`).
- **Refresh**: left-rail bottom or content meta — text/meta button + last-refresh time; **no floating FAB**.
- **Restore archive**: secondary control → existing `selectProjectArchive` + `project.archive.restore`.
- Settings gear FAB if present on home: remove; settings remain shell/Index Spine path.

### R2 — Project cards

- Plate + seam grid units (not soft marketing cards): left **3px Band Echo** on card (only Echo on this surface), title, domain + locale pair, **4px stacked progress** from analytics completion, mono counts (files / segments / issues with error lamp when blockers > 0), updated date, overflow menu on hover/focus.
- Grid: `repeat(auto-fill, minmax(280px, 1fr))`, gap **0**, separators via `--rule` seams.
- Hover: `--shade`; focus: left Active Axis (reuse `ActiveAxis` if practical).
- Overflow actions (existing capabilities only): open · rename **if** update path already exists · save-as-template **if** present · archive / restore lifecycle · recycle · export archive **if** already wired from home; omit inventing new flows.
- Archived cards: reduced saturation + `已归档` badge.
- Open: still resolves first/selected document then `onOpen(...)`; no engine change.

### R3 — `project-open` FLIP (best-effort, no new deps)

- Prefer View Transitions already used by `useViewTransition` + CSS in `styles/03-motion.css`.
- On open intent: mark the source card `data-opening` and assign `view-transition-name: project-identity` only for that card; clear after transition.
- If Workbench masthead identity plate can share the same transition name for the receiving end **without** Workbench rewrites that risk Phase 2–4, wire it; otherwise:
  - Ship home-side naming + surface transition into workspace, document residual “identity FLIP incomplete until masthead names match” — **do not** block home layout on perfect morph.
- Respect `prefers-reduced-motion`; no new animation libraries.

### R4 — Setup wizard (30/70 + Stepper)

- Layout: **30% composition rail** (brand plate + inert field + **live summary**: locales, file count) + **70% content** (max content width ~720px).
- **§E5 Stepper** vertical: Mono two-digit index (`01`…) + **12px** gap + title; item height ~36px; current step left Active Axis; completed check (`--ok`); future muted. Fix legacy sticky/overflow (`02Configuration`-style).
- **Delete** wasteful right info column and decorative footer chips (`SQLITE WORKSPACE · …`).
- Steps (logic preserved):
  | Step | Content | Advance |
  | --- | --- | --- |
  | 01 项目 | name (required), source/target locale, domain optional; workspace path **only if** existing API/UI already supports change — else omit or read-only residual | name non-empty + source ≠ target (`setup.languagesMustDiffer`) |
  | 02 配置 | grouped frames: **复用** (template) / **质量** (QA profile, review policy) / **自动化** (AI, pipeline, analysis) | always (defaults) |
  | 03 文件 | dropzone + file/folder pickers + list + atomicity (`setup.bestEffort` / `setup.allOrNothing`) | ≥1 source (or existing empty-project policy if already allowed — keep current submit rules) |
- Each select shows **consequence meta** from current selection (rule count, “engine not configured”, template default) when data already available; no fabricated stats.
- Import progress: keep diagnostics list + failed expand/retry/skip honesty; no silent drop.
- Wizard step transitions: left rail `view-transition-name: none`; right panel subtle ±16px + fade (`wizard-next` / `wizard-back` if easy via `data-transition` or CSS classes); Stepper axis 160ms.
- Props unchanged: `onCreated(projectId, documentId)`, optional `onCancel`.
- Dependency diagnostics remain visible until user opens workspace (existing contract).

### R5 — Insights vertical tabs + overview actions + extracts

- Replace horizontal overflow tab strip with **§E3 vertical Tab List** (~180px): groups per design:
  - 概览 · 文件 · 分析
  - ─ 资产 ─ → 资产养护 · 对齐与语料 · 互操作
  - ─ 流程 ─ → 重导入 · 任务包 · 讨论
  - ─ 系统 ─ → 插件 · 归档与快照 (merge archive + history/snapshots into one group as data already supports; keep existing panel entry points)
- Map existing tab ids (`overview`, `files`, `analysis`, `assets`, `alignment`, `interop`, `reimport`, `task-packages`, `discussions`, `plugins`, `archive`, `history`) into the grouped list without dropping capability.
- Selected item: left Active Axis + shade; keyboard Up/Down + Home/End; `role="tablist"` orientation vertical.
- **Overview**: every major metric block ends with a **decision action**, e.g.:
  - TM / match band → “filter segments by match” intent: navigate to workbench with filter hint **only if** existing `onOpenDocument` / parent can accept segment/filter params; else deep-link to files tab or show “open workbench” with document selection.
  - QA blockers → open QA surface path **if** already reachable from insights parent; else switch to files + notice, or call existing WorkbenchPages navigation if props allow. Prefer extending props with optional callbacks (`onOpenQa`, `onOpenAi`) **only** when parent already has routes; do not invent surfaces.
  - AI contribution → “AI control” only if App already routes there; else honest “open settings/AI when available” residual.
  - Stale analysis: §A8-style banner + re-run analysis (existing `analysis.run`).
- **Extract subpanels** from the 1.6k monolith into colocated modules (suggested `components/project/insights/*`) while **ProjectInsightsPage** remains orchestrator for load/mutate/busy/error/dialogs.
- Keep embedded panels: `AssetCurationPanel`, `AlignmentCorpusPanel`, `InteropPanel`, `TaskPackagePanel`, `DiscussionSnapshotPanel`, `PluginsPanel` as mounts (expression polish only if trivial; Phase 6 owns deep asset rewrites).

### R6 — Expression-only + API preservation

- **No** engine / `@translunar/contracts` / preload / new IPC methods.
- **No** changes to `project-home-utils` semantics except presentation helpers if pure.
- Preserve mutation shapes: lifecycle, recycle, template CRUD, batch import, archive export/restore, reimport preview/apply, analysis run.
- CSS: tokens + new/updated surface CSS under `styles/30-surfaces/` (prefer extract out of mega `styles.css` for project-home/setup/insights when touching rules); ban decorative filler copy, circular spinners (use existing loading patterns), literal off-token colors.
- File size: prefer extracts so orchestrators trend under ~400–600 lines; do not leave one 1.6k file “restyled only” if extract is low-risk.

### R7 — i18n + a11y

- All new chrome strings in `i18n/messages.ts` **en + zh**.
- Tab labels with counts; empty states; step titles; group headers; overview action labels; purge name-confirm; archive badge.
- Icon-only controls: `aria-label` + title.
- Tabs/Stepper: correct ARIA (`tablist`/`tab`/`tabpanel`, `aria-current` for steps).
- Confirm dialogs: danger confirm not default focus (existing pattern).

## Acceptance criteria

- [ ] **AC1** Project home is 35/65: composition rail left, content right; **no** permanent left nav column of four vertical items.
- [ ] **AC2** Home uses horizontal §E2 tabs for projects / search / templates / recycle; counts appear on tab labels where totals are known.
- [ ] **AC3** Project cards are plate/seam units with progress + counts + lifecycle/recycle actions; archived visual treatment applied for archived lifecycle.
- [ ] **AC4** Open / create / archive / recycle / restore-archive / template CRUD / global search still call the same Engine methods and parent `onOpen` / `onCreate` contracts.
- [ ] **AC5** Empty projects state is §D6-style (not huge dashed frame); refresh is non-FAB.
- [ ] **AC6** `project-open` FLIP: either shared `project-identity` View Transition works card→workspace identity, **or** residual documented and surface transition still works without deps.
- [ ] **AC7** Setup is 30/70 with §E5 Stepper (mono 2-digit + 12px gap + title); no stuck `02Configuration` label collision.
- [ ] **AC8** Setup step 2 fields are in semantic groups (reuse / quality / automation); decorative SQLITE/LOCAL chips removed if present.
- [ ] **AC9** Setup create + batchImport + rollback-on-empty paths unchanged in behavior; language-must-differ still enforced.
- [ ] **AC10** Insights uses vertical grouped Tab List (~180px); all previous tab capabilities remain reachable.
- [ ] **AC11** Overview metric blocks each expose at least one decision action (or honest residual when target surface not wired); stale analysis banner + re-run when `stale`.
- [ ] **AC12** Insights subpanels extracted enough that `ProjectInsightsPage.tsx` is primarily orchestration (target ≪ 1,677 lines; ideally ≤ ~600).
- [ ] **AC13** en + zh keys for all new user-visible Phase 5 chrome.
- [ ] **AC14** `project-home-utils` tests stay green; new pure helpers (if any) have unit tests; no new engine methods.

## Out of scope

- Phase 6: QA review three-column rewrite, export degradation list, full assets Surface five-tab redesign.
- Phase 7: AI control three-tab rewrite, selection AI menu, plugin permission matrix deep rewrite.
- Phase 8: settings Surface, coach marks, full dark dual-track, density matrix.
- Engine matching buckets, new analytics fields, workspace path picker if not already implemented.
- Perfect multi-window or second-display identity morph beyond View Transition + existing masthead.
- Rewriting `GlobalSearchPanel` backend shape or Workbench command palette contracts.

## Assumptions

| Assumption | Confidence | Fallback |
| --- | --- | --- |
| Cross-project TM/term/corpus totals are **not** available without new RPC | High | Left rail shows project-derived / refresh / brand composition only |
| Overview “go to QA / AI” may lack direct props today | Medium | Optional callbacks if parent has routes; else files/workbench open or residual note |
| FLIP to masthead identity may need small Workbench/Masthead class hook | Medium | Home-only VT + residual |
| Workspace path change on step 1 may not exist | High | Omit field; residual |
| Branch `implement/ortho-frontend` continues serial ORTHO work | High | Per `task.json` |

## Notes

- Spec anchors: `screens/project.md`, `09-implementation.md` §期5, `05-components.md` §E2/E3/E5, `.trellis/spec/frontend/electron-workbench.md` Project Lifecycle.
- Quality bar: complete coherent expression for the three surfaces — shrink feature inventiveness, not finish quality of kept layouts.
