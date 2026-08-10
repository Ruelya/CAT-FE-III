# Frontend rebuild P3 — Interop, PDF/OCR, and offline packages

## Status

- Phase: planning
- Parent: `07-19-complete-full-cat-prd`
- Branch: `task/08-10-frontend-rebuild-p3-interop-pdf` (base `refactor/frontend-3`)
- Depends on: shipped P0 vertical slice, P1 project lifecycle, P2 editor + Asset Hub

## Goal

Rebuild the desktop renderer surfaces for **PDF original-page review and OCR correction**, **bilingual review DOCX and table→TM interop**, **offline task packages**, and **document reimport preview/apply**, on the P0–P2 design locks.

Engine methods, package validation, OCR rules, revisions, and merge classifications already exist. P3 wires them through the rebuilt `shell/` · `surfaces/` · `workbench/` · `state/` layout with typed RPC, trusted DesktopApi dialogs, and complete quality for every in-scope workflow.

## Inherited design locks (non-negotiable)

| Lock | Meaning for P3 |
| --- | --- |
| Engine authority | Page images, blocks, dispositions, hashes, revisions, conflict classes, and merge outcomes come only from generated RPC results. Renderer never parses PDF/ZIP/DOCX/XLSX/JSON package bytes or invents row classifications. |
| Save-before-nav | Leaving Workbench for Insights (or other surfaces) runs the same flush/stay boundary as P1/P2. PDF correction and interop/task apply never skip dirty-target flush when navigation is involved. |
| Feature op tokens | Every long-running P3 mutation uses `beginOp` / `isOpCurrent`; reconnect calls `invalidateFeatureOps()` and discards stale completions. |
| Appearance | Light default, advanced-brown accent, solid surfaces, no glass / `backdrop-filter` / `-webkit-backdrop-filter`. |
| Icons | Phosphor only (`@phosphor-icons/react`). No new `lucide-react` in renderer. |
| Copy | No filler microcopy, guiding subtitles, or “不是”-style pivots. Empty/error/busy states are truthful and minimal. |
| Session | Identity-only session-v1; presentation caches are never durable domain stores. |
| IME | Target editor IME/229 contract unchanged. OCR correction uses a separate controlled form, not TargetEditor source mutation. |
| Bridge | Main owns dialogs; renderer receives paths only. Use existing `selectInteropInput`, `selectTaskPackageInput`, `selectExportPath`, and generic invoke. |

## Scope

### In scope

1. **PDF / OCR page review (Workbench)**
   - For documents with Engine PDF page data: list pages (`pdf.page.list`), lazy single-page render (`pdf.page.get`), follow active segment → page.
   - OCR correction form (`pdf.correctOcr`) with non-empty source text + reason, expected revision, only OCR-origin non-confirmed blocks.
   - Collapsed / docked / maximized preview rail; stop fetches when collapsed (content stays mounted/inert).
   - Typed errors keep the editor usable; no managed source path exposure; no full-document image preload.

2. **Bilingual review DOCX interop (Insights)**
   - Export review package (`interop.review.export`) via `selectExportPath`.
   - Open returned DOCX via `selectInteropInput("review")`, preview (`interop.review.preview`), select eligible rows, apply (`interop.review.apply`).
   - Dispositions and diagnostics rendered as Engine returns; checkboxes only for Engine-eligible changed rows.

3. **Bilingual table → TM (Insights)**
   - Open DOCX/XLSX via `selectInteropInput("table")`, preview (`interop.table.preview`), apply (`interop.table.apply`) into a locale-matching writable TM library listed from Engine.
   - No local writability guesses; library revision and locales from Engine list/result only.

4. **Offline task packages (Insights)**
   - Assignment/return export (`taskPackage.export`) with destination path and actor/reason.
   - Preview/import/apply/discard (`taskPackage.preview` | `import` | `apply` | `discard`) with trusted `selectTaskPackageInput` (`.tltask`).
   - Cross-page selection by explicit row IDs; only Engine-safe rows selectable; terminal statuses disable mutations; successful apply refreshes project projection.

5. **Document reimport (document lifecycle entry)**
   - Preview (`document.reimport.preview`) and apply (`document.reimport.apply`) for an active document, with Engine plan/dispositions; no silent overwrite without preview confirmation.
   - Entry from Project Home / Workbench document actions (not a new top-level app surface unless needed for route identity).

6. **Tests and harness**
   - Pure helpers + controller unit/integration tests with feature-op stale guards.
   - Fake DesktopApi coverage for new dialogs and invoke methods.
   - Real-Engine Playwright E2E (`p3-interop-pdf.spec.ts`) covering PDF review/correct, interop review+table happy paths, task package export/preview/apply (or bounded skip when fixtures/tools missing with explicit reason), and no P0–P2 regressions in focused suites.
   - Static: typecheck, no glass, no Lucide in renderer, token/contrast inheritance.

