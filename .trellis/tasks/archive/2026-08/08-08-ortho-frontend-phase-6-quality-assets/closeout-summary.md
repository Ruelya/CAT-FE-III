# Closeout summary — ORTHO Phase 6 Quality and assets

**Task:** `.trellis/tasks/08-08-ortho-frontend-phase-6-quality-assets`  
**Branch:** `implement/ortho-frontend`  
**Review:** `review/findings-1.md` — green / ready_for_closeout (F1–F2 open nits; F3 wontfix)

## What shipped

Expression-only rewrite of the three quality/asset-class surfaces:

1. **QA 复核 (`qa-review`)** — three-column layout (distribution / issue list /
   evidence); Live Matrix + severity chips + human filters; evidence source/target
   with span wash; **就地修复** via `segment.updateTarget` (Workbench shape) +
   Ctrl+Enter advance; profile as 420px drawer; queue as secondary list group
   (open-segment only). Orchestrator ~648 LOC (was ~1.2k).
2. **导出复核 (`export-review`)** — delivery gate: §A8 blocked/clear banner;
   gate checklist from real `QaGateResult` fields; pre-export
   `document.degradation` + post-export result degradation; override export
   with actor+reason; **查看问题 →** `onNavigate("qa-review")`. Orchestrator
   ~231 LOC (was ~301 with marketing collage).
3. **资产 Surface (`translation-memory` id, label 资产)** — five §E2 tabs
   (TM · terms · curation · alignment · interop); default **养护**; overview
   strip from real `tm.library.list` / `termbase.list` totals; TM + terms hubs;
   mounts existing curation/alignment/interop panels (Insights dual-host kept).

Supporting:

- `components/quality/*` — LiveMatrix, qa-presenters (+ tests), distribution /
  list / evidence / profile / run history, export gate/degradation/actions.
- `components/assets/*` — AssetsSurface, tab list, overview strip, TM/terms hubs.
- Surface CSS: `styles/30-surfaces/quality.css`, `assets.css` (+ index import).
- i18n en + zh for Phase 6 chrome.
- `docs/design-ii/09-implementation.md` §期6 implement record + residuals.
- No Engine / contracts / preload / main / package.json changes.
- Validation (review evidence): `pnpm run typecheck` green; vitest
  `qa-presenters` 8/8 + provenance/curation/alignment utils 13/13.

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | Project lifecycle pointer + new **ORTHO Quality and Assets Surfaces (Phase 6)** 7-section contract (layouts, signatures, gate/fix/assets, wrong/correct). |
| `.trellis/spec/frontend/directory-structure.md` | `components/quality/**` + `components/assets/**` tree; stable panel paths; `quality.css` / `assets.css`. |
| `.trellis/spec/frontend/component-guidelines.md` | Phase 6 extract table + executable contract link. |

## Suggested commit

**Subject:**

```text
feat(ui): ORTHO Phase 6 QA three-column, export gate, assets five tabs
```

**Body:**

```text
Expression-only quality and assets surfaces for desktop:

- QaReviewPage: three-column distribution/list/evidence, Live Matrix from
  loaded issues, in-place target fix via segment.updateTarget, profile drawer
- ExportReviewPage: gate banner + checklist, pre/post degradation lists,
  override export, navigate to qa-review
- AssetsSurface (surface id translation-memory): five tabs default curation,
  TM/terms hubs, dual-host curation/alignment/interop panels

Extracts under components/quality and components/assets.
Surface CSS in styles/30-surfaces/{quality,assets}.css.
i18n en+zh for new chrome. No engine/contracts/preload changes.

Specs: electron-workbench Phase 6 contract; frontend directory + component
guidelines for quality/assets extracts.

Task: 08-08-ortho-frontend-phase-6-quality-assets
```

**Omit from commit:** `.grok/**` dirt (e.g. `.grok/agents/trellis-plan.md`).

**Include:**

- `apps/desktop/src/renderer/QaReviewPage.tsx`
- `apps/desktop/src/renderer/ExportReviewPage.tsx`
- `apps/desktop/src/renderer/WorkbenchPages.tsx`
- `apps/desktop/src/renderer/components/quality/**`
- `apps/desktop/src/renderer/components/assets/**`
- `apps/desktop/src/renderer/i18n/messages.ts`
- `apps/desktop/src/renderer/styles.css` (legacy neutralize as needed)
- `apps/desktop/src/renderer/styles/index.css`
- `apps/desktop/src/renderer/styles/30-surfaces/{quality,assets}.css`
- `docs/design-ii/09-implementation.md` (期6 implement notes)
- `.trellis/tasks/08-08-ortho-frontend-phase-6-quality-assets/**`
- `.trellis/spec/frontend/{electron-workbench,directory-structure,component-guidelines}.md`

## Residual risks (accepted)

1. Live Matrix severity is a projection of **currently loaded** issues
   (PAGE_SIZE 30), capped at 2000 cells — labeled; no aggregation RPC.
2. In-place fix is plain textarea — TagCapsule / tag tooling residual.
3. Export formats beyond original document format residual (honest copy).
4. TM health Live Matrix not driven by real buckets.
5. Review queue: open segment only (no invent accept/reject).
6. Dual-host Insights panels remain; TaskPackage stays Insights-only.
7. Assets tabpanel `aria-labelledby` / tab `id` pairing incomplete (nit F1).
8. `saveAndMaybeAdvance(advance)` dead parameter noise (nit F2).
9. Electron manual smoke (end-to-end QA run, export path dialog, real library
   mounts) not executed in review environment; static + typecheck + unit tests
   cover structural ACs.

## Closeout policy

- Spec updates applied per `trellis-update-spec`.
- Task **not** archived here (Orchestrator / finish-work).
- **No commit** from this worker; Orchestrator commits on
  `implement/ortho-frontend` and merges per autoloop git policy.
