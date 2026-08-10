# Design — Frontend rebuild P3 interop, PDF/OCR, task packages

## 1. Design summary

P3 extends the shipped P0–P2 renderer **in place**. It keeps `App.tsx`, the app reducer/controller, identity-only session-v1, `SaveCoordinator`, feature operation tokens, typed `lib/rpc` invoke, Workbench grid/editor, Asset Hub, and Insights as an app surface.

P3 adds three product areas:

1. **PDF original-page review + OCR correction** as a Workbench dock (lazy page list/get, correction dialog).
2. **Interop Review DOCX + Table→TM** as Insights sections with trusted file dialogs and preview/apply tables.
3. **Offline task packages** as Insights sections (export / preview / import / apply / discard).
4. **Document reimport** as a document-scoped modal workflow (preview plan → apply).

All domain facts remain Engine-owned. React owns only paths from dialogs, selected row IDs, open panel flags, form fields (actor/reason/sourceText), pagination cursors, busy/error/notice, and presentation formatting.

No route library, global state package, XLSX/PDF parser, ZIP library, or appearance framework is required.

## 2. Evidence and fixed constraints

### Evidence (repo)

- Generated contracts: `pdf.page.*`, `pdf.correctOcr`, `interop.review.*`, `interop.table.*`, `taskPackage.*`, `document.reimport.*` in `packages/contracts`.
- Bridge already exposes `selectInteropInput`, `selectTaskPackageInput`, `selectExportPath` (`apps/desktop/src/shared/desktop-api.ts`, preload, main dialogs + filters).
- Renderer layout: `shell/`, `routes/`, `surfaces/`, `workbench/`, `state/`, `lib/`, `tokens.css` — P0–P2.
- Historical behavior contracts (still valid for Engine/UI rules): `.trellis/spec/frontend/electron-workbench.md` sections PDF Review, Bilingual Review And Table Interop, Offline Task Package.
- P1 feature ops + save-before-nav: `project-lifecycle.md`, `use-app-controller.ts`.
- P2 pattern for non-reducer domain controllers: `use-asset-controller.ts` / `use-editor-operations.ts`.

### Inherited locks

- Light + advanced brown + solid + Phosphor + reduced motion + no glass.
- Engine authority; typed UiError; no optimistic durable revisions.
- Save-before-navigation; feature op tokens invalidated on reconnect.
- IME-safe TargetEditor for targets; OCR uses separate form.
- Complete quality for every displayed feature (not stub edges).

## 3. Source boundaries

Exact leaf names may consolidate, but ownership must stay bounded:

```text
apps/desktop/src/renderer/
  surfaces/
    Workbench.tsx                 # compose PdfPageReview dock
    ProjectInsights.tsx           # section shell: analytics | interop | taskPackage
    ProjectHome.tsx               # reimport entry (action)
  workbench/
    PdfPageReview.tsx             # page list + canvas + block overlay chrome
    PdfOcrCorrectDialog.tsx       # reason + sourceText form
  insights/                       # optional folder; may live under surfaces/
    InteropReviewPanel.tsx
    InteropTablePanel.tsx
    TaskPackagePanel.tsx
    InsightsSectionNav.tsx
  state/
    pdf-review.ts                 # pure: page map, active page from segment, data URL
    interop-view.ts               # pure: eligible row filters, selection guards
    task-package-view.ts          # pure: safe row selection, terminal status guards
    reimport-view.ts              # pure: disposition presentation / selection
    use-pdf-review.ts             # orchestration + feature ops
    use-interop-controller.ts
    use-task-package-controller.ts
    use-reimport-controller.ts
    use-app-controller.ts         # gateway: goInsights, flushOrStay, session refresh only
  test/
    fake-desktop-api.ts           # implement new dialogs + invoke stubs
apps/desktop/tests/e2e/
  p3-interop-pdf.spec.ts
```

| Boundary | Owns | Must not own |
| --- | --- | --- |
| App controller | Surface transitions, save-before Insights, generation, invalidate feature ops, post-mutation session refresh gateways | Full interop/task preview payloads, PDF image cache policy details |
| PDF review hook | Page list/get sequencing, correctOcr, dock collapse fetch gate, segment→page follow | PDF parsing, OCR engines, inventing bboxes |
| Interop controller | Mode state, dialogs, preview paging, selection, export/apply sequences | DOCX/XLSX parse, disposition inventing |
| Task package controller | Export/preview/import/apply/discard, cross-page selection, terminal UI | ZIP/hash, merge ranking |
| Reimport controller | Preview/apply modal sequence, confirmation | Filter re-extraction logic |
| Pure helpers | Maps, eligibility, selection set ops, status predicates | RPC, React effects |
| Presentational panels | Layout, a11y, controlled inputs, intent callbacks | `window.translunar` (prefer callbacks from hooks) |

## 4. Surface and state model

### 4.1 App surface

Prefer **no new top-level `SurfaceKind`**. Extend Insights local section:

```ts
// ProjectInsights local / controller
type InsightsSection =
  | "analytics"      // existing P1 summary
  | "interop"        // review + table submodes
  | "taskPackage";

type InteropMode = "review" | "table";
```