### Out of scope (P3)

| Area | Owner |
| --- | --- |
| Plugins / plugin panels | Later / P4+ |
| AI assistant, credentials UI, cloud OCR | Later |
| Collaboration / multi-user | Later |
| Full settings, theme DIY, accent pickers | P4 |
| Alignment editor algorithm / new Asset Hub domains | P2 already owns alignment surface depth |
| Pixel-perfect PDF rewrite, handwriting, bundling Poppler/Tesseract | Engine/platform |
| Discussion threads / project snapshots UI | Separate product slice if not already covered |
| New Engine protocol methods or filter implementation | Engine already owns methods listed below |

## Engine and DesktopApi surface (authoritative)

### Engine methods (generated contracts only)

| Method | Use |
| --- | --- |
| `pdf.page.list` | Page summaries + segmentIds map |
| `pdf.page.get` | Single-page PNG + blocks |
| `pdf.correctOcr` | OCR source correction → Segment |
| `interop.review.export` | Bilingual review DOCX out |
| `interop.review.preview` | Diff preview before apply |
| `interop.review.apply` | Selected proposals |
| `interop.table.preview` | Table rows → TM preview |
| `interop.table.apply` | Selected valid rows into TM |
| `taskPackage.export` | Assignment/return package write |
| `taskPackage.preview` | Conflict/disposition page |
| `taskPackage.apply` | Selected safe merge |
| `taskPackage.import` | Detached import from package |
| `taskPackage.discard` | Drop staged preview |
| `document.reimport.preview` | Reimport plan |
| `document.reimport.apply` | Commit reimport plan |

Supporting reads as needed: `tm.library.list`, project/document get/list, segment list refresh after mutations — existing P0–P2 paths.

### DesktopApi (already on bridge)

- `selectInteropInput(kind: "review" | "table")`
- `selectTaskPackageInput()`
- `selectExportPath(suggestedName)`
- `invoke` for all Engine methods above
- Existing source/export pickers where reimport or generic export needs them

Do **not** add filesystem read/write from renderer. Extend fake DesktopApi for tests only.

## Requirements

### R1 — PDF page review and OCR correct

- R1.1 When the active document supports PDF pages, Workbench shows a page-review region that lists pages from `pdf.page.list` and loads at most one `pdf.page.get` for the visible/active page.
- R1.2 Active segment focus maps to a page via Engine `segmentIds` on page summaries; React does not parse structural paths to invent page numbers.
- R1.3 Page image is an in-memory data URL from `imagePngBase64`; managed source path is never shown.
- R1.4 OCR correction UI appears only for blocks with OCR source kind and non-confirmed state; requires non-empty `sourceText` and `reason`; sends `expectedRevision` from the block/segment.
- R1.5 Success replaces authoritative segment/row projection from the returned `Segment` (and refresh rows when needed); stale revision shows typed conflict without optimistic revision bump.
- R1.6 Collapse stops further page fetches; maximized/docked states remain keyboard accessible and viewport-contained at 1250×744, 1680×942, 1920×1080.
- R1.7 Non-PDF documents do not show fake page chrome; existing structure/segment position behavior remains truthful.

### R2 — Interop review and table packages

- R2.1 Insights hosts explicit Review DOCX and Table→TM modes; switching mode clears paths, previews, selection, and mode-specific feedback.
- R2.2 Export review uses `selectExportPath` + `interop.review.export` with current document/project revision from Engine.
- R2.3 Preview/apply use generated params only (paths from dialogs, actor/reason, expected revisions, explicit selected row IDs).
- R2.4 Review checkboxes enable only Engine-eligible `changed` rows; table checkboxes only `valid` rows. Never render enabled “Apply 0”.
- R2.5 Applied/terminal preview status disables mutation controls, clears selection as specified by Engine contract, and shows truthful terminal label.
- R2.6 Table mode lists only writable locale-matching TM libraries from Engine; missing libraries disable preview without inventing options.
- R2.7 Failed apply retains preview/path/selection and shows normalized UiError; success refreshes project/document or TM list from Engine.

### R3 — Offline task packages

- R3.1 Assignment export requires project context, actor/reason, destination path, and at least one document/selection rule enforced by Engine validation + UI disable guards.
- R3.2 Return export only when Engine project carries a task-package reference (do not invent eligibility).
- R3.3 Preview/import/apply/discard use trusted `.tltask` path; renderer never opens ZIP or hashes files.
- R3.4 Selection is presentation-only by `rowId` across pages; apply sends complete explicit `selectedRowIds` + `previewId` + `expectedProjectRevision`.
- R3.5 Only rows with Engine `safeToApply` (or equivalent safe flag) are selectable; unsafe rows remain visible with Engine reason.
- R3.6 Terminal preview statuses (`applied`, `discarded`, etc.) make mutation controls read-only; failed apply keeps open preview for retry.
- R3.7 Successful import exposes Engine-returned project binding and opens only after response; successful apply refreshes project snapshot.

