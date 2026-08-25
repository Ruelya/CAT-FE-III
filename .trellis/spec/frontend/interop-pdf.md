# Frontend Interop, PDF/OCR, Task Packages, Reimport (P3)

> **Historical / not current greenfield.** The P3 surfaces described here
> (PDF page review, OCR, interop panels, offline task packages, reimport)
> belonged to the pre-greenfield renderer and were removed in the greenfield
> reset. None of these features exist in the current tree.

## 1. Scope / Trigger

Use this contract when changing:

- Workbench **PDF original-page review** dock and **OCR correction** dialog
- Project Insights **Review DOCX** / **Table→TM** interop panels
- Project Insights **offline task package** export/preview/import/apply/discard
- **Document reimport** preview/apply modal
- Fake DesktopApi P3 dialogs/methods or `tests/e2e/p3-interop-pdf.spec.ts`

P3 extends the P0–P2 renderer **in place**. It does not add a top-level
`SurfaceKind` for PDF or interop. Domain facts (pages, PNG bytes, dispositions,
hashes, revisions, merge outcomes, reimport plan) remain Engine-owned through
generated `lib/rpc` invoke. Renderer owns only dialog paths, selected row IDs,
panel flags, actor/reason/sourceText forms, pagination cursors, and UiError
presentation.

Related: [electron-workbench.md](./electron-workbench.md) (bridge, historical
panel contracts), [project-lifecycle.md](./project-lifecycle.md) (save-before-nav,
feature ops), [editor-assets.md](./editor-assets.md) (P2 controller pattern),
[directory-structure.md](./directory-structure.md).

### Source-backed modules (shipped layout)

| Area | Paths |
| --- | --- |
| Surfaces | `surfaces/Workbench.tsx` (PDF dock gate), `surfaces/ProjectInsights.tsx` (section shell) |
| Insights UI | `insights/InteropReviewPanel.tsx`, `InteropTablePanel.tsx`, `TaskPackagePanel.tsx`, `InsightsSectionNav.tsx` (or consolidated under `insights/`) |
| Workbench UI | `workbench/PdfPageReview.tsx`, `workbench/PdfOcrCorrectDialog.tsx` |
| Import / OCR AI | `lib/pdf-import-options.ts` (`mineruBaseUrl` for official Precision Extract), `lib/mineru-credential.ts`, `state/use-ocr-ai.ts` |
| Pure helpers | `state/pdf-review.ts`, `interop-view.ts`, `task-package-view.ts`, `reimport-view.ts` |
| Orchestration | `state/use-pdf-review.ts`, `use-interop-controller.ts`, `use-task-package-controller.ts`, `use-reimport-controller.ts` |
| App gateway | `use-app-controller.ts` — `goInsights` + flush only; no full preview payloads in global reducer |
| Harness | `test/fake-desktop-api.ts` (P3 dialogs + invoke stubs) |
| E2E | `tests/e2e/p3-interop-pdf.spec.ts` |

---

## 2. Signatures

### Insights local section (not global reducer)

```ts
type InsightsSection = "analytics" | "interop" | "taskPackage";
type InteropMode = "review" | "table";
```

Mode/section switch clears paths, previews, selection, and mode-specific
feedback for the leaving mode.

### DesktopApi (bridge already owns; do not re-parse files in renderer)

```ts
selectInteropInput(kind: "review" | "table"): Promise<string | null>;
selectTaskPackageInput(): Promise<string | null>;
selectExportPath(suggestedName: string): Promise<string | null>;
selectSourceDocument(): Promise<string | null>; // reimport path pick
invoke<M extends EngineMethod>(method: M, params: EngineParams<M>): Promise<EngineResult<M>>;
```

### Engine methods (generated contracts only)

| Method | Use |
| --- | --- |
| `pdf.page.list` | Page summaries + `segmentIds` |
| `pdf.page.get` | Single-page PNG + blocks |
| `pdf.correctOcr` | OCR source correction → `Segment` |
| `interop.review.export` / `preview` / `apply` | Bilingual review DOCX |
| `interop.table.preview` / `apply` | Table → TM |
| `taskPackage.export` / `preview` / `import` / `apply` / `discard` | Offline packages |
| `document.reimport.preview` / `apply` | Document reimport plan |

Supporting reads: `tm.library.list`, project/document get, segment refresh after
mutations (existing P0–P2 paths).

### Pure helper surface (authoritative names)

