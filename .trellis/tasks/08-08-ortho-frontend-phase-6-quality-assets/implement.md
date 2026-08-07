# Implement — Phase 6 Quality and assets

## Branch

`implement/ortho-frontend` (task.branch). Do not merge master/main from this worker.

## Ordered checklist

### 0. Prep

- [ ] Confirm branch `implement/ortho-frontend` and Phase 0–5 shell/project surfaces exist.
- [ ] Read `docs/design-ii/screens/quality.md`, `assets.md`, `09-implementation.md` §期6.
- [ ] Inventory invokes in `QaReviewPage`, `ExportReviewPage`, `WorkbenchPages` TM stub, curation/alignment/interop panels — **do not change method names/payloads**.
- [ ] Copy `segment.updateTarget` argument shape from `Workbench.tsx`.
- [ ] Note legacy CSS anchors in `styles.css` (`.qa-*`, `.export-*`, `.tm-*`) for neutralization.

### 1. Shared quality primitives

- [ ] Add `components/quality/LiveMatrix.tsx` (title, legend, cell states, optional keyboard/click).
- [ ] Add `qa-presenters.ts`: severity order, group issues, span highlight slices, rule label helper — unit tests.
- [ ] Add `styles/30-surfaces/quality.css` + import in `styles/index.css`.
- [ ] Reuse `ActiveAxis` / chip under-edge patterns from workbench/project where geometry matches.

### 2. QA three-column + in-place fix (R1–R2)

- [ ] Extract distribution / list / evidence / profile drawer / run history from `QaReviewPage.tsx`.
- [ ] Restructure to `.qa-ortho` header + three columns; remove bottom review-band as primary layout; queue → list secondary group.
- [ ] Wire Live Matrix from segments + issue severities; severity chips filter; scope + rule filters.
- [ ] Evidence: source/target from `segments`; span wash; actions 定位到段 / 就地修复 / 忽略.
- [ ] Implement in-place editor → `segment.updateTarget` → reload issues; Ctrl+Enter next open issue.
- [ ] Keep waive/revoke/profile clone-update/report export/run list identical in RPC.
- [ ] Empty §D6 when no run; i18n for new chrome.
- [ ] Target orchestrator size ≪ 1,211 LOC of JSX.

### 3. Export gate + degradation (R3)

- [ ] Restructure `ExportReviewPage` to banner + gate checklist + content + degradation + actions.
- [ ] Pre-list `document.degradation`; post-list export result.degradation.
- [ ] Preserve `qa.gate.check`, blocker list, override actor/reason, `document.export`.
- [ ] **查看问题 →** `onNavigate("qa-review")` when available.
- [ ] No circular spinner; busy text only.
- [ ] Residual: extra export formats if not already wired.

### 4. Assets surface five tabs (R4)

- [ ] Replace `TranslationMemoryPage` with `AssetsSurface` (extract under `components/assets/` preferred).
- [ ] Overview strip from real list totals only.
- [ ] §E2 tabs: TM | terms | curation | alignment | interop (default 养护 if practical).
- [ ] `TmHubPanel`: `tm.library.list` + mount/create if already supported elsewhere + `tm.search` / lookupExact results UI.
- [ ] `TermbaseHubPanel`: `termbase.list` + `term.search` + import/export if panel can reuse TaskPackage/Workbench patterns without new RPC.
- [ ] Mount `AssetCurationPanel` / `AlignmentCorpusPanel` / `InteropPanel` with same props Insights uses.
- [ ] Add `styles/30-surfaces/assets.css`; token-remap panel CSS literals when touched.
- [ ] Optional light pass on `TaskPackagePanel` CSS only if required for token conflicts — keep Insights host.
- [ ] Slim redundant SurfaceHeader if double-chrome with Shell.

### 5. i18n + a11y

- [ ] en+zh: tab labels, gate rows, degradation empty, in-place fix, matrix legend, empty states, drawer titles.
- [ ] QA list keyboard; assets tabs ARIA; icon-only labels.
- [ ] Focus return from profile drawer and waive dialog.

### 6. Cleanup + validation

- [ ] Neutralize obsolete mega `styles.css` layout rules for old QA/export/TM shells when unused.
- [ ] Ensure Insights still mounts panels.
- [ ] Run validation commands below.
- [ ] Manual AC1–AC14 walkthrough; document residuals (matrix partial, formats, tag editor).

## Validation commands

```bash
# From repo root
cd apps/desktop

# Pure helpers / quality / assets tests
pnpm exec vitest run src/renderer/components/quality --passWithNoTests
pnpm exec vitest run src/renderer/components/assets --passWithNoTests
pnpm exec vitest run src/renderer/plugin-provenance-utils.test.ts
pnpm exec vitest run src/renderer/asset-curation-utils.test.ts
pnpm exec vitest run src/renderer/alignment-corpus-utils.test.ts

# Broader renderer smoke if time
pnpm exec vitest run src/renderer --passWithNoTests

# Typecheck
pnpm run typecheck
```

Manual:

1. Open project → Ctrl+2 QA: three columns; run QA; select issue; spans/evidence; in-place fix saves; waive requires reason.
2. Ctrl+3 Export: blocked/clear banner; degradation list; override export; success shows path + degradation copy.
3. Ctrl+4 Assets: five tabs; TM libraries/search; terms list/search; curation/alignment/interop still mutate via existing flows.
4. Insights still opens curation/alignment/interop/task packages.
5. Locale en/zh on new strings; reduced-motion no broken overlays.

## Risk points

| Point | Watch |
| --- | --- |
| `segment.updateTarget` shape | Mirror Workbench exactly |
| Matrix DOM at 10k segments | Cap / virtualize / content-visibility |
| Dual CSS (panel css + assets.css) | Specificity under host class |
| Insights import paths | Do not move panel files without updating Insights |
| styles.css collisions | Scope `.qa-ortho` / `.export-ortho` / `.assets-ortho` |
| Fake overview numbers | Only list totals |
| Export formats | Residual only |

## Done definition

All AC1–AC14 met or residual explicitly listed in task notes; typecheck + relevant unit tests green; expression-only (no contracts/engine/preload diffs).
