# Design — Phase 6 Quality and assets

## Boundaries

| Layer | In | Out |
| --- | --- | --- |
| Renderer presentation | QA 3-col, export gate + degradation, assets 5-tab shell, panel ORTHO CSS, i18n | Engine algorithms, new contracts, new IPC |
| App / shell | Existing `AppSurface` ids; WorkspacePage routing; optional props for navigate QA↔export | New surfaces, settings rewrite, review mode workbench |
| Utils | Pure presentational helpers (rule label maps, span slice, degradation row map) + tests | Semantic changes to provenance/curation/alignment utils |
| IPC | Existing methods only | New methods / preload fields |

## Current baseline (evidence)

- `WorkbenchPages.WorkspacePage` switches `qa-review` | `export-review` | `translation-memory` | `ai-control` | `project-insights`.
- `SURFACE_ORDER[3] === "translation-memory"` labeled **资产** — keep id; rewrite content.
- QA: `QaReviewPage` already loads profiles, runs, issues, stats, queue; detail uses `Evidence` value chips; no `segment.updateTarget`.
- Export: `qa.gate.check` + blockers + override + `document.export`; ignores `document.degradation` / result.degradation UI.
- Assets stub: `tm.lookupExact` only.
- Heavy panels live at renderer root with dedicated CSS; Insights dual-mounts curation/alignment/interop/task packages.
- Matrix primitives: `styles/10-components/matrix.css` + workbench `DocumentMatrix` (document ordinal). Prefer a thinner **LiveMatrix** for QA/assets distribution (CSS grid of cells), not full DocumentMatrix coupling.
- Phase 5 pattern: orchestrator + `components/{domain}/*` + `styles/30-surfaces/*.css`.

## Target architecture

```text
WorkbenchPages.WorkspacePage
├── (optional slim page chrome — no second Band)
├── QaReviewPage                    # orchestrator: load/run/waive/fix/fix
│   └── components/quality/
│       ├── QaDistributionColumn    # LiveMatrix + severity chips + filters + profile link
│       ├── QaIssueList             # grouped rows + keyboard
│       ├── QaEvidencePanel         # source/target + spans + actions + in-place editor
│       ├── QaRunHistoryPopover     # from runs[]
│       ├── QaProfileDrawer         # extract ProfileEditor expression
│       └── qa-presenters.ts        # labels, group, span highlight pure helpers
├── ExportReviewPage                # orchestrator: gate + export
│   └── components/quality/
│       ├── ExportGateBanner
│       ├── ExportGateChecklist
│       ├── ExportDegradationList
│       └── ExportDeliveryActions
└── AssetsSurface (replaces TranslationMemoryPage)
    ├── AssetsOverviewStrip
    ├── AssetsTabList §E2
    ├── TmHubPanel                  # library list + search (tm.library.* / tm.search)
    ├── TermbaseHubPanel            # termbase.* / term.search
    ├── AssetCurationPanel          # existing module, ORTHO CSS host
    ├── AlignmentCorpusPanel
    └── InteropPanel
```

`TaskPackagePanel` stays under Insights only (Phase 5 process group).

### Suggested paths

```text
apps/desktop/src/renderer/
  QaReviewPage.tsx
  ExportReviewPage.tsx
  WorkbenchPages.tsx              # route AssetsSurface; slim SurfaceHeader
  components/quality/
    QaDistributionColumn.tsx
    QaIssueList.tsx
    QaEvidencePanel.tsx
    QaRunHistoryPopover.tsx
    QaProfileDrawer.tsx
    ExportGateBanner.tsx
    ExportGateChecklist.tsx
    ExportDegradationList.tsx
    ExportDeliveryActions.tsx
    LiveMatrix.tsx                # shared thin matrix (title, legend, cells)
    qa-presenters.ts
    *.test.ts(x)
  components/assets/
    AssetsSurface.tsx             # or keep function in WorkbenchPages initially then extract
    AssetsTabList.tsx
    AssetsOverviewStrip.tsx
    TmHubPanel.tsx
    TermbaseHubPanel.tsx
    *.test.ts(x)
  AssetCurationPanel.tsx          # keep path stable for Insights import
  AlignmentCorpusPanel.tsx
  InteropPanel.tsx
  styles/30-surfaces/
    quality.css
    assets.css
```

Keep stable imports: `QaReviewPage`, `ExportReviewPage`, panel roots for Insights.

## Layout contracts

### QA three-column

```css
.qa-ortho {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr);
  min-block-size: 0;
  height: 100%;
}
.qa-ortho__body {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr) minmax(320px, 420px);
  min-block-size: 0;
}
.qa-issue-row {
  border-inline-start: 3px solid var(--err | --warn | --machine);
}
.qa-issue-row[data-selected] { background: var(--shade); /* ActiveAxis left */ }
.qa-evidence__text { background: var(--deck); font-size: var(--t-editor, inherit); }
.qa-evidence mark,
.qa-span-hit {
  background: var(--signal-wash);
  text-decoration: underline;
  text-underline-offset: 2px;
}
```

- Header outside columns: title + run meta + Run QA.
- Profile drawer: right 420px overlay/push; Esc returns focus.
- No permanent bottom “review-band” stealing the third column; queue becomes list group.

### Export gate

```css
.export-ortho { display: grid; gap: 0; /* seams via borders */ max-width: 960px; }
.export-banner[data-state="blocked"] { border-inline-start: 3px solid var(--err); }
.export-banner[data-state="clear"] { border-inline-start: 3px solid var(--ok); }
.export-gate-row { display: grid; grid-template-columns: auto 1fr auto auto; }
.export-degradation-list { /* mono path, message, severity lamp */ }
```

### Assets five tabs