```ts
// state/pdf-review.ts
function buildSegmentPageIndex(pages: readonly PdfPageSummary[]): Map<string, number>;
function resolvePageForSegment(
  index: Map<string, number>,
  segmentId: string | null,
  fallbackPage: number,
): number;
function pageImageDataUrl(imagePngBase64: string): string;
function isOcrCorrectable(block: { sourceKind: string; state: SegmentState }): boolean;
function canSubmitOcrCorrection(input: {
  sourceText: string;
  reason: string;
  pending: boolean;
}): boolean;
function isNonPdfDocumentListError(error: {
  code?: string;
  message: string;
}): boolean;
function shouldMountPdfDock(input: {
  pageCount: number;
  listStatus: "idle" | "loading" | "ready" | "error";
  listError: { code?: string; message: string } | null;
}): boolean;

// state/interop-view.ts
function eligibleReviewRowIds(rows: readonly { rowId: string; disposition: string }[]): string[];
function eligibleTableRowIds(rows: readonly { rowId: string; disposition: string }[]): string[];
function filterWritableMatchingLibraries(
  libraries: readonly TmLibrary[],
  sourceLocale: string,
  targetLocale: string,
): TmLibrary[];
function canApplySelection(selected: ReadonlySet<string>, status: string): boolean;
function applyButtonLabel(status: string, selectedCount: number): string;

// state/task-package-view.ts
function isSafeSelectableRow(row: { safeToApply?: boolean }): boolean;
function mergePageSelection(
  current: ReadonlySet<string>,
  pageRowIds: readonly string[],
  selectedOnPage: ReadonlySet<string>,
): Set<string>;
function isTerminalTaskPreviewStatus(status: string): boolean;
function canMutateTaskPreview(/* actor, reason, selectedCount, status, pending */): boolean;

// state/reimport-view.ts
function canConfirmReimportApply(input: {
  hasPreview: boolean;
  pending: boolean;
  status: "closed" | "picking" | "previewing" | "planReady" | "applying" | "applied" | "error";
}): boolean;
// Apply is allowed only when status === "planReady" (and hasPreview, not pending).
```

### E2E fixture env keys (honest skip when unset)

| Key | Gates |
| --- | --- |
| `TRANSLUNAR_TEST_PDF` | Real PDF review / OCR path |
| `TRANSLUNAR_TEST_INTEROP_REVIEW` | Review export→preview→apply |
| `TRANSLUNAR_TEST_INTEROP_TABLE` | Table preview path |
| `TRANSLUNAR_TEST_TASK_PACKAGE_INPUT` | Task package open→preview |
| `TRANSLUNAR_TEST_EXPORT_DOCX` | Optional review export destination |

Chrome reachability (Insights interop/task sections, non-PDF hides PDF dock,
reimport open/cancel) must not require those keys.

---

## 3. Contracts

### 3.1 PDF dock mount (critical)

Workbench mounts `PdfPageReview` only when `shouldMountPdfDock` is true:

| list result | Mount? |
| --- | --- |
| `pageCount > 0` | Yes (normal dock) |
| `listStatus !== "error"` and empty pages | **No** (non-PDF idle/ready/loading empty) |
| `listStatus === "error"` and `isNonPdfDocumentListError` | **No** — Engine `pdf.page.list` InvalidRequest on non-PDF (`requires a pdf` / `not a pdf` / …) is **not** dock chrome |
| `listStatus === "error"` and other message | Yes — thin error chrome only (no fake page list) |

Do **not** treat bare `invalid_request` code alone as non-PDF (too broad).

Rules:

- Lazy single-page `pdf.page.get` for visible page only; no full-document preload.
- Collapse stops further gets; content may stay mounted inert.
- Active segment → page via Engine `segmentIds` only; no structural-path page inventing.
- Image is in-memory data URL from `imagePngBase64`; never show managed source path.
- Clicking a page block selects that `segmentId` in the grid. Correct stays a
  separate control and does not auto-select-and-submit.
- OCR correct only for OCR-origin non-confirmed blocks; non-empty `sourceText` +
  `reason` + `expectedRevision`; stale revision → typed conflict, no optimistic
  revision bump.
- Optional AI suggestion in the OCR dialog reuses `ai.run.start` (`freeform`)
  and writes the proposal into the source draft only. It must not call
  `pdf.correctOcr` until the translator supplies a reason and saves.