### R4 — Document reimport

- R4.1 User can preview reimport for the active document with a path from a trusted picker (reuse source document picker or export-equivalent as design specifies).
- R4.2 Apply requires confirmed preview id / expected revision per contract; partial silent apply is forbidden.
- R4.3 Dispositions (`unchanged` | `changed` | `new` | `removed` | `ambiguous`, etc.) display as Engine returns; ambiguous items are not auto-applied without selection rules from Engine result.

### R5 — Navigation, ops, chrome

- R5.1 Insights remains the existing app surface; extend section/tab local state inside Insights (or dedicated controllers) without bloating the global reducer with full preview payloads.
- R5.2 Entry to Insights from Workbench uses save-before-nav.
- R5.3 Chrome shows only real destinations; no dead roadmap links for plugins/AI/settings.
- R5.4 Feature ops cover PDF correct, interop export/preview/apply, task package export/preview/apply/import/discard, reimport preview/apply.

### R6 — Quality and accessibility

- R6.1 Keyboard paths for page list, correction form, interop/task tables, pagination, and confirm dialogs.
- R6.2 Icon-only controls have accessible names; focus rings visible on light tokens.
- R6.3 No horizontal document overflow at supported viewports; busy states keep control dimensions stable.
- R6.4 No `dangerouslySetInnerHTML` for package HTML; no glass CSS; Phosphor only.

## Acceptance criteria

- [ ] **AC1 — PDF list/get:** Opening a PDF-backed document loads page summaries and displays one rendered page PNG for the active page without preloading all pages; collapse stops further gets.
- [ ] **AC2 — PDF OCR correct:** Correcting an eligible OCR block with reason updates source via `pdf.correctOcr`, refreshes the segment/grid from Engine, rejects empty reason/text client-side, and surfaces stale-revision conflicts without optimistic revision mutation.
- [ ] **AC3 — Interop review:** Export → open → preview shows dispositions; apply one changed row; terminal Applied state; cancel dialog makes no RPC.
- [ ] **AC4 — Interop table:** Preview locale-matching writable TM path; apply valid rows; library list reloads after success; invalid rows not selectable.
- [ ] **AC5 — Task package:** Export assignment package; open via trusted dialog; page rows; select safe rows across pages; apply with actor/reason; refresh project; discard/terminal states disable mutations.
- [ ] **AC6 — Reimport:** Preview plan for a document and apply only after explicit confirmation; Engine dispositions visible; failure keeps prior document usable.
- [ ] **AC7 — Engine authority:** No renderer parse of PDF/ZIP/DOCX/XLSX package content; no invented dispositions, hashes, or page geometry.
- [ ] **AC8 — Ops/nav locks:** Save-before-nav to Insights; feature-op stale completions discarded on reconnect; IME target editor unchanged.
- [ ] **AC9 — Visual contract:** Light + brown + solid + Phosphor + no glass; no filler/guiding copy; no Lucide in renderer.
- [ ] **AC10 — Tests:** Unit/integration cover pure helpers + controllers + fake API; E2E `p3-interop-pdf.spec.ts` (or equivalent) proves real Engine paths for in-scope workflows; typecheck/build green for desktop packages touched.

## Assumptions (prefer complete slice)

| # | Assumption | Confidence |
| --- | --- | --- |
| A1 | Engine methods and DesktopApi dialogs already work on `refactor/frontend-3`; P3 is renderer rebuild only. | High |
| A2 | Interop + task packages live under **Project Insights** (tabs/sections), matching historical product placement and existing `insights` surface. | High |
| A3 | PDF review is a **Workbench** dock/panel, not a separate app surface. | High |
| A4 | Document reimport is a **Project Home / Workbench document action** with modal preview, not a new top-level route. | Medium-high |
| A5 | No new npm dependencies beyond existing Phosphor/React stack. | High |
| A6 | PDF E2E may require Poppler/Tesseract on the machine; if tools missing, E2E documents skip with explicit gate message — unit tests still cover UI state machines. | Medium |
| A7 | Alignment/corpus deep UX remains P2; P3 only uses TM library list for table apply. | High |

## Non-goals reminder

Do not implement plugins, AI, collab, full settings, or theme DIY in this task. Do not weaken Engine authority to “ship a stub panel.” Shrink feature count only if a dependency is truly unavailable; never ship half-wired apply without preview/selection/error paths for an included feature.