```css
.assets-ortho {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-block-size: 0;
  height: 100%;
}
.assets-tabs { /* §E2 ~40px; selected under-edge Active Axis */ }
.tm-hub {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
  min-block-size: 0;
}
```

Reuse Phase 5 `HomeTabList` pattern or assets-local `AssetsTabList` with same ARIA.

## Data flow (unchanged RPC)

### QA

```text
load:
  qa.profile.list → profiles
  qa.run.list → runs / last run meta
  qa.issue.list (scope, severity, category, disposition, offset/limit) → issues
  review.stats / review.queue → optional queue group

run:
  qa.run { projectId, documentId?, profileId? } → reload

waive / revoke:
  qa.issue.waive | qa.issue.revoke → reload

in-place fix:
  segment.updateTarget { segmentId, targetText, expectedRevision, ...existing fields }
  → onRefresh? + loadIssues

profile:
  qa.profile.clone | qa.profile.update
  project.update configuration.reviewRequired (existing)

report:
  qa.report.export
```

### Export

```text
qa.gate.check { projectId, documentId }
qa.issue.list (blockers by ids) — existing
document.degradation → pre-list (from props.document)
document.export { documentId, outputPath, qaOverride? }
  → result.degradation, outputPath, translatedSegments
```

### Assets

```text
TM:     tm.library.list | create | mount | unmount; tm.search | tm.lookupExact
Terms:  termbase.list | create | mount | unmount | import | export; term.search
Curation / Alignment / Interop: existing panel invoke graphs only
Overview strip: lengths/totals from those list results only
```

### Props preservation

```ts
// WorkspacePageProps — keep; pages already receive:
// snapshot, document, segments, issues, onNavigate, onRefresh,
// onOpenSegment, onOpenDocument, onOpenProject, onReturnHome, onOpenSettings

// Export: use onNavigate("qa-review") for 查看问题 when gate blocked
// QA: onOpenSegment for 定位到段
```

Do not require new App props unless export/QA need a path already available via `onNavigate`.

## Live Matrix strategy

| Surface | Cell meaning | Data source | Interaction |
| --- | --- | --- | --- |
| QA left | One cell per segment ordinal (cap / window if huge) | `segments` + max severity from loaded issues (or issue list ordinals) | Click → select first issue for segment / filter list |
| TM health | Only if library or curation supplies bucket counts | Prefer counts from curation last run if already loaded; else **inert** matrix + legend “示意不可用/无分桶” honesty | No fake click-through |
| Curation | Prefer existing panel findings distribution; expression restyle only | Existing | Keep panel logic |

If issue list is paginated, matrix severity may be **partial** — label matrix as “当前结果/已加载问题投影” or build severity map by requesting a higher limit only if already acceptable performance; **do not** add a new aggregation RPC. Prefer projecting known issues onto `document.segmentCount` with unknown = neutral.

## In-place fix contract

```ts
// Controlled editor in QaEvidencePanel
// Save:
await window.translunar.invoke("segment.updateTarget", {
  segmentId,
  targetText,
  expectedRevision: segment.revision, // from props.segments
  // include any required fields matching Workbench usage — mirror Workbench.tsx invoke shape
});
```

Read Workbench’s existing `segment.updateTarget` call site and **mirror field set exactly**. After success: clear dirty, `loadIssues()`, optional `onRefresh()`.

## Rule display names

- Prefer i18n map keyed by known built-in `ruleId` / category when messages already exist.
- Fallback: category label + severity; never show bare `qa.tag-tag_missing` as the only title if `message` is human-readable — use **message** as second line (already true today) and demote `ruleId` to mono meta (D10).

## CSS / token discipline

- New rules in `quality.css` / `assets.css` under `@layer surfaces`.
- Migrate away from `AssetCurationPanel.css` literal `--curation-green` etc. when touching: map to `--ok` / `--warn` / `--err` / `--machine`.
- Neutralize conflicting legacy `.qa-workspace` / `.export-review-*` / `.tm-surface` layout in `styles.css` (prefix legacy or delete dead selectors once unused).
- Import new sheets from `styles/index.css`.

## Insights dual-host

- Insights keeps importing panel components (Phase 5 R5 residual).
- Assets becomes the Spine destination for asset work; Insights entries remain functional embeds.
- No navigation rewrite required beyond existing overview optional callbacks.

## Trade-offs

| Choice | Why | Cost |
| --- | --- | --- |
| Keep surface id `translation-memory` | Avoids shell/keymap churn | Internal name ≠ label |
| Thin LiveMatrix vs DocumentMatrix | QA cells = severity not workflow lamps | Two matrix components |
| Pre-export degradation from import findings | No new preview RPC | May under-report export-only losses until after export |
| Paginated issues vs full matrix | Existing PAGE_SIZE | Matrix incomplete unless documented |
| Dual-host panels | Zero capability loss on Insights | Two entry points for same UI |
| Plain target editor first | Avoid Workbench IME grid coupling | Residual tag-capsule parity |

## Rollback

- Expression-only: revert renderer files on branch; no DB/schema migration.
- Keep panel file paths stable so Insights does not break if Assets shell reverts.
- Feature flags not required; ship behind normal branch merge.

## Risk register

| Risk | Mitigation |
| --- | --- |
| `segment.updateTarget` param drift | Copy Workbench invoke literally; typecheck |
| 10k segments matrix DOM cost | Cap visible cells / CSS content-visibility; window by viewport |
| Mega CSS conflict | Scope under `.qa-ortho` / `.export-ortho` / `.assets-ortho` |
| Curation CSS literals | Token remap only when editing panel styles |
| Export format wishlist | Residual disabled rows; original format only |
| Review accept/reject missing | Queue open-segment only (current behavior) |