- Flush dirty target via SaveCoordinator before document-affecting correct when
  Workbench document is open.
- Feature ops: local op token + `featureGeneration` invalidate discards stale
  completions (same pattern as P1/P2 feature domains).

### 3.2 Interop review + table

- Insights hosts explicit Review / Table modes; mode switch resets mode state.
- Paths only from `selectExportPath` / `selectInteropInput`; cancel → no RPC.
- Review checkboxes: disposition `changed` only. Table: `valid` only.
  Never enable **Apply 0**. Terminal `applied` / `discarded` clears/disables apply.
- **Cross-page selection:** first open of a preview seeds eligible IDs for page 0;
  subsequent `preview(offset)` **must** use `mergePageSelection(current, pageRowIds,
  selectedOnPage)` — same helper as task packages. Do **not** replace the full
  set with current-page eligible only.
- Failed apply retains path/preview/selection and shows UiError.
- Table libraries: presentation-filter Engine list for `writable` + locale match only.

### 3.3 Offline task packages

- Export assignment requires documents + actor/reason + destination; return only
  when Engine project carries task-package ref.
- Trusted `.tltask` path via `selectTaskPackageInput` only; no ZIP/hash in renderer.
- Selection by explicit `rowId` across pages via `mergePageSelection`; only
  `safeToApply === true` selectable.
- Terminal preview statuses disable mutations; failed apply keeps open preview
  for retry.
- Success apply refreshes project projection; import opens only after Engine response.

### 3.4 Document reimport

- Entry: Workbench document action (Project Home optional; not required).
- Flow: trusted path → `document.reimport.preview` → plan UI → explicit apply.
- Dispositions rendered as Engine returns; no silent overwrite without preview.
- **Apply failure:** keep `path`/`preview`, set UiError, restore **`status: "planReady"`**
  (not terminal `"error"`), so `canConfirmReimportApply` still allows retry.
  Leaving status at `"error"` blocks Apply while the plan is still open — forbidden.

### 3.5 Navigation / chrome / appearance

- Save-before-nav Workbench → Insights (existing P1 path).
- No glass / `backdrop-filter`; Phosphor only; no new `lucide-react` in renderer.
- No filler microcopy / guiding subtitles.
- No dead nav to plugins / AI / settings.

---

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Non-PDF `pdf.page.list` InvalidRequest | Map to empty-ready; **do not mount** PDF dock |
| Real PDF list/get failure | Thin error chrome; editor remains usable |
| OCR reason/text empty | Disable submit; no RPC |
| OCR AI suggestion | Draft only; Save still requires reason + `pdf.correctOcr` |
| No AI credential | Honest empty state; no `ai.run.start` |
| OCR stale revision | Conflict UiError; keep Engine authority |
| Interop/table dialog cancel | No preview/export RPC |
| Interop page change | Merge selection; retain off-page IDs |
| Interop/table apply fail | Keep preview + selection; show UiError |
| Preview terminal applied | Label Applied; clear selection; disable apply |
| Task package unsafe row | Visible, checkbox disabled |
| Task package dialog cancel | No package RPC |
| Reimport apply fail | Keep plan; `status: planReady`; retry Apply enabled |
| Reimport dialog cancel / closed | No apply; document unchanged |
| Feature op invalidated (reconnect) | Discard stale completion; no optimistic commit |

---

## 5. Good / Base / Bad Cases

### Good

- Open PDF-backed doc → dock lists pages → one PNG for active page → OCR correct
  with reason → segment refresh from Engine `Segment`.
- Non-PDF txt import → Insights reachable → **`pdf-page-review` not in DOM**.
- Export review DOCX → open → preview dispositions → select changed rows on
  two pages → apply explicit IDs → Applied terminal.
- Table: locale-matching writable TM only → apply valid rows → reload library.
- Task package: export assignment → open `.tltask` → cross-page safe selection →
  apply/discard with actor/reason.
- Reimport: preview plan → apply fails once → user retries Apply without re-pick.

### Base

- Cancel any dialog: no RPC; panel usable.
- All-unchanged review / no safe task rows: no enabled Apply 0.
- Collapsed PDF dock: no further `pdf.page.get`.

### Bad

- Parse PDF/ZIP/DOCX/XLSX in React or invent dispositions/page numbers.
- Mount PDF dock on non-PDF list InvalidRequest (fails p3 e2e reachability).
- Replace interop selection with current page only on Next/Previous.
- On reimport apply catch, set `status: "error"` so Apply stays disabled.
- Preload all PDF pages; show managed filesystem path; Lucide/glass CSS.

