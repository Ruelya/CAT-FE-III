# Implementation plan — Frontend rebuild P3 interop / PDF / task packages

## 1. Execution rules

1. **Engine authority** — rows, pages, images, dispositions, hashes, revisions, and apply results come only from generated RPC results.
2. **No renderer parsers** — never import ZIP/XML/XLSX/PDF decoders in renderer code for product paths.
3. **Save-before-nav + feature ops** — reuse P1/P2 controller helpers; invalidate on reconnect.
4. **Flush before document-mutating P3 applies** — dirty target flush via SaveCoordinator before OCR correct / review apply when Workbench document is open.
5. **Appearance and copy** — light + brown, solid, Phosphor only, no glass, no Lucide, no filler microcopy.
6. **Complete quality** — every shipped panel has empty / loading / error / cancel / success / terminal paths.
7. **No product code outside desktop renderer/tests/fakes** unless a bridge bug is proven (prefer report, not expand scope).
8. Work on branch `task/08-10-frontend-rebuild-p3-interop-pdf` from `refactor/frontend-3`.

## 2. Work packages

### WP0 — Harness and pure helpers

**Goal:** Testable pure logic and fake API surface before UI.

- [ ] Extend `apps/desktop/src/renderer/test/fake-desktop-api.ts`:
  - `selectInteropInput`, `selectTaskPackageInput`, `selectExportPath` controllable.
  - Invoke stubs for `pdf.page.list|get`, `pdf.correctOcr`, `interop.review.*`, `interop.table.*`, `taskPackage.*`, `document.reimport.*`.
- [ ] Add pure modules + unit tests:
  - `state/pdf-review.ts` (+ `.test.ts`)
  - `state/interop-view.ts` (+ `.test.ts`)
  - `state/task-package-view.ts` (+ `.test.ts`)
  - `state/reimport-view.ts` (+ `.test.ts`)
- [ ] Confirm TypeScript types import only from `@translunar/contracts` for Engine shapes.

**Gate WP0:** `pnpm exec vitest run` on new pure tests green; typecheck of pure modules clean.

### WP1 — PDF page review + OCR correct

**Goal:** Workbench PDF dock with list/get/correct.

- [ ] `use-pdf-review.ts`: list on document change; get on visible page; collapse gate; feature op; correctOcr sequence; refresh gateway.
- [ ] `PdfPageReview.tsx` + `PdfOcrCorrectDialog.tsx` (Phosphor, PanelChrome patterns).
- [ ] Compose into `Workbench.tsx` when page list is non-empty **or** document kind/filter indicates PDF (prefer Engine-driven: successful list with pages.length > 0; if list empty/error, hide or show error without fake pages).
- [ ] Segment follow: active segment → page highlight.
- [ ] Unit/hook tests: list→get, collapse no fetch, correct success/conflict, ineligible block, dialog cancel.
- [ ] Styles in `styles.css` / tokens only — solid surfaces, no glass.

**Gate WP1:** vitest PDF hook/pure green; manual or integration smoke with fake API.

### WP2 — Interop review + table

**Goal:** Insights Interop section.

- [ ] Extend `ProjectInsights.tsx` with section nav + Interop mode tabs.
- [ ] `use-interop-controller.ts` + panels for review/table.
- [ ] Wire `tm.library.list` filter for table mode.
- [ ] Export / preview / apply sequences; mode switch clears state; terminal Applied; no Apply 0.
- [ ] Entry from chrome/Project Home to Insights with save-before-nav (existing goInsights path).
- [ ] Tests: eligibility selection, cancel dialog, stale op, apply error retains preview.

**Gate WP2:** vitest interop controller green; Insights renders both modes with fake data.

### WP3 — Offline task packages

**Goal:** Insights Task package section.

- [ ] `use-task-package-controller.ts` + `TaskPackagePanel.tsx`.
- [ ] Export assignment (and return when Engine reference present).
- [ ] Preview paging + cross-page selection merge helper.
- [ ] Apply / import / discard with actor/reason guards and terminal status handling.
- [ ] Post-apply project refresh via app gateway; post-import open project path.
- [ ] Tests: safe-only selection, cross-page IDs, terminal disable, cancel dialog.