PDF review does not change `AppSurface`; it is Workbench UI state keyed by `documentId`.

Reimport is a modal over Project Home / Workbench; if route identity is needed for deep tests, store only `{ reimportOpen: boolean }` in local controller state, not global reducer blobs.

### 4.2 Local discriminated states (representative)

**PDF**

```text
idle
listing → listed | listError
pageLoading(page) → pageReady | pageError
correcting → corrected | correctError | correctConflict
collapsed | docked | maximized   // orthogonal presentation flags
```

**Interop**

```text
empty
exporting → exported | exportError
pathChosen
previewing → previewOpen | previewError
applying → applied | applyError
```

Mode switch resets to empty for that mode.

**Task package**

```text
empty
exporting → exported | exportError
previewing → previewOpen | previewError
importing → imported | importError
applying → applied | applyError
discarding → discarded | discardError
```

Terminal Engine preview statuses force controls read-only regardless of local busy.

**Reimport**

```text
closed
pickingPath
previewing → planReady | previewError
confirmingApply → applied | applyError
```

### 4.3 What stays out of the global reducer

- Base64 PNG strings and block arrays
- Full interop/task preview row pages
- Selected ID sets
- Actor/reason form strings

Global reducer may only know Insights is open + project identity (already true for `insights` surface).

## 5. Data flows

### 5.1 PDF page review

```text
Workbench active documentId
  → pdf.page.list { documentId }
  → summaries[] (page, segmentIds, ocrBlockCount, …)
  → resolveActivePage(activeSegmentId, summaries)
  → if expanded && page changed: pdf.page.get { documentId, page, dpi? }
  → data URL from imagePngBase64; render blocks for overlay/highlight
  → user opens OCR correct on eligible block
  → pdf.correctOcr { segmentId, sourceText, reason, expectedRevision }
  → Segment result → gateway refresh rows / patch grid
```

Rules:

- Cancel/collapse: no further get; keep last image optional for transition (inert when collapsed).
- Never preload N pages in parallel beyond the visible one (optional adjacent prefetch is **out of scope** — single page only).
- Follow segment: when active segment changes, recompute page; if same page, update highlight only.

### 5.2 Interop review

```text
selectExportPath → interop.review.export
selectInteropInput("review") → path
interop.review.preview { path, project/document ids, revisions, offset, limit, actor?, …per contract }
  → rows + previewId + dispositions
user toggles eligible row IDs
interop.review.apply { previewId, selectedRowIds, expected revisions, actor, reason }
  → success → refresh document/project; mark terminal Applied
```

### 5.3 Interop table

```text
tm.library.list (project) → filter writable + locale match (presentation filter on Engine fields only)
selectInteropInput("table") → path
interop.table.preview { path, libraryId, locales, expectedLibraryRevision, … }
interop.table.apply { previewId, selectedRowIds, … }
  → success → reload library page / notice
```

### 5.4 Task package

```text
Assignment:
  selectExportPath / task-specific destination dialog → taskPackage.export { kind: "assignment", … }

Open package:
  selectTaskPackageInput → packagePath
  taskPackage.preview { packagePath, offset, limit, actor, reason }
  page with same previewId

Apply:
  taskPackage.apply { previewId, expectedProjectRevision, selectedRowIds, actor, reason }

Import detached:
  taskPackage.import { previewId, … } → open returned project via existing open project path

Discard:
  taskPackage.discard { packageId, previewId?, actor, reason }
```

### 5.5 Reimport

```text
selectSourceDocument (or multi if contract allows single path) → path
document.reimport.preview { documentId, path, … }
  → plan items + dispositions
user confirms allowed items per Engine selection rules
document.reimport.apply { … expected revisions / preview identity }
  → refresh document + rows
```

## 6. Contracts and pure helpers

### 6.1 PDF pure (`pdf-review.ts`)

```ts
function buildSegmentPageIndex(
  pages: readonly PdfPageSummary[],
): Map<string, number>;

function resolvePageForSegment(
  index: Map<string, number>,
  segmentId: string | null,
  fallbackPage: number,
): number;

function pageImageDataUrl(imagePngBase64: string): string;

function isOcrCorrectable(block: {
  sourceKind: string;
  state: SegmentState;
}): boolean;

function canSubmitOcrCorrection(input: {
  sourceText: string;
  reason: string;
  pending: boolean;
}): boolean;
```

### 6.2 Interop pure (`interop-view.ts`)

```ts
function eligibleReviewRowIds(rows: readonly { rowId: string; disposition: string }[]): string[];
function eligibleTableRowIds(rows: readonly { rowId: string; disposition: string }[]): string[];
function canApplySelection(selected: ReadonlySet<string>, status: string): boolean;
function isTerminalPreviewStatus(status: string): boolean;
function filterWritableMatchingLibraries(
  libraries: readonly TmLibrary[],
  sourceLocale: string,
  targetLocale: string,
): TmLibrary[];
```

Dispositions are string-compared to Engine values (`changed`, `valid`, etc.) — never invent synonyms.

### 6.3 Task package pure (`task-package-view.ts`)