---

## 6. Tests Required

| Layer | Assertion points |
| --- | --- |
| Pure unit | `shouldMountPdfDock` / `isNonPdfDocumentListError`; OCR eligibility; eligible row IDs; `mergePageSelection`; reimport `canConfirmReimportApply` only `planReady` |
| Controller unit | PDF list→get, collapse gate, correct success/conflict; interop mode clear + multi-page selection; task terminal/disable; **reimport apply fail → planReady retry** |
| Fake DesktopApi | Controllable `selectInteropInput`, `selectTaskPackageInput`, `selectExportPath`, P3 invoke stubs |
| Static | No `lucide-react` under renderer; no `backdrop-filter` in product CSS |
| E2E always | Insights interop + task sections reachable; non-PDF `pdf-page-review` count 0; reimport open/cancel; p0–p2 regression green |
| E2E fixture-gated | PDF / interop review / table / task package real-Engine paths when env keys set; otherwise honest `test.skip` with reason |

Commands (package scripts preferred):

```bash
pnpm --filter @translunar/desktop typecheck
pnpm --filter @translunar/desktop test
pnpm --filter @translunar/desktop build
# cwd apps/desktop
pnpm exec playwright test tests/e2e/p0-*.spec.ts tests/e2e/p1-*.spec.ts tests/e2e/p2-*.spec.ts tests/e2e/p3-interop-pdf.spec.ts
```

---

## 7. Wrong vs Correct

### Wrong — non-PDF mounts error dock

```ts
// Treat any list error as dock-worthy
if (listError) return <PdfPageReview … />;
```

### Correct

```ts
if (
  shouldMountPdfDock({
    pageCount: pages.length,
    listStatus,
    listError,
  })
) {
  return <PdfPageReview … />;
}
// isNonPdfDocumentListError → empty-ready, no mount
```

### Wrong — interop paging wipes selection

```ts
setSelectedRowIds(initialSelectionFromEligible(eligibleOnThisPage));
```

### Correct

```ts
setSelectedRowIds(
  isFirstPageOfPreview
    ? initialSelectionFromEligible(eligibleOnThisPage)
    : mergePageSelection(current, pageRowIds, selectedOnPage),
);
```

### Wrong — reimport apply fail blocks retry

```ts
catch (e) {
  setState({ status: "error", error: toUiError(e), preview }); // canApply false
}
```

### Correct

```ts
catch (e) {
  setState({
    status: "planReady",
    error: toUiError(e),
    preview, // retained
    pending: false,
  });
}
```

---

## Design Decisions

### Design Decision: No new top-level surface for P3

**Context:** PDF, interop, task package, and reimport need homes without growing
the app surface machine.

**Decision:** PDF = Workbench dock; interop + task = Insights sections; reimport =
document-scoped modal. Large preview payloads stay in dedicated controllers, not
the global reducer.

### Design Decision: Shared `mergePageSelection` for interop and task packages

**Context:** Multi-page apply must send complete explicit row IDs.

**Decision:** One pure helper in `task-package-view.ts`; interop controller imports
it. First page seeds eligible; later pages merge.

### Design Decision: Non-PDF list errors are hide, not chrome

**Context:** Engine rejects `pdf.page.list` on non-PDF with InvalidRequest.

**Decision:** Message-based `isNonPdfDocumentListError` + `shouldMountPdfDock`.
E2E asserts zero `pdf-page-review` nodes on txt fixtures.

### Design Decision: Reimport apply error returns to `planReady`

**Context:** Failed apply must keep the plan open for retry (AC6).

**Decision:** Catch path restores `planReady` with retained preview; pure
`canConfirmReimportApply` only allows `planReady`.

---

## Common Mistakes

### Common Mistake: Mount PDF dock on empty ready + any error

**Symptom:** Non-PDF documents show broken PDF chrome; p3 e2e fails.

**Fix:** Use `shouldMountPdfDock`; treat non-PDF messages as hide.

### Common Mistake: Seed selection every page load

**Symptom:** Multi-page Apply only sends current page IDs.

**Fix:** `mergePageSelection` after first page.

### Common Mistake: `status: "error"` after reimport apply failure

**Symptom:** Apply button dead until full re-preview.

**Fix:** Restore `planReady` with preview retained.