**Gate WP3:** vitest task package controller green.

### WP4 — Document reimport

**Goal:** Preview/apply reimport modal from Project Home and/or Workbench.

- [ ] `use-reimport-controller.ts` + modal UI.
- [ ] Path via `selectSourceDocument` (or multi if needed — single path default).
- [ ] Preview plan display; apply confirmation; refresh document/rows on success.
- [ ] Tests: cancel, preview error, apply success, stale op.

**Gate WP4:** vitest reimport green; action visible only with real project/document context.

### WP5 — App wiring, a11y, static quality

- [ ] Ensure feature ops invalidate on reconnect (reuse existing path).
- [ ] Flush before OCR correct and document-affecting applies.
- [ ] Keyboard / aria-label on icon-only controls; focus visible.
- [ ] Grep: no `lucide-react` in `apps/desktop/src/renderer`; no `backdrop-filter` in product CSS.
- [ ] No dead nav to plugins/AI/settings.

**Gate WP5:** static audits clean on touched tree.

### WP6 — E2E and regression

- [ ] Add `apps/desktop/tests/e2e/p3-interop-pdf.spec.ts`:
  - PDF: import/open PDF fixture if environment tools allow; list page image; correct OCR when fixture supports; else skip with clear message and still run interop/task cases.
  - Interop: export review (or fixture path), preview, apply one row when fixtures exist.
  - Table: preview/apply when XLSX fixture exists.
  - Task package: export and preview when Engine supports in test data dir.
  - Assert no page/console errors on happy path; dialog cancel leaves UI stable.
- [ ] Run focused P0/P1/P2 e2e or note orchestrator full gate if time-bound — at minimum do not break unit suite.
- [ ] `pnpm` typecheck + desktop unit tests for renderer.

**Gate WP6:** E2E mission paths documented in review notes; automated tests green for available fixtures.

## 3. Validation commands

Run from repo root (adjust if workspace scripts differ):

```bash
# Unit / integration (renderer)
pnpm exec vitest run apps/desktop/src/renderer --reporter=dot

# Typecheck desktop (use project script if present)
pnpm exec tsc -p apps/desktop --noEmit

# Static hygiene
rg -n "lucide-react" apps/desktop/src/renderer && exit 1 || true
rg -n "backdrop-filter" apps/desktop/src/renderer --glob '*.css' && exit 1 || true

# E2E (environment-dependent)
pnpm exec playwright test apps/desktop/tests/e2e/p3-interop-pdf.spec.ts
```

Prefer existing package scripts (`pnpm test:unit`, `pnpm typecheck`, etc.) when they match CI.

## 4. Risk points

| Risk | Mitigation |
| --- | --- |
| Poppler/Tesseract missing on dev machines | Keep pure/controller tests independent; E2E conditional skip with explicit reason |
| Large base64 PNG in React state | Single-page cache only; clear on document switch |
| App controller growth | Keep orchestration in dedicated hooks; gateway methods only |
| Selection bugs across task package pages | Pure `mergePageSelection` + unit tests |
| Stale preview apply | Always send Engine `previewId` + expected revisions; show typed errors |
| Insights overcrowding | Section nav; analytics remains default |
| Dirty target lost on OCR correct | Flush via SaveCoordinator before correct |

## 5. Definition of done

- All PRD ACs AC1–AC10 met or explicitly fixture-blocked with unit proof and listed residual risk.
- No glass/Lucide regressions; Phosphor icons on new controls.
- Fake DesktopApi complete for P3 methods.
- implement.jsonl paths used as context; no seed-only placeholders.
- Ready for review/verify loop (not closed by implement alone).

## 6. Order of implementation (summary)

```text
WP0 pure + fakes
  → WP1 PDF dock
  → WP2 Interop Insights
  → WP3 Task packages Insights
  → WP4 Reimport modal
  → WP5 a11y/static/wiring polish
  → WP6 E2E
```

Parallelization: WP2 and WP3 can proceed in parallel after WP0 if staffing allows; WP1 independent after WP0.