```ts
function isSafeSelectableRow(row: { safeToApply?: boolean; disposition?: string }): boolean;
function mergePageSelection(
  current: ReadonlySet<string>,
  pageRowIds: readonly string[],
  selectedOnPage: ReadonlySet<string>,
): Set<string>;
function isTerminalTaskPreviewStatus(status: string): boolean;
function canExportAssignment(input: {
  hasDocuments: boolean;
  actor: string;
  reason: string;
  pending: boolean;
}): boolean;
```

### 6.4 Feature ops

Reuse app-controller tokens:

- Domains: `pdf`, `interop`, `taskPackage`, `reimport` (or one Insights op counter + pdf separate — implementer may mirror P2 multi-ref pattern).
- Every async completion checks `isOpCurrent` before setState.
- Reconnect: existing `invalidateFeatureOps()`.

### 6.5 Save-before-nav

```text
Workbench → Insights:
  flushOrStay() → if false, stay on workbench
  else goInsights(section?)

Insights internal tab switches:
  no Workbench flush required (no target editor)

PDF correct / interop apply:
  do not navigate away; optional soft-flush of dirty target before OCR correct is recommended if active segment is dirty (use SaveCoordinator flush for active row when design prefers consistency with editor mutations)
```

**Decision:** Before `pdf.correctOcr` and before interop/task apply that can rewrite the open document, call the same `flushOrStay` / save coordinator path used by editor mutations so dirty targets are not silently discarded. If flush fails, abort the P3 mutation.

## 7. UI composition

### 7.1 Workbench PDF dock

- Placement: existing preview column / secondary rail (match P0 structure density).
- Page thumb list (index + ocr badge counts from summaries only).
- Canvas: PNG + optional block outline for active segment.
- Correct command on eligible block → modal/dialog with source textarea + reason + Save/Cancel.
- PanelChrome for collapse/maximize; Phosphor icons.

### 7.2 Insights sections

- Section nav: Analytics | Interop | Task package (labels short; no marketing blurbs).
- Interop sub-tabs: Review | Table.
- Shared patterns with Asset exchange: path field (read-only display of basename if Engine/path policy allows showing path — prefer showing only user-selected path string from dialog, never managed internal paths), Preview, paged table, Apply, actor/reason fields.
- Confirm dialogs for apply/discard (accessible `ConfirmDialog` / `ModalDialog` from shell).

### 7.3 Reimport

- Action on Project Home document row or Workbench document menu: “Reimport”.
- Modal: pick file → preview table of dispositions → Apply / Cancel.

## 8. Error matrix (condensed)

| Condition | Behavior |
| --- | --- |
| Dialog cancel | No RPC; keep prior state |
| Empty actor/reason where required | Disable mutation; keep rows visible |
| Page get fails | Editor remains usable; show typed preview error |
| OCR empty fields | No RPC |
| Stale revision | Conflict error; retain Engine state |
| Non-eligible row | Checkbox disabled |
| Terminal preview status | Mutations disabled |
| Feature op stale | Discard completion |
| Reconnect mid-flight | Invalidate ops; user re-triggers |
| Missing OCR tools (E2E env) | Engine typed error; UI shows error — do not fake success |

## 9. Testing design

| Layer | Coverage |
| --- | --- |
| Pure unit | page index, eligibility, selection merge, terminal predicates, library filter |
| Hook/controller | fake DesktopApi sequences: list→get→correct; export→preview→apply; task page selection; reimport; stale op |
| Integration | App Insights entry with save-before; mode switch clears state |
| E2E | Real Engine: PDF fixture if tools present; interop DOCX/XLSX fixtures; `.tltask` if available; screenshots optional at three widths |
| Static | tsc, no glass/Lucide grep, ESLint on touched files |

Fake DesktopApi must implement:

- `selectInteropInput`, `selectTaskPackageInput`, `selectExportPath` return controllable paths/null.
- `invoke` handlers for all P3 methods with fixture results.

## 10. Trade-offs

| Option | Choice | Why |
| --- | --- | --- |
| New app surface vs Insights tabs | Insights tabs | Matches historical product placement; avoids reducer bloat |
| PDF as separate route | Workbench dock | Page review is document-contextual with segment follow |
| Prefetch adjacent PDF pages | No | Bounded memory and simpler correctness |
| Parse packages in renderer for “snappier” UI | Never | Engine authority lock |
| Absorb P3 into use-app-controller | Separate hooks | Controller already large (P2 lesson) |
| Theme settings | Out | P4 |

## 11. Rollback

- P3 is frontend-only. Revert the task branch commits to remove Insights sections, PDF dock, controllers, and E2E.
- No protocol migration. No storage schema change.
- Feature flags are not required if ship is branch-gated; if partial merge is needed, hide Insights interop/task sections and PDF dock behind absence of UI entry points only (do not leave dead nav).

## 12. Ready criteria for implement

- PRD acceptance criteria testable.
- Method list matches generated contracts (this design).
- implement.md checklist ordered with validation commands.
- implement.jsonl / check.jsonl list real specs.
- `research_needed: []` — Engine + bridge + historical contracts are sufficient.
