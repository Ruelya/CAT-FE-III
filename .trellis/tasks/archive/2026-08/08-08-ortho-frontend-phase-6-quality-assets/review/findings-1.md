# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-6-quality-assets`
- branch: `implement/ortho-frontend`
- head_sha: `b6748b392342e6eda1f652fb99dc58bacac51c13` (working tree has uncommitted Phase 6 renderer work)
- round: 1

## need_verify
- required: false

### Verify mission
- none (static review + package typecheck + scoped unit tests are sufficient for expression-only AC judgment; residuals are documented in `docs/design-ii/09-implementation.md` §期6 and accepted)

## issues

### F1
- severity: nit
- files: `apps/desktop/src/renderer/components/assets/AssetsSurface.tsx`, `apps/desktop/src/renderer/components/assets/AssetsTabList.tsx`
- problem: Assets `role="tabpanel"` is not wired with `aria-labelledby` / `id` pairing to the selected tab control (keyboard roving on tablist itself is present).
- minimal_fix: Pass active tab button id into the panel as `aria-labelledby`; set matching `id` on the selected `role="tab"`.
- status: open

### F2
- severity: nit
- files: `apps/desktop/src/renderer/components/quality/QaEvidencePanel.tsx:104-114`, `apps/desktop/src/renderer/QaReviewPage.tsx:300-319`
- problem: `saveAndMaybeAdvance(advance)` ignores `advance`; parent always sets `advanceAfterFix` after every successful save (button and Ctrl+Enter behave the same). Product requirement is met for Ctrl+Enter advance; dead parameter is noise only.
- minimal_fix: Either always advance in parent (drop param) or gate `setAdvanceAfterFix` on the flag so a non-advance save path can exist later.
- status: open

### F3
- severity: nit
- files: `apps/desktop/src/renderer/components/assets/TermbaseHubPanel.tsx`
- problem: Terms hub covers list/create/mount/unmount/`term.search` (AC10). `termbase.import` / `termbase.export` are not surfaced on this hub (optional under R4 “if panel can reuse”; not present elsewhere as a forced requirement for Phase 6).
- minimal_fix: Optional residual only — wire import/export via existing `select*` + invoke patterns if product wants hub parity with Interop/TaskPackage later. Not required for green closeout.
- status: wontfix

## assumptions
- Expression-only scope holds: git name-only diff is renderer pages/components/styles/i18n + design-ii implement notes; no engine / contracts / preload / package.json dependency changes.
- `segment.updateTarget` shape matches Workbench/App (`segmentId`, `targetText`, `expectedRevision`) — verified by static comparison.
- Documented residuals in `docs/design-ii/09-implementation.md` §期6 are **accepted** per review brief: partial Live Matrix from loaded PAGE_SIZE issues; plain-text in-place editor (no TagCapsule); export extra formats residual; TM health matrix residual; queue open-segment only; dual-host Insights panels; TaskPackage stays on Insights.
- Category select + severity/disposition chips satisfy “human-readable filters”; multi-select by raw `ruleId` was not required beyond human labels + message body (AC2).
- en+zh Phase 6 chrome keys exist in `messages.ts` (typecheck enforces `MessageKey` completeness).
- Insights still imports and mounts `AssetCurationPanel` / `AlignmentCorpusPanel` / `InteropPanel` / `TaskPackagePanel` (path stable).

## evidence_checked
| Check | Result |
| --- | --- |
| AC1 three-column `.qa-ortho__body` | CSS `180px / 1fr / minmax(320px,420px)`; `QaDistributionColumn` + `QaIssueList` + `QaEvidencePanel` |
| AC2 rows | severity · category display name; message line; waived attr; plugin provenance strip; ruleId mono meta |
| AC3 evidence | source/target via `findSegment` + `sliceWithSpans`; honest empty when segment missing |
| AC4 in-place fix | `segment.updateTarget` → `onRefresh` + `loadIssues`; waive requires actor+reason |
| AC5 RPC set | `qa.profile.*`, `qa.run`/`list`, `qa.issue.*`, `qa.report.export`, `review.stats`/`queue` unchanged names |
| AC6–AC8 export | `ExportGateBanner` blocked/clear; `canExport` gate; degradation pre/post; `qa.gate.check` + `document.export` + override shape |
| AC9–AC11 assets | five tabs; default `curation`; TM/terms hubs; panels mounted under hosts |
| AC12 honesty | overview uses list `total`s; matrix caption “loaded issues”; TM health residual copy |
| AC13 i18n | new keys en+zh |
| AC14 tests/typecheck | `qa-presenters` 8/8; provenance/curation/alignment utils 13/13; `pnpm run typecheck` exit 0 |
| Surface wiring | `WorkbenchPages` routes `translation-memory` → `AssetsSurface`; spine id preserved |

## residual_risks (accepted)
1. Live Matrix severity is a projection of **currently loaded** issues (PAGE_SIZE 30), capped at 2000 cells — labeled via matrix caption; no aggregation RPC.
2. In-place fix is plain textarea — TagCapsule / tag tooling residual.
3. Export formats beyond original document format residual (honest copy points elsewhere).
4. TM health Live Matrix not driven by real buckets.
5. Review queue: open segment only (no invent accept/reject).
6. Electron manual smoke (run QA end-to-end, export path dialog, real library mounts) not executed in this review environment; static + typecheck + unit tests cover structural ACs.

## summary_for_orchestrator
Phase 6 expression shipped on `implement/ortho-frontend` working tree: QA three-column + in-place fix, export gate + degradation list, assets five-tab shell with TM/terms hubs and dual-hosted curation/alignment/interop. API/IPC surface preserved; typecheck green; quality presenters + related utils tests green. Documented residuals in `09-implementation.md` accepted. Only nits remain (F1–F2 open, F3 wontfix); **no blocker/major**. Verdict **green** — **ready_for_closeout** (commit Phase 6 renderer + task artifacts when closeout runs; no fix round required unless Orchestrator wants F1 a11y polish first).
