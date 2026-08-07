# Electron Workbench Contract

## 1. Scope / Trigger

Use this contract for `apps/desktop`, preload APIs, Electron lifecycle, Vite
packaging, React workbench state, panel interactions, or desktop tests.

Electron owns operating-system integration and presentation orchestration. It
does not own segment transitions, QA, TM, segmentation, persistence, or counts.

## 2. Signatures

The only renderer bridge is `DesktopApi`:

```typescript
export interface DesktopApi {
  invoke<Method extends EngineMethod>(
    method: Method,
    params: EngineParams<Method>,
  ): Promise<EngineResult<Method>>;
  selectSourceDocument(): Promise<string | null>;
  selectSourceDocuments(): Promise<string[]>;
  selectSourceFolder(): Promise<string | null>;
  selectProjectArchive(): Promise<string | null>;
  selectProjectArchiveDestination(
    suggestedName: string,
  ): Promise<string | null>;
  selectExportPath(suggestedName: string): Promise<string | null>;
  selectInteropInput(kind: "review" | "table"): Promise<string | null>;
  resolveDroppedPaths(files: readonly File[]): string[];
  restartEngine(): Promise<void>;
  setAiCredential(profileId: string, secret: string): Promise<void>;
}
```

IPC channels are main/preload-private constants. Main accepts engine methods
only when they exist in generated `ENGINE_METHODS`, and it verifies the sender
is the current main window.

The tested host toolchain is Node 24.x for development plus Node 22.17+ within
major 22 for the retained release lane, pnpm 10.18.3, Electron 41.10.3,
TypeScript 6, Vite 8, React 19, and Playwright 1.61. Node 23, Node 25, and other
majors are rejected. The workspace signature is:

```text
pnpm bootstrap   # frozen install + Rust engine build + desktop build
pnpm dev:desktop # Vite/tsc watches + Electron
```

The main-process E2E delay seam uses three process-only environment keys:

| Key | Value |
| --- | --- |
| `TRANSLUNAR_TEST_ENGINE_DELAY_METHODS` | Comma-separated generated Engine method names |
| `TRANSLUNAR_TEST_ENGINE_DELAY_MS` | Requested delay in milliseconds; runtime-capped at 10,000 |
| `TRANSLUNAR_TEST_ENGINE_DELAY_LIMIT` | Maximum number of matching invocations to delay |

## 3. Contracts

- BrowserWindow uses `contextIsolation: true`, `nodeIntegration: false`, and
  `sandbox: true`. Preload exposes only `DesktopApi` through contextBridge.
- Main owns file dialogs and the engine child process. Renderer receives paths
  selected by main and never imports Node filesystem APIs.
- Startup must use a non-blocking `void bootstrap()` call. Do not top-level
  await `app.whenReady()`; Playwright's Electron loader temporarily controls
  that promise and top-level await deadlocks launch before Chromium DevTools.
- Production renderer assets must use Vite `base: "./"`; `loadFile()` cannot
  resolve `/assets/...` from a local file URL.
- `scripts/check-node-version.mjs` accepts only Node 22.17+ within major 22 and
  Node 24.x. Electron 41.10.3 must resolve `@electron/get@5` and
  `@electron-internal/extract-zip@1.0.4` or newer; clean installs run
  `pnpm electron:install:check` to validate the runtime inventory and launch
  the Electron executable under a hard timeout. `onlyBuiltDependencies:
  [electron]` belongs in `pnpm-workspace.yaml`.
- Engine responses replace persisted display state. React owns only ephemeral
  UI state such as search/filter, active segment, toast, save indicator, stack
  assistant-open, and panel presentation modes.
- IME composition is tracked per segment. Ctrl/Cmd+Enter must do nothing during
  composition; focus advances only after save and confirmation succeed.
- After ORTHO Phase 4, the Stack (former Suggestions) primary chrome is
  **expanded (`docked`) ↔ collapsed rail** with a single collapse control.
  Stored `suggestionsMode: maximized` clamps to `docked` on read. Preview may
  still use `docked` / `collapsed` / `maximized`. See
  [ORTHO Stack Dual-Pane and Preview Dock (Phase 4)](#ortho-stack-dual-pane-and-preview-dock-phase-4).
- Leaving the workbench for QA, export, TM, or setup must call the shared
  persist-all path before unmount. The parent then reloads project, segment,
  and QA projections through RPC; a review page never receives a stale copy of
  debounced renderer state.
- Collapsed panel content stays mounted for the exit animation but becomes
  `inert` and `aria-hidden`. Focus hands off to the visible expand control;
  expanding returns focus to the collapse control. Do not use `display: none`
  for the animated shell.
- Preview height is presentation state clamped to 120-320 CSS pixels. Pointer
  resize and the separator keyboard contract (`ArrowUp`, `ArrowDown`, `Home`,
  `End`) update one shared value. Invalid disposable preferences fall back to
  docked panels, 200 pixels, and follow-active enabled.
- The offline Assistant is renderer-only. It may own deterministic local
  conversations and synthetic usage fixtures, but it never adds a preload
  method or implies a network model request. Target insertion must reuse the
  normal segment update path.
- QA/review pages render generated `qa.*`/`review.*` projections. Report and
  original-format destinations use the shared generic save dialog; its title
  and extension filter follow the suggested filename rather than assuming
  DOCX. A blocked delivery reveals override inputs only after an explicit
  choice and sends actor/reason only when `qa.gate.check` is blocked.
- The project review-policy control persists `reviewRequired` through
  `project.update`. When it is false, a translation-to-signed command opens an
  actor/reason dialog and sends both through `segment.workflow.set`; closing or
  failing that dialog must not imply a successful sign-off.
- Loading-state E2E may use the three `TRANSLUNAR_TEST_ENGINE_DELAY_*` keys to
  pause selected calls immediately before the real `Engine.call`. The seam
  never replaces IPC, changes request/response payloads, adds a renderer API,
  or bypasses the stdio Engine. A matching call consumes one delay from the
  process-local limit; absent, non-finite, non-positive, exhausted, or
  non-matching configuration adds no delay.

## 4. Validation & Error Matrix

| Condition                                         | Required behavior                                               |
| ------------------------------------------------- | --------------------------------------------------------------- |
| IPC sender is not the active window               | Reject with `Rejected IPC from an unknown renderer.`            |
| Method is not in generated `ENGINE_METHODS`       | Reject before writing to engine stdin                           |
| Source/export dialog is canceled                  | Resolve `null`; do not call import/export                       |
| Engine exits with pending requests                | Reject all pending calls and retain stderr tail in the error    |
| Save returns a revision conflict                  | Show the typed error; do not invent a successful revision/state |
| Confirm occurs during IME composition             | No RPC and no focus movement                                    |
| Engine restart/reload finds a stored session      | Reload project, segments, and QA through RPC                    |
| Local session references missing data             | Remove the session key and return to setup                      |
| Renderer file assets use absolute `/assets` paths | Build is invalid for Electron `loadFile()`                      |
| Navigation encounters a pending-save failure      | Stay in Workbench and show the typed save error                 |
| Stored panel preference is missing or invalid     | Use docked/docked, 200px, and follow-active defaults            |
| A panel enters `collapsed`                         | Hide it from AT/tab order, animate it out, then focus expand     |
| Test delay is absent, invalid, or exhausted        | Invoke the real Engine immediately                              |
| Test delay exceeds 10,000 ms                       | Delay at most 10,000 ms, then invoke the real Engine            |

## 5. Good / Base / Bad Cases

- Good: edit target -> debounced revision save -> engine acknowledgement ->
  confirm -> engine aggregate -> focus next visible editor.
- Base: no stored session renders project setup; canceled file selection leaves
  setup unchanged.
- Good: at 1250x744 the editor ends before Suggestions, status text stays
  inside its column, and panel collapse/maximize transitions retain controls.
- Good: edit a target and immediately open QA review; the debounce is flushed,
  the review projection reloads, and returning to the segment shows the saved
  target.
- Bad: derive QA counts from visible rows or duplicate the number rule in
  TypeScript.
- Bad: call `setSurface("qa-review")` while target timers or update promises
  are pending.
- Bad: animate a panel by removing its subtree; the reverse transition, focus,
  and accessible state become discontinuous.
- Bad: exact CSS string checks such as `width === "48px"`; Windows DPI can
  return `47.9911px`. Assert a numeric tolerance or geometry boundary.
- Good: delay only `tm.lookupExact` for one bounded invocation, observe the
  runtime loading region, then assert the settled real Engine projection.
- Base: omit all delay keys and preserve normal production timing.
- Bad: mock `DesktopApi.invoke` or return synthetic Engine data merely to keep
  a loading screenshot stable.

## 6. Tests Required

- Vitest collects only `src/**/*.test.ts(x)`; Playwright specs must never be
  included in the unit runner.
- Strict typecheck covers electron, renderer, and `tsconfig.e2e.json`.
- Electron E2E uses an isolated data directory and real Rust process. It must
  verify import, editable Chinese target, saved draft restart recovery, IME
  guard, confirm-and-advance, TM, 30/60 QA evidence, QA resolution, export, and
  all panel modes.
- Run E2E on Windows and under Xvfb. Capture 1250x744, 1680x942, and 1920x1080
  default/collapsed/maximized screenshots, assert no renderer console/page
  errors, and check editor/Suggestions and status/source boundaries.
- Assert at least one intermediate width in each Suggestions transition; final
  geometry alone cannot detect an abrupt hide followed by a delayed resize.
- Cover Assistant model/reasoning defaults, conversation create/select/archive,
  all seven tooltip metrics, target insertion, and absence of horizontal
  transcript overflow at the compact breakpoint.
- Cover save-before-navigation and real QA/TM/export projections with the Rust
  engine process, not renderer mocks.
- Cover QA profile clone/regex, project/document runs, HTML/XLSX buttons,
  waive/revoke/navigation, review policy/direct sign-off, blocked export and
  override at 1250x744, 1680x942, and 1920x1080 with no horizontal overflow.
- Production build must be part of E2E so `base: "./"`, preload output, and
  Electron main output are exercised.
- The E2E harness may set `TRANSLUNAR_ENGINE_PATH` to a synchronized test
  binary; the default path remains the workspace debug engine. This override
  must not add a renderer API or bypass the real stdio process.
- Tests using the Engine delay seam must name generated methods, set a finite
  positive delay and limit, assert the runtime loading state before settlement,
  and still assert the final real Engine result. At least one test must verify
  that the configured limit is bounded to the intended invocation count.

## 7. Wrong vs Correct

### Deterministic runtime loading evidence

#### Wrong

```typescript
await page.addInitScript(() => {
  window.translunar.invoke = async () => ({ items: [] });
});
```

#### Correct

```typescript
env: {
  TRANSLUNAR_TEST_ENGINE_DELAY_METHODS: "tm.lookupExact",
  TRANSLUNAR_TEST_ENGINE_DELAY_MS: "6000",
  TRANSLUNAR_TEST_ENGINE_DELAY_LIMIT: "1",
}
// The test observes loading, then awaits the real Engine-backed result.
```

### Electron startup and asset loading

#### Wrong

```typescript
// Deadlocks Playwright Electron launch while its loader owns whenReady().
await app.whenReady();
createWindow();
```

```typescript
// Produces file:///assets/... under Electron loadFile().
export default defineConfig({ root: rendererRoot });
```

#### Correct

```typescript
void bootstrap().catch((error: unknown) => {
  console.error("Failed to start Translunar Desktop.", error);
  app.exit(1);
});

async function bootstrap(): Promise<void> {
  await app.whenReady();
  // Start/initialize engine before exposing IPC or creating the window.
}
```

```typescript
export default defineConfig({
  base: "./",
  root: rendererRoot,
});
```

### Navigation and panel state

#### Wrong

```typescript
// Unmounts before the debounced edit reaches the engine.
onClick={() => setSurface("qa-review")}
```

```css
/* Removes the reverse animation and leaves focus without a visible owner. */
.suggestions-collapsed .suggestions-content {
  display: none;
}
```

#### Correct

```typescript
async function navigateToSurface(surface: AppSurface): Promise<void> {
  await persistAllSegments();
  await onNavigate(surface); // Parent reloads authoritative RPC projections.
}
```

```css
.suggestions-collapsed .suggestions-content {
  opacity: 0;
  transform: translateX(12px);
  pointer-events: none;
}
```

### Asset RPC Additions

TM/termbase library, search, concordance, and exchange operations are additive
entries in the generated `ENGINE_METHODS` catalog. The existing generic
`DesktopApi.invoke` is sufficient; do not add a renderer-specific preload
bridge or duplicate the Rust matching/format rules. Asset pages must render
the returned `items`/`matches` pages and surface typed `not_found`, `conflict`,
and row-diagnostic `invalid_request` errors without reading SQLite or local
exchange files from React.

## Project Lifecycle Desktop Surface

### 1. Scope / Trigger

Use this contract for the project home, three-step setup wizard, project
insights page, template editor, global search, archive/recycle actions, source
re-import, and project-level analysis/analytics. The renderer orchestrates
these surfaces; the Engine remains authoritative for project identity,
documents, revisions, diagnostics, search visibility, archive validity, and
metrics.

### 2. Signatures

The renderer calls generated `DesktopApi.invoke` methods for
`project.list/get/create/update`, `project.batchImport`, `project.template.*`,
`document.list`, `document.reimport.preview/apply`, `search.global`,
`recycle.*`, `history.list`, `analysis.profile.list`, `analysis.run/get`,
`project.analytics.get`, and `project.archive.export/restore`.

The trusted bridge owns the file boundaries:

```typescript
selectSourceDocument(): Promise<string | null>;
selectSourceDocuments(): Promise<string[]>;
selectSourceFolder(): Promise<string | null>;
selectProjectArchive(): Promise<string | null>;
selectProjectArchiveDestination(
  suggestedName: string,
): Promise<string | null>;
resolveDroppedPaths(files: readonly File[]): string[];
```

Project navigation uses an explicit selection contract:
`onOpen(projectId, documentId?, segmentId?, segmentOrdinal?)`. The parent loads
the project/document and persists the session selection; a segment ordinal is
only a bounded page hint and never a renderer-derived document position.
Project Home requests `project.list` with a bounded `offset`/`limit` and must
render deterministic previous/next controls when `total` exceeds the page.

### 3. Contracts

- With no valid stored session, `App` renders Project Home first. A valid
  session restores the Engine-backed workspace; a missing/recycled project,
  malformed JSON, or an incomplete session shape removes the session key and
  returns to Home before any editor projection is requested.
- Leaving `Workbench` for Home awaits its shared `persistAllSegments` path
  before clearing the session. Leaving for Insights already occurs through
  the same save-before-navigation boundary. A failed flush keeps the current
  workspace mounted and displays the typed error.
- Project Home lists bounded Engine `project.list`/`project.get` projections.
  `document.list`, analytics, and counts are rendered as returned; React does
  not estimate progress, effort, retention, or history. Search pages through
  Engine offsets and sends the projection field identifiers exactly as
  `source`, `target`, `project`, `document`, `comment`, and `note`; UI labels
  must not invent aliases such as `project_name`. Snippets are rendered by
  parsing only balanced `<mark>` pairs into text and `<mark>` nodes, never
  `dangerouslySetInnerHTML`.
- Project Home and Workbench global search share one result/controller surface
  and one `search.global` request shape. Workbench result selection awaits the
  owning `persistAllSegments` path before calling
  `onOpen(projectId, documentId?, segmentId?, segmentOrdinal?)`; a rejected
  flush leaves the Workbench, draft, and search layer mounted. The global
  search shortcut is `Ctrl+Shift+K` so the established `Ctrl+K` command-palette
  contract remains intact. After ORTHO Phase 2 the Workbench masthead has **no
  permanent global-search control**; the shortcut and panel remain the only
  Workbench entry. Closing search must restore focus to a stable remaining
  Workbench owner (typically the editor region).
- Template editing starts from a recursive clone of the complete safe
  definition. The clone preserves unrendered safe fields such as `pipelineId`,
  QA/TM/termbase references, editor defaults, and future extensions while
  dropping credential/secret keys and private source payloads at every nested
  level. Visible fields overlay that sanitized clone on save; credentials and
  private source content are never displayed or serialized by the renderer.
- Setup has explicit `template`, `required`, and `optional` review-policy
  states. A blank template/analysis override inherits the Engine-resolved
  template value (then the standard analysis profile); selecting a template
  clears stale explicit overrides. Dependency diagnostics remain visible in
  Setup until the user explicitly chooses `Open workspace`; they must not be
  hidden by automatic navigation. Mixed batch diagnostics keep every result,
  including successful documents that can be opened after partial failure.
- Archive publication obtains its destination through
  `selectProjectArchiveDestination`; the renderer never writes files and must
  not reuse a document-export filter. Restore uses the open-archive dialog and
  refreshes the Home list only after the Engine response succeeds.
- Recycle, restore, purge, archive, and re-import confirmations use an
  accessible in-app dialog. The dialog stays mounted, disables duplicate
  actions, and retains the action/error state until the awaited RPC resolves;
  no browser-native `confirm` is used. Re-import apply sends the preview ID
  and expected document revision returned by the preview, then reloads the
  authoritative workspace projections.
- Insights displays Engine-provided stale analysis and unavailable optional
  history/asset metrics as explicit states. It never turns missing history
  into zero and never introduces billing, rate, currency, quote, or invoice
  copy.
- After ORTHO Phase 5, Project Home / Setup / Insights presentation follows
  the layout and extract contracts in
  [ORTHO Project Surfaces (Phase 5)](#ortho-project-surfaces-phase-5).
  Expression-only: no new Engine methods, preload fields, or invented
  cross-project analytics. Optional overview deep-links (`onOpenQa`,
  `onOpenAiControl`) remain additive parent callbacks with residual copy
  when unwired.
- After ORTHO Phase 6, QA review / export review / Assets presentation
  follows
  [ORTHO Quality and Assets Surfaces (Phase 6)](#ortho-quality-and-assets-surfaces-phase-6).
  Expression-only: same Engine QA/export/TM/term/curation/alignment/interop
  methods; Spine id `translation-memory` kept; no invented gate fields,
  export formats, or full-document severity aggregation RPC.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No stored session or invalid/recycled session | Show Home; remove only the invalid session key |
| Malformed session JSON/shape or a `trash` project snapshot | Remove the session key and do not request editor rows |
| Pending Workbench save rejects while leaving | Keep Workbench mounted; show the typed save error; do not clear selection |
| Pending Workbench save rejects while opening a global-search result | Keep the Workbench, draft, and search layer mounted; show the normalized Engine error |
| Canceled source/archive dialog | Keep the current surface; make no create/import/export/restore RPC |
| Mixed batch result | Render every diagnostic and retain successful document IDs for explicit opening |
| Template dependency diagnostics | Keep Setup visible with diagnostics and an explicit `Open workspace` action |
| Template edit | Preserve all unrendered safe definition keys; never send credentials/source content |
| Search snippet contains unbalanced or markup-like text | Render it as text; only balanced Engine `<mark>` pairs become highlights |
| Search field filter selected | Send the Engine projection value (`project`, `document`, `note`, etc.), not the display label |
| Project `total` exceeds the page limit | Show deterministic offset paging; never silently hide later projects |
| Re-import preview is stale or apply conflicts | Keep the preview/current workspace; show the typed conflict; make no optimistic mutation |
| Destructive RPC pending or failing | Keep confirmation dialog mounted and busy/error state visible; close only after success or cancel |
| Archive destination exists or archive is malformed | Surface Engine error; leave destination/workspace unchanged; refresh Home only on success |
| Analysis/history metric unavailable or stale | Display `Unavailable`/stale state from the payload, never a fabricated zero |

### 5. Good / Base / Bad Cases

- Good: start at Home, create a multi-file project, inspect mixed diagnostics,
  explicitly open a successful document, search a highlighted segment, return
  Home after a flushed edit, and reopen the same project after restart.
- Good: edit a template containing hidden pipeline/TM fields, save a visible
  locale change, and verify the hidden fields remain in the next revision.
- Good: reopen with malformed and recycled session keys, then page a project
  list past its first bounded page and filter project/document names.
- Base: cancel a file/archive dialog or receive unavailable historical data;
  the current view remains usable and the state is labeled rather than guessed.
- Bad: navigate away before flushing a draft, auto-dismiss dependency
  diagnostics, rebuild a template from only visible controls, parse snippets as
  HTML, write an archive from React, or close a destructive dialog before the
  RPC settles.

### 6. Tests Required

- Unit tests cover balanced/unbalanced search-snippet parsing, stored-session
  parsing, and recursive safe template definition cloning/field preservation,
  including nested extension fields and credential/source exclusion.
- Engine/storage tests cover active-only projections, recycled-path
  collisions, purge of versioned documents/projects, malformed archive
  rollback, stale re-import, and analytics unavailable/stale values.
- Real stdio smoke covers template creation/use, multi-file import, both search
  directions, re-import preview/apply, analysis, recycle/restore,
  archive/restore, malformed/no-clobber paths, and process restart.
- Real-Engine Electron E2E covers Home, wizard, dependency diagnostics,
  template CRUD, search/direct segment navigation, re-import, recycle/restore,
  archive export/restore, analytics, and configuration assertions. It fails on
  console/page errors or horizontal overflow and captures 1250x744, 1680x942,
  and 1920x1080 screenshots.
- The Node 22 release lane and Node 24 development lane both run install
  integrity, format, lint, typecheck, unit/Rust tests, contracts, desktop
  production build, Engine smoke, and the focused/full Electron suites.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Drops safe fields, reserializes sensitive keys, and unmounts the action while
// the RPC is pending.
const definition = { sourceLocale, targetLocale };
setPendingAction(null);
void invoke("project.template.update", { definition });
```

```tsx
// Hides dependency diagnostics and lets the renderer publish an archive.
useEffect(() => openWorkspace(createdProject), [createdProject]);
await window.require("fs").writeFile(destination, bytes);
```

#### Correct

```tsx
const definition = {
  ...cloneTemplateDefinition(template.definition),
  sourceLocale,
  targetLocale,
};
await invoke("project.template.update", {
  templateId: template.id,
  expectedRevision: template.revision,
  definition,
});
// Keep the dialog mounted until the awaited call succeeds.
```

```tsx
setDependencyDiagnostics(result.diagnostics);
// The user explicitly chooses this after reviewing diagnostics.
<button onClick={() => void onCreated(projectId, documentId)}>
  Open workspace
</button>;
```

## PDF Review Surface

### 1. Scope / Trigger

Use this contract for source selection, PDF original-page review, OCR source
correction, and PDF-to-DOCX export in the desktop workbench.

### 2. Signatures

DesktopApi.selectSourceDocument opens the P0 source picker. Renderer code uses
generated pdf.page.list, pdf.page.get, pdf.correctOcr, generic document.import,
and generic document.export method contracts.

### 3. Contracts

- Main owns the file dialog and accepts DOCX/XLSX/PPTX/PDF/TXT/Markdown/
  HTML/XHTML/XLIFF/SDLXLIFF/MQXLIFF/MQXLZ extensions. Setup creates the project,
  then imports through document.import; legacy DOCX RPCs remain compatible.
- `PreviewDock` (Phase 4 extract of DocumentPreview) loads page summaries first
  and lazily requests one PNG when visible. segmentIds map the active segment
  to its page; React does not parse the PDF structural path.
- Original page bytes are rendered as an in-memory data URL. Renderer code
  never receives or opens the managed source path.
- OCR correction is available only for active OCR, non-confirmed blocks. The
  controlled form requires source text and reason, sends expected revision, and
  replaces grid and preview state with the returned Segment.
- DOCX/HTML/Markdown/TXT Preview uses the ordered `Segment[]` window and its
  `structuralPath` values as evidence only. It may show a segment/section
  position and a degradation note, but it must not invent page numbers,
  headings, tables, or layout relationships that the Engine did not return.
- Preview rail/canvas entries call the owning Workbench navigation callback;
  they do not mutate `activeId` locally. A collapsed `.preview-content` stays
  mounted for the transition and is `inert`/`aria-hidden` until expanded.
- Preview retains docked/collapsed/maximized state and focus/animation rules;
  Stack uses expanded/collapsed (see Phase 4). PDF export suggests
  name-translated.docx and calls generic document.export.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Source dialog canceled | Keep Setup state; do not create/import |
| Page summary/image loading fails | Keep editor usable and show typed preview error |
| Correction reason/source empty | Disable save; make no RPC |
| Stale OCR revision | Show conflict; keep authoritative current state |
| Confirmed/non-OCR block | Do not render correction command |
| Preview collapsed | Stop page fetches, keep animated content mounted/inert |
| Non-paginated structure unavailable | Show truthful segment position and a bounded limitation note; never show a fake page |
| Export canceled or fails | Keep workbench and surface error/toast |

### 5. Good / Base / Bad Cases

- Good: select scanned PDF, activate invoice block, compare original page,
  correct OCR with a reason, translate target, maximize preview, and export.
- Base: open text-layer PDF and navigate pages without correction controls.
- Bad: decode paths in React, preload every page, expose filesystem APIs,
  optimistically increment source revision, or unmount preview to collapse.

### 6. Tests Required

- Typecheck verifies all calls through generated contracts and the generic
  DesktopApi method map.
- Electron PDF E2E runs with real Engine/Poppler/Tesseract, isolated engine
  data and Chromium user-data-dir, and asserts PNG display, confidence,
  correction, target save, panel modes, DOCX output, and no console errors.
- Non-PDF Electron E2E asserts ordered flow, structure-rail/canvas navigation,
  mounted collapsed state, inert/aria-hidden behavior, no fake page label, and
  no horizontal overflow at the three supported viewports.
- Capture and inspect docked/maximized 1920x1080 screenshots; existing
  1250x744/1680x942/1920x1080 geometry tests remain green.

### 7. Wrong Vs Correct

Wrong: parse a PDF in React, derive a source revision, and mutate local state.

Correct: invoke pdf.page.get and pdf.correctOcr through generated contracts,
then replace display state with Engine responses.

## Professional Editor Command And Autocomplete Contract

### 1. Scope / Trigger

Use this contract when adding an editor command, command-palette action,
autocomplete source, comment interaction, Chinese conversion control, or
large-document renderer test.

### 2. Signatures

`editor-commands.ts` owns:

```ts
interface EditorCommandDefinition {
  id: EditorCommandId;
  label: string;
  shortcut: string;
  isEnabled(context: EditorCommandContext): boolean;
  dispatch(handlers: EditorCommandHandlers): void;
}
```

The Chinese conversion dialog invokes `segment.chinese.convert`; comment CRUD
invokes generated `segment.comment.*` contracts. No new preload method is
required because `DesktopApi.invoke` is generic over `ENGINE_METHODS`.

### 3. Contracts

- The central registry owns command IDs, labels, defaults, enabled predicates,
  and dispatch. `Workbench` supplies presentation handlers and disabled-command
  feedback; it must not restore a second command switch table.
- Keyboard invocation additionally requires editor focus for `editorOnly`
  commands. Palette invocation may use the retained active textarea selection.
  Signed state, IME composition, suggestion count, selected tag, and merge
  eligibility are evaluated through `EditorCommandContext`.
- Autocomplete is enabled only by the durable preference. It consumes the
  Engine-ranked TM list first, then preferred non-forbidden term translations.
  React may select the first visible prefix completion but never recomputes TM
  scores or term recognition. Tab accepts the tail only outside IME composition;
  the normal debounced segment update path persists it.
- Comment UI exposes create, edit, resolve/reopen, and delete for mutable
  comments. Immutable import notes render without mutation controls.
- Chinese conversion exposes all six generated profiles, persists through one
  Engine mutation, and remains disabled for empty or signed targets.
- The 10,000-row Electron test runs scripted scrolling for at least 60 seconds,
  asserts rAF P95 below 33 ms, at most 120 mounted rows, and bounded heap growth.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Editor-only shortcut outside target textarea | Ignore without OS/browser leakage |
| IME composition or keyCode 229 | Do not confirm, autocomplete, navigate, or dispatch mutation |
| Signed segment | Disable content commands; show typed read-only feedback if externally invoked |
| No prefix completion | Tab retains normal focus behavior |
| Stale comment/conversion revision | Show typed conflict and retain authoritative visible state |
| Immutable import note | No edit/resolve/delete controls |
| Performance script exceeds row/frame/memory budget | Electron E2E fails with attached metrics |

### 5. Good / Base / Bad Cases

- Good: type a prefix of the top Engine TM match, see the provider/tail, press
  Tab, save, restart, and recover the completed target.
- Good: edit a comment, resolve and reopen it, then delete it using returned
  revisions at every step.
- Base: autocomplete is disabled in preferences or has no prefix match; no
  ghost control is rendered and Tab is not prevented.
- Bad: duplicate dispatch in a `Workbench` switch, calculate fuzzy ranking in
  React, or accept autocomplete during composition.

### 6. Tests Required

- Vitest proves every registry entry has a predicate/dispatcher and checks
  signed/composition/focus/suggestion enablement plus tag dispatch.
- Electron E2E uses the real Engine for TM autocomplete, complete comment CRUD,
  OpenCC conversion, tag pair insertion/move, review, signed read-only, and
  console-error absence.
- The 60-second performance attachment records duration, frame count/P95/max,
  mounted-row maximum, and heap samples/growth.
- Existing 1250x744, 1680x942, and 1920x1080 visual/panel tests remain green.

### 7. Wrong vs Correct

#### Wrong

```ts
switch (commandId) { /* second dispatch table in Workbench */ }
const suggestion = locallyRankTm(draft, allTmRows);
if (event.key === "Tab") applySuggestionDuringIme();
```

#### Correct

```ts
if (isEditorCommandEnabled(command, context, invocation)) {
  dispatchEditorCommand(command.id, handlers);
}
const suggestion = engineRankedMatches.find((item) =>
  item.targetText.startsWith(draft),
);
```

## Segment Row Action Density Contract

### Scope / Trigger

Use this contract when changing the active segment toolbar, protected-tag
commands, comments, source correction, conversion, review actions, or row
metadata sizing.

### Contracts

- Keep the four frequent actions directly visible: copy protected tags, insert
  a protected tag, insert a protected tag pair, and open comments. Group only
  lower-frequency split, merge, source-correction, Chinese-conversion, and
  review commands in one accessible overflow menu.
- Direct controls and the overflow trigger use Lucide icons, a visible
  tooltip/title, an accessible name, and a stable 32px square hit area. The
  menu uses `role="menu"`/`role="menuitem"`, closes on blur or Escape, and
  returns focus to its trigger on Escape.
- Composition state is checked at every command boundary. While a segment's
  IME composition is active, no split/merge/correction/conversion/comment/
  review mutation or focus transition may run.
- Protected-tag evidence and unresolved issue metadata remain in the row; the
  toolbar may not turn the cell into a card or hide domain evidence in the
  overflow menu.

### Validation

The focused Electron test must assert direct/overflow command membership,
numeric 32px geometry with DPI tolerance, keyboard return, composition
suppression, save/confirm behavior, and no horizontal overflow at the three
supported viewports and 125% editor zoom. The 10,000-segment virtualization
test remains the authority for row height, spacer math, and mounted-row limits.

## Engine-Backed AI Control And Assistant

### 1. Scope / Trigger

Use this contract when changing provider settings, credential entry, online
Assistant behavior, grounding inspection, AI diffs, batch progress, or usage.

### 2. Signatures

The renderer uses generated `DesktopApi.invoke` signatures for public `ai.*`
methods. The only secret-bearing desktop signature is private to the trusted
bridge:

```ts
setAiCredential(profileId: string, secret: string): Promise<void>;
```

### 3. Contracts

- Provider/settings/run/batch/conversation state comes from generated Engine
  contracts. React may retain polling cursors, expanded state, and in-progress
  display text, but it does not invent revisions, usage, or terminal states.
- Credential values cross only `DesktopApi.setAiCredential`, a private
  main/preload IPC guarded by trusted sender validation. They never enter the
  generic renderer invoke catalog, localStorage, logs, or component state after
  the write completes.
- Offline preview remains explicitly labeled and uses deterministic synthetic
  metrics. A configured profile uses durable Engine conversations, grounding,
  run events, and authoritative nullable usage instead.
- Online output is a proposal with word diff, Use in target, and Discard.
  Applying delegates to `ai.result.apply`; the returned editor projection
  replaces the affected row without collapsing the current editor page.
- Conversation, model, and reasoning controls remain keyboard accessible.
  Polling stops on unmount/collapse without canceling Engine work, and reopening
  resumes from durable event/run/message state.
- AI Control and Assistant must have no horizontal overflow at 1250x744,
  1680x942, or 1920x1080. At narrow widths, redundant toolbar text may hide
  while its control retains an accessible name and stable dimensions.
- Project AI allowlist is edited through Product Settings as
  `configuration.engineAllowlist` via `project.update`. Empty means all enabled
  workspace profiles; non-empty lists exact profile IDs. The UI may disable
  known-invalid selections for ergonomics, but Engine enforcement remains
  authoritative—never invent a local bypass or alternate profile.
- Product-facing AI error text on Live Assistant and AI Control must use
  `formatEngineError(error, t)` from `workbench-utils.ts` (not bare
  `formatError`). When `code === "policy_denied"`, map to catalog key
  `error.allowlistDenied` and interpolate `profileId` from structured
  `data.profileId` (camelCase wire shape). Unknown codes keep the audited
  technical protocol message. Branch only on stable `code`/`data` fields—never
  on English `message` text.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No enabled credential-backed profile | Keep explicit offline Assistant; do not imply a network response |
| Credential save/delete fails | Clear the input only on success and show the typed error without the value |
| Stale/signed/tag-invalid proposal apply | Keep the proposal visible and show the Engine error; do not patch local target state |
| Polling panel unmount/collapse | Stop renderer polling; do not cancel the durable Engine run |
| First conversation is created during submit | Bind grounding to the returned conversation ID, not the previous null state |
| Narrow toolbar | No child text overlaps an adjacent control; hidden text retains an accessible parent label |
| Engine returns `policy_denied` with `data.profileId` | Show localized `error.allowlistDenied` with that profile ID; no run/batch UI success state |
| `formatEngineError` called without `t` or with unknown code | Fall back to `formatError` (audited technical English); do not invent copy |

### 5. Good / Base / Bad Cases

- Good: create a first conversation and immediately translate; the grounding
  inspector remains attached to that new conversation through completion.
- Good: disallowed profile start surfaces the Chinese/English catalog sentence
  with the profile ID; generic Engine failures still use technical `message`.
- Base: select Local preview and receive explicitly synthetic metrics without a
  provider request or keyring dependency.
- Bad: clear grounding in a passive effect keyed by the previous conversation,
  or replace the full editor page with the single row returned by AI apply.
- Bad: `setError(formatError(reason))` on AI surfaces that already have
  `useLocale`, or match denial by substring of the protocol message.

### 6. Tests Required

- Electron E2E configures a loopback profile through trusted credential IPC,
  enables policy, inspects grounding, streams and applies a proposal, verifies
  all usage metrics, exercises batch tag rejection, and deletes the credential.
- The AI Control and online Assistant are captured at all three supported
  viewports with horizontal-overflow and adjacent-toolbar-boundary assertions.
  Console/page errors fail the test.
- Unit tests for `formatEngineError` prove `policy_denied` →
  `error.allowlistDenied` with interpolated `profileId`, and that non-policy
  errors still return the original technical message when `t` is supplied.

### 7. Wrong vs Correct

#### Wrong

```ts
const bundle = await previewGrounding(action, prompt); // captures null thread
setConversationId((await createConversation()).id);
setSegments(mutation.rows.map((row) => row.segment)); // drops the page
setError(formatError(reason)); // loses catalog localization for policy_denied
if (String(reason).includes("not allowed")) { /* brittle message match */ }
```

#### Correct

```ts
const conversation = activeConversationId ?? (await createConversation()).id;
const bundle = await previewGrounding(action, prompt, conversation);
applyEditorMutation(mutation); // merges returned rows into the current page
setError(formatEngineError(reason, t)); // policy_denied → error.allowlistDenied
```

## Plugin Connector Catalog And Profiles

### 1. Scope / Trigger

Use this contract when the Desktop displays connector inventory, creates or
edits a plugin-backed provider profile, accepts a credential, tests a profile,
or reflects plugin enable/revoke/upgrade/uninstall state. The renderer is a
projection of Engine-owned generated contracts and never loads plugin code or
derives lifecycle state.

### 2. Signatures

Public renderer calls use generated `DesktopApi.invoke` methods for
`ai.provider.*` and `plugin.*`. The only secret-bearing signature remains the
trusted preload bridge:

```ts
setAiCredential(profileId: string, secret: string): Promise<void>;
```

Catalog/profile projections distinguish sources explicitly:

```ts
type ConnectorSource =
  | { source: "builtin" }
  | {
      source: "plugin";
      pluginId: string;
      versionId: string;
      contributionId: string;
      contractVersion: number;
      configSchemaVersion: number;
    };
```

### 3. Contracts

- AI Control merges built-in and plugin catalog entries while labeling source,
  exact owner/version/contract, schema version, capabilities, and authoritative
  available/degraded state.
- Plugin profile configuration renders only Engine-projected bounded schema
  fields with typed text, number, select, and boolean controls. There is no raw
  JSON editor and renderer validation is only an ergonomic preview; Engine
  validation remains authoritative.
- Credential input is a password control. Its value crosses only
  `setAiCredential`, is cleared only after success, and never appears in React
  durable state, catalog/profile data, status, diagnostics, or error text.
- Plugins inventory shows connector operations, exact profile-reference count,
  permission/origin decision state, and safe failure data. After every
  mutation it reloads Engine state rather than updating registry status
  optimistically.
- Detached profiles remain visible as unavailable and cannot be tested or used;
  their historical identity is not rewritten and the connector is absent from
  new-profile choices.
- Long owner/version/contribution IDs wrap without overlapping controls or
  causing horizontal overflow at 1250x744, 1680x942, and 1920x1080. Focus,
  keyboard operation, accessible names, and localized status remain intact.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Plugin connector unavailable/degraded | Show exact status; disable test/use; do not fall back to a built-in |
| Schema field is unknown or unsupported | Do not invent an editor; surface the Engine-compatible unavailability/error state |
| Config or profile mutation fails | Keep user-entered non-secret fields and show the typed safe error |
| Credential write fails | Keep the password for correction in the current control only; never echo it in status/error |
| Credential write succeeds | Clear the control and reload credential-presence state |
| Revoke/disable/uninstall completes | Reload catalog, profiles, and plugin inventory; referenced profiles remain visible/unavailable |
| Exact owner ID exceeds available width | Wrap/break safely with no page or panel horizontal overflow |

### 5. Good / Base / Bad Cases

- Good: install/grant/enable an official connector, create a schema-driven
  profile, store and test its credential, use it, restart, then revoke and
  observe the same profile become unavailable.
- Base: inspect a connector with zero profiles or an unavailable connector with
  retained references; the inventory remains truthful and actionable.
- Bad: render arbitrary descriptor JSON, store the password in profile config,
  infer enabled state from a click, hide exact version identity, or remove an
  unavailable profile from history.

### 6. Tests Required

- Renderer unit tests cover source labels, long identifiers, schema control
  types/defaults/bounds, unavailable states, profile references, safe errors,
  and secret absence.
- Production Electron E2E uses the official loopback connector for permission
  review, enable, profile creation, credential set/test/use, restart, lifecycle
  mutation, and uninstall. It fails on page/console errors.
- Capture and inspect connector/profile surfaces at 1250x744, 1680x942, and
  1920x1080 with explicit horizontal-overflow assertions.

### 7. Wrong vs Correct

#### Wrong

```tsx
setCatalog((rows) => rows.map((row) =>
  row.id === connectorId ? { ...row, available: true } : row));
<textarea value={JSON.stringify(descriptor.config)} />
```

#### Correct

```tsx
await window.translunar.invoke("plugin.enable", { pluginId, expectedRevision });
await Promise.all([reloadPluginInventory(), reloadProviderCatalog()]);
return <ConnectorConfigFields fields={connector.configFields} />;
```

## Bilingual Review And Table Interop Surface

### 1. Scope / Trigger

Use this contract for the Project Insights Interop panel, trusted review/table
file dialogs, review DOCX export, authoritative row previews, and selected
review/TM apply. Electron owns OS dialogs and presentation state only; Rust
owns every package, classification, revision, and persistence rule.

### 2. Signatures

The trusted bridge adds one file-selection operation:

```typescript
selectInteropInput(kind: "review" | "table"): Promise<string | null>;
```

`review` accepts DOCX; `table` accepts DOCX/XLSX. Main validates the active
sender and the literal kind before opening the dialog. Renderer orchestration
uses generated `DesktopApi.invoke` contracts for `tm.library.list` and the five
`interop.review.*`/`interop.table.*` methods; it defines no local payload type.

### 3. Contracts

- Interop is an Insights work surface with explicit `Review DOCX` and
  `Table to TM` tabs. Switching mode clears paths, previews, selected rows,
  feedback, and the mode-specific default apply reason.
- Main owns open/save dialogs. Cancel returns `null` and triggers no RPC.
  Review export reuses `selectExportPath` and sends the current authoritative
  document revision.
- Table mode lists only writable TM libraries whose source/target locales match
  the project. It sends the selected library's returned revision and locales;
  React never guesses writability or increments a revision.
- Preview rows are rendered exactly from generated Engine results. Review
  checkboxes enable only `changed`; table checkboxes enable only `valid`.
  Initial selection includes those eligible rows, and apply sends explicit row
  IDs plus bounded actor/reason fields.
- Paging reuses `previewId` and the returned expected revision/locales/limit.
  Source provenance displays raw `sourceRow`; it must not add another header
  offset. Structural paths and diagnostics are display-only strings.
- Busy, typed error, notice, empty, preview, and terminal states are mutually
  coherent. A rendered preview replaces the empty state. Applied previews show
  `Applied`, clear selection, disable apply, and never render `Apply 0`.
- Review apply refreshes authoritative project/document projections. Table
  apply reloads the library page. A failed apply retains the preview and shows
  the Engine error without optimistic mutation.
- Rows, paths, diagnostics, controls, and pagination must remain keyboard
  accessible and horizontally contained at 1250x744, 1680x942, and 1920x1080.
  Renderer code must not import filesystem/ZIP/XML/XLSX parsing APIs.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown sender or interop kind | Reject in main before opening a dialog |
| Input/output dialog canceled | Keep the panel usable; make no preview/export RPC |
| No locale-matching writable library | Show the empty library option and disable table preview |
| Preview returns `missing`/`added`/`invalid` or `duplicate`/`invalid` | Render disposition/diagnostics; checkbox stays disabled |
| Preview/apply revision conflict or typed parse error | Keep current preview/path and show the Engine error; no local success state |
| Preview status is `applied` | Clear selection, disable apply, and label the terminal action `Applied` |
| Page request is pending | Keep stable control/row dimensions and prevent duplicate actions |
| Supported viewport | No horizontal document overflow, overlapping controls, or clipped button text |

### 5. Good / Base / Bad Cases

- Good: export a review, select the returned DOCX, preview one changed row,
  apply it, refresh, and see the durable review proposal after Engine restart.
- Good: select XLSX, preview raw input row 2 with metadata/provenance, apply two
  valid rows, and reload the incremented writable library revision.
- Base: canceled selection or an all-unchanged review leaves the panel usable
  with no enabled apply command.
- Bad: parse a DOCX in React, add one to `sourceRow`, enable every disposition,
  render an empty card beneath a real preview, or show `Apply 0` after success.

### 6. Tests Required

- Typecheck and generated-contract drift checks cover all five invoke payloads
  plus the exact `selectInteropInput` Desktop API shape.
- Real-Engine Electron E2E exports and rewrites a review DOCX, verifies
  unchanged/changed rows, applies one proposal, previews/applies XLSX rows, and
  asserts raw source-row provenance and terminal UI.
- E2E must exercise dialog cancel/test-path handling, typed failures,
  inaccessible dispositions, pagination where present, and absence of a
  duplicate empty state.
- Capture 1250x744, 1680x942, and 1920x1080 Insights screenshots; fail on
  horizontal overflow, renderer console errors, page errors, overlap, or text
  escaping its controls.

### 7. Wrong vs Correct

#### Wrong

```tsx
const rows = await parseXlsx(inputPath);
setRows(rows.map((row, index) => ({ ...row, sourceRow: index + 2 })));
```

#### Correct

```tsx
const preview = await window.translunar.invoke("interop.table.preview", params);
setTablePreview(preview);
setSelectedRows(
  new Set(
    preview.rows
      .filter((row) => row.disposition === "valid")
      .map((row) => row.rowId),
  ),
);
```

## Alignment And Reference Corpus Desktop Surface

### 1. Scope / Trigger

Use this contract for the Project Insights alignment/corpus workflow, corpus
file selection, alignment AI polling, alignment-to-TM apply, corpus search, or
the additive corpus projection in Workbench concordance. Electron owns trusted
path selection and presentation orchestration only; Engine and Store own
alignment scoring, revisions, partitions, parsing, indexing, ranking, and
persistence.

### 2. Signatures

The trusted bridge adds one path selector:

```typescript
selectCorpusInput(): Promise<string | null>;
```

Main validates the active sender, honors `TRANSLUNAR_TEST_CORPUS_INPUT` in the
desktop harness, and otherwise opens the shared supported-document filter.
Renderer orchestration uses generated contracts for:

```text
alignment.session.create/get/list/update/refine/apply
corpus.list/import/fromAlignment/search/reindex/remove
tm.library.list
tm.concordance
ai.provider.list
ai.run.get/cancel
```

### 3. Contracts

- Project Insights owns one `AlignmentCorpusPanel` with explicit Alignment and
  Reference corpora modes. It sends IDs, expected revisions, bounded actor and
  reason fields, and returned link selections; it never scores candidates,
  parses files, invokes a provider directly, or derives a storage revision.
- Session creation uses active document and project revisions from the latest
  parent snapshot. A stale-state reload refreshes the parent workspace as well
  as session/library pages so a retry cannot reuse stale project or document
  revisions.
- Link/Merge/Unlink/Split send a complete replacement partition for a
  contiguous returned link range. Confirm/reject, correction, refine, apply,
  reindex, remove, and corpus creation stay disabled until actor and reason are
  non-empty. Renderer selection never implies confirmation or TM application.
- AI refinement accepts selected proposed links only. Poll `ai.run.get` at a
  bounded cadence, treat `succeeded`, `failed`, `interrupted`, and `canceled`
  as terminal, and stop renderer polling on unmount without canceling durable
  Engine work. Cancel uses the latest returned run revision.
- TM selection includes only returned writable libraries whose locales equal
  the project locales. Apply sends explicitly selected confirmed bilingual
  links and then reloads the terminal session, library page, and parent
  workspace; no optimistic TM count or session status is invented.
- Corpus paths come only from `selectCorpusInput` or
  `resolveDroppedPaths`. Project locales remain visible but authoritative;
  React does not offer a locale value that Store will reject. Import, reindex,
  and remove replace list/search state from Engine responses.
- Corpus management pages independently from search scope. The scope selector
  is populated from one bounded all-active page (the project capacity is below
  the protocol page maximum), not from the currently visible status/list page.
  Query, side, or scope edits clear old results; removing the selected scope
  clears that ID before searching again.
- `tm.concordance` keeps `hits`/`total` as TM-only values and renders additive
  `corpusHits`/`corpusTotal` separately, in Engine order, with corpus/file/path/
  entry/matched-side provenance. A corpus row exposes target insertion only
  when `targetText` is non-empty; monolingual source evidence never inserts an
  empty or fabricated target.
- Busy, error, empty, open, stale, canceled/interrupted, and applied states are
  mutually coherent. The remove confirmation stays mounted through failure,
  has a dialog name and initial focus, closes on Escape only while idle, and
  closes after a successful remove.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Corpus dialog canceled or dropped file has no trusted path | Keep the form unchanged and make no import RPC |
| Fewer than two active documents or the same document is selected twice | Disable session creation |
| Actor/reason is empty | Disable every affected mutation while keeping read-only paging/search usable |
| Selected links are non-contiguous or do not fit the command shape | Disable that correction; never synthesize a partial partition |
| AI run is `interrupted` | Stop polling and show the returned failure; do not offer cancel against a terminal run |
| Session/project/document/library/corpus conflict | Keep current selections and show the typed error; authoritative reload refreshes parent revisions |
| No locale-matching writable TM | Show an empty TM option and disable apply |
| Current corpus page becomes empty after removal | Reload the last valid Engine page |
| Removed corpus was the active search scope | Clear the scope before re-running search |
| Corpus hit has no target text | Render provenance without an insertion command |
| Supported viewport | No document-level horizontal overflow, clipped controls, or overlapping rows |

### 5. Good / Base / Bad Cases

- Good: create a session, link contiguous unaligned sides, confirm selected
  bilingual rows, apply them to a matching writable TM, reopen the terminal
  result, and create a corpus from confirmed links.
- Good: import a target-monolingual corpus, search it from a different list
  page, inspect file/path provenance, reindex, remove it, and observe the scope
  and concordance projections update from Engine state.
- Base: no credentialed AI profile or writable TM leaves deterministic manual
  alignment, corpus creation, and search usable.
- Bad: keep polling an interrupted run, populate search scope from only the
  visible 20-row list page, retry a conflict with stale props, locally rank
  corpus hits, or show `Insert target` for an empty target.

### 6. Tests Required

- Vitest covers ordered/contiguous selection, merge/unlink/split replacement
  shapes, unknown provenance formatting, and interrupted-run terminal status.
- Typecheck and generated-contract drift cover `selectCorpusInput`, all
  alignment/corpus invoke payloads, and additive concordance fields.
- Real-Engine Electron E2E creates and edits a session, exercises AI success/
  cancel/interrupted/error states, applies selected confirmed links, imports/
  searches/reindexes/removes file and alignment corpora, and verifies corpus
  concordance insertion gating and provenance.
- Capture 1250x744, 1680x942, and 1920x1080 screenshots. Fail on renderer
  console/page errors, inaccessible controls/dialogs, document horizontal
  overflow, overlap, or text escaping a control.

### 7. Wrong vs Correct

#### Wrong

```tsx
const scope = visibleCorpora.filter((corpus) => corpus.status === "active");
const ranked = locallyRankCorpusHits(await invoke("corpus.search", params));
if (run.status === "interrupted") continuePolling(run.id);
```

#### Correct

```tsx
const scope = await window.translunar.invoke("corpus.list", {
  projectId,
  status: "active",
  offset: 0,
  limit: 500,
});
const result = await window.translunar.invoke("corpus.search", params);
setSearchResults(result); // Preserve Engine order and provenance.
if (isTerminalAiRunStatus(run.status)) stopPolling();
```

## Offline Task Package Surface

### 1. Scope / Trigger

Use this contract for Project Insights task-package assignment export,
assignment/return preview, detached import, return export, row selection, and
merge confirmation. Main owns the trusted `.tltask` open dialog and preload
owns the typed bridge. Rust/Engine remains authoritative for package parsing,
hashes, revisions, classifications, identity binding, and persistence.

### 2. Signatures

The bridge adds exactly:

```typescript
selectTaskPackageInput(): Promise<string | null>;
```

Renderer calls generated methods only:
`taskPackage.export`, `taskPackage.preview`, `taskPackage.import`,
`taskPackage.apply`, and `taskPackage.discard`. The apply payload contains
`previewId`, `expectedProjectRevision`, explicit `selectedRowIds`, `actor`, and
`reason`; it does not contain a request digest. Preview paging reuses the
returned `previewId`, `offset`, and `limit`.

### 3. Contracts

- Assignment export requires at least one active document and a destination;
  optional segment IDs and asset row IDs are explicit strings. Return export is
  enabled only for a project carrying the Engine-provided task-package
  reference.
- The panel renders Engine `counts`, `diagnostics`, `rows`, `disposition`,
  `safeToApply`, `identicalChange`, hashes, revisions, and projections as
  received. It never opens a ZIP, parses JSON, computes a hash, or ranks a
  conflict locally.
- Selection is a presentation concern only. It is retained by row ID across
  pages, can add safe rows from multiple pages, and sends the complete explicit
  set at confirmation. Only safe Engine rows can have an enabled checkbox.
- Busy operations disable duplicate commands. Empty, error, notice, preview,
  and terminal states are mutually coherent. Any preview status other than
  `open` is terminal: import/apply/discard controls become read-only, and a
  failed apply keeps the open preview and selection for retry.
- A successful import exposes the returned detached project and opens it only
  after the Engine response. A successful apply refreshes the authoritative
  project snapshot; it does not increment revisions optimistically.
- The task-package tab, fields, row labels, pagination, dialog, and icon-only
  discard control remain keyboard accessible and contained at 1250x744,
  1680x942, and 1920x1080. Main rejects an untrusted sender and filters the
  open dialog to `.tltask`.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Dialog canceled | Keep the current path/preview and make no package RPC |
| Actor or reason empty | Disable export, preview, import, apply, and discard while keeping read-only rows visible |
| No active document or incomplete asset slice | Disable assignment export; do not send a partial selection |
| Preview page pending | Keep row/control dimensions stable and prevent duplicate page requests |
| `safeToApply=false` disposition | Checkbox stays disabled and row remains visible with Engine reason |
| Stale/typed Engine error | Preserve path, preview, and selection; show the normalized error and no success notice |
| Apply succeeds | Show terminal status, clear/disable merge actions, refresh project, and retain audit notice |
| Import succeeds | Show binding count and an accessible open-project action |
| Supported viewport | No document horizontal overflow, clipped labels, or overlapping controls |

### 5. Good / Base / Bad Cases

- Good: choose an assignment destination, export, open the package through the
  trusted dialog, page first/next/previous, select safe rows on two pages, and
  confirm one merge with a named accessible dialog.
- Good: a stale apply keeps the rows and selected IDs, a fresh preview can be
  loaded, and terminal applied/discarded states disable all mutation controls.
- Base: cancel a dialog or preview a package with no safe rows; the panel stays
  usable and does not show an enabled `Apply 0` command.
- Bad: parse package bytes in React, derive a digest, replace the whole
  selection on every page, treat `applied` as retryable, or hide a typed Engine
  error behind a generic success state.

### 6. Tests Required

- Typecheck and contract drift assert the generated method/parameter/result
  relationship and the exact `selectTaskPackageInput` bridge shape.
- Desktop unit/E2E fixtures cover assignment export guards, asset/document
  selection, assignment/import/return modes, first/next/previous paging,
  cross-page selection, stale retry, terminal controls, and accessible names.
- Real-Engine Electron E2E records assignment and return screenshots at
  1250x744, 1680x942, and 1920x1080 and fails on console/page errors,
  inaccessible controls, text escaping, or document-level horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```tsx
const rows = JSON.parse(await readFile(packagePath, "utf8"));
const digest = hash(selectedRows);
setRows(sortConflicts(rows));
```

#### Correct

```tsx
const result = await window.translunar.invoke("taskPackage.preview", {
  packagePath,
  offset: 0,
  limit: 50,
  actor: actor.trim(),
  reason: reason.trim(),
});
setPreview(result);
setSelectedRows(new Set(result.rows.filter((row) => row.selected).map((row) => row.rowId)));
```

## Discussion And Snapshot Insights Surface

### 1. Scope / Trigger

Use this contract for the Project Insights discussions/snapshots tab and its
desktop E2E coverage. The renderer is a presentation client of generated
Engine contracts; it does not parse snapshot JSON, calculate hashes/revisions,
open files, or add a preload capability.

### 2. Signatures

The existing generic `DesktopApi.invoke` is sufficient. The panel calls only:

```text
discussion.thread.list/create/resolve
discussion.message.list/create/update/delete
project.snapshot.list/create/get/previewRestore/restore
```

React state stores typed Engine pages, selected IDs, busy/error/notice state,
and controlled actor/reason/title/body fields. Page requests use bounded
`offset`/`limit`; mutation payloads pass Engine revisions and audit fields
unchanged.

### 3. Contracts

- Scope controls are explicit `Project`, `Document`, and `Segment` modes. The
  panel renders Engine ordering, ordinals, mentions, status, counts, hashes,
  summaries, missing dependencies, and terminal preview status without local
  derivation.
- Successful RPC responses replace the affected thread/message/snapshot or
  preview projection. No optimistic revision/count update is allowed. Busy
  controls disable duplicate mutations; typed failures preserve the current
  selection and retryable preview.
- Message deletion remains visible as an accessible tombstone. Snapshot
  restore uses an in-app confirmation dialog, never `window.confirm`; an
  `applied` preview exposes no second restore command.
- The preview wrapper is a named semantic region:
  `<section className="snapshot-preview" aria-label="Restore preview">`.
  Success notifications use `p.surface-success[role="status"]`; loading
  indicators may also use `role="status"`, so E2E assertions must scope the
  success locator rather than call an unqualified `getByRole("status")`.
- All controls have labels/names, pagination is keyboard reachable, and the
  surface remains contained at 1250x744, 1680x942, and 1920x1080.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Initial load or page request | Show bounded loading state with stable control dimensions; prevent duplicate page requests |
| Empty project/thread/snapshot page | Show an actionable empty state without inventing counts |
| Typed Engine conflict/not-found/invalid-state | Show an in-surface error; retain authoritative selection/input and do not show success |
| Preview stale or missing dependency | Keep preview/dialog available for refresh; do not mark restored |
| Restore succeeds | Show terminal `applied`, disable further restore, refresh authoritative project data, retain audit notice |
| Any supported viewport | No document horizontal overflow, clipped labels, overlapping controls, or text escaping fields |
| Renderer/Engine console or page error | E2E fails and captures the diagnostic; no silent catch-all success |

### 5. Good / Base / Bad Cases

- Good: create a project thread, add/edit/tombstone a reply, resolve/reopen,
  switch scopes, page results, preview a snapshot, handle stale restore, and
  restore after a fresh preview.
- Good: after Engine restart, the panel reloads all three scope totals and
  the terminal snapshot row while preserving accessible labels and layout.
- Base: empty, loading, error, stale, and terminal states are mutually
  coherent; a canceled dialog leaves the current preview untouched.
- Bad: parse payload JSON in React, calculate a digest, branch on error
  message text, use browser-native confirm, or assert the first arbitrary
  `role=status` when loading and success statuses coexist.

### 6. Tests Required

- Typecheck and contract drift must cover the generated method/result mapping;
  renderer source must contain no filesystem or Electron imports.
- Focused Vitest tests cover pure pagination/mention/display helpers. The
  real-Engine E2E covers all scopes, message CRUD/tombstone, resolve/reopen,
  duplicate snapshot, stale preview, fresh restore, terminal retry, restart,
  and history recovery.
- E2E asserts named controls, semantic restore region, scoped success/error
  states, no console/page errors, no horizontal overflow, and screenshots at
  1250x744, 1680x942, and 1920x1080. Run on Windows with the real Engine; an
  Xvfb run is supplementary and may quantize rAF timing.

### 7. Wrong vs Correct

#### Wrong

```tsx
await expect(page.getByRole("status")).toContainText("Discussion created");
const preview = JSON.parse(snapshotPayload);
window.confirm("Restore?");
```

#### Correct

```tsx
await expect(
  page.locator('p.surface-success[role="status"]'),
).toContainText("Discussion created");
await expect(
  page.getByRole("region", { name: "Restore preview" }),
).toBeVisible();
await window.translunar.invoke("project.snapshot.restore", params);
```

## Asset Curation And Typed Engine Error Surface

### 1. Scope / Trigger

Use this contract when Project Insights renders the unified asset catalog or
curation lifecycle, and whenever renderer behavior must branch on an Engine
error code. Generated method params/results still define the business payload;
the desktop envelope exists only to preserve typed failures across Electron's
main/preload/contextBridge boundary.

### 2. Signatures

The shared bridge owns this internal envelope:

```typescript
export interface DesktopEngineError {
  code: string;
  message: string;
  data?: unknown;
}

export type DesktopEngineInvokeResponse<Result = unknown> =
  | { ok: true; result: Result }
  | { ok: false; error: DesktopEngineError };
```

`DesktopApi.invoke<Method extends EngineMethod>` keeps its generated
`EngineParams<Method> -> EngineResult<Method>` signature. The renderer calls
only `asset.catalog.list`, `curation.run`, `curation.run.get`,
`curation.finding.list`, `curation.apply`, `curation.rollback`, and
`curation.export`; it never sees or constructs the success envelope.

### 3. Contracts

- Main validates the sender and generated method name, calls `EngineClient`,
  returns `{ ok: true, result }`, and catches only `EngineProcessError` to
  return `{ ok: false, error: { code, message, data? } }`. Unexpected main
  failures continue to reject the IPC call.
- Preload treats the IPC value as `unknown`, validates the discriminated
  envelope, returns the result, or rejects with the plain structured error.
  The plain object is intentional: Electron may not retain custom `Error`
  fields such as `code` and `data` through contextBridge cloning.
- Renderer catch values remain `unknown`. `formatError` accepts native Errors
  and structured objects for display; behavior such as stale refresh branches
  only on a narrowed `code === "conflict"`, never on message text.
- `AssetCurationPanel` owns only filters, paging offsets, selected finding IDs,
  controlled policy/audit/export fields, dialog visibility, and busy/error/
  notice/stale state. Generated Engine projections own scores, findings,
  provenance, status, revisions, and mutation counts.
- Catalog/run/finding pages replace authoritative results. Apply and rollback
  use named in-app confirmation dialogs and exact returned revisions. A typed
  conflict leaves the current run inspectable, marks it stale, and exposes an
  authoritative reload before another mutation.
- Only open, `quarantine` findings are selectable. Empty/loading/error/stale/
  open/applied/rolled-back/export states remain coherent and accessible. The
  surface stays contained at 1250x744, 1680x942, and 1920x1080.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| IPC value is not a valid success/failure envelope | Reject with `Engine returned an invalid response envelope`; render an error |
| Engine returns `conflict` | Preserve the run/selection, show stale state, and require authoritative reload |
| Engine returns another typed failure | Display its bounded message; do not show success or invent state |
| Library/provider list is loading or empty | Keep stable controls, show named loading/empty state, and disable analyze |
| Run is not `open` or finding disposition is not `quarantine` | Disable selection/apply; keep evidence visible |
| Actor/reason is blank, selection is empty, or mutation is busy | Disable the unsafe command without hiding read-only data |
| Apply/rollback succeeds | Replace run/library revisions from Engine, refresh catalog/project state, and expose the terminal status |
| Supported viewport | No document horizontal overflow, clipped control text, heading/action overlap, or console/page error |

### 5. Good / Base / Bad Cases

- Good: analyze, receive a structured conflict on stale apply, reload, analyze
  again, apply selected findings, restart, export, rollback, restart, and
  render the returned terminal state.
- Base: no configured provider leaves the complete deterministic offline path
  available; an empty library/catalog remains an explicit usable state.
- Bad: rethrow only `new Error(message)` in preload, branch on
  `message.includes("revision")`, compute a score in React, optimistically
  increment revisions, or select every low-score row without an actionable
  Engine finding.

### 6. Tests Required

- Unit tests assert envelope error display, `code` narrowing, selectable
  finding guards, bounded evidence, date conversion, paging, and basis-point
  formatting.
- Typecheck and contract drift prove every invoke payload/result comes from the
  generated method map; lint forbids unsafe `any` and floating promises.
- Real-Engine Electron E2E creates/imports a TM, filters the catalog, analyzes,
  causes a stale conflict, reloads, applies, restarts, exports JSONL, rolls
  back, restarts, and verifies restored active rows.
- E2E asserts named controls/dialogs/regions, no console/page errors, no
  document overflow or heading overlap, and screenshots at all three supported
  viewport sizes.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Custom Error fields can disappear across contextBridge cloning.
throw new Error(engineError.message);

if (String(error).includes("revision")) setStale(true);
```

#### Correct

```typescript
// Main returns a cloneable discriminated envelope.
return {
  ok: false,
  error: { code: error.code, message: error.message, data: error.data },
} satisfies DesktopEngineInvokeResponse;

// Preload validates it and rejects with the plain structured error.
if (!response.ok) return Promise.reject(response.error);
```

## Plugins Panel

### 1. Scope / Trigger

Use this contract for the Project Insights Plugins tab, local package selection
(directory or `.tlplugin`), inspection confirmation, offline bundled catalog,
version history/rollback UI, plugin lifecycle actions, diagnostics, or desktop
plugin E2E. The surface projects Engine-owned state; it never implements
lifecycle policy or provenance authority.

### 2. Signatures

```typescript
window.translunar.selectPluginPackage(): Promise<string | null>;
window.translunar.invoke("plugin.inspect", PluginInspectParams);
window.translunar.invoke("plugin.list", { offset, limit }): Promise<PluginPage>;
window.translunar.invoke("plugin.install", PluginInstallParams);
window.translunar.invoke("plugin.upgrade", PluginUpgradeParams);
window.translunar.invoke("plugin.version.list", PluginVersionListParams);
window.translunar.invoke("plugin.rollback", PluginRollbackParams);
window.translunar.invoke("plugin.bundled.list", PluginBundledListParams);
window.translunar.invoke("plugin.bundled.apply", PluginBundledApplyParams);
window.translunar.invoke("plugin.enable" | "plugin.disable" |
  "plugin.uninstall", PluginMutationParams);
```

Main starts Engine with packaged resources when present:

```text
translunar-engine --data-dir <…> --bundled-plugin-root <resources/plugins>
```

`PluginsPanel` accepts only `onRefresh(): Promise<void>`. Rows consume generated
`PluginSummary` / `PluginBundledSummary` fields including `sourceKind`,
distribution, hash prefixes, contributions, diagnostics, and revision.

### 3. Contracts

- Project Insights owns the Plugins tab; package selection remains in Electron
  main. The picker accepts a directory **or** a `.tlplugin` file.
  `TRANSLUNAR_TEST_PLUGIN_SOURCE` replaces only the dialog result in E2E.
- Local install/upgrade **must** call `plugin.inspect` and show an inspection
  confirmation (identity, version, tier, source, hash prefix, compatibility,
  license/publisher, contributions, capability risks, diagnostics) before any
  install/upgrade mutation.
- Bundled catalog uses `plugin.bundled.list` / `plugin.bundled.apply` with
  catalog package **ids** only. Renderer state never stores or displays absolute
  resource paths, archive filenames under `resources/plugins`, or raw package
  bytes. Source badges (`local directory` / `local archive` / `bundled`) are
  Engine projections, not client guesses.
- Renderer code uses generated `plugin.*` method types and the shared structured
  invoke envelope. It never imports plugin code, reads manifests, opens SQLite,
  infers status, classifies provenance, or registers contributions.
- Declarative rows render the generated `tier: "declarative"` projection and
  the same Engine-owned lifecycle controls as process rows. A manifest-only
  package never needs an entry script, process status, or renderer evaluator;
  its filter, QA, and pipeline inventory appears only after Engine enable.
- Install, enable, disable, upgrade, rollback, bundled apply, and uninstall
  expose one busy state, clear the previous alert, pass the current Engine
  revision, invoke Engine, reload plugin + bundled + permission + panel-session
  projections together, and refresh owning project data. Cancellation changes
  nothing.
- An external process failure can occur during document work rather than a
  panel button. The panel Refresh action must then show Engine-owned
  `degraded` and `lastError`; it does not synthesize the transition locally.
- Structured IPC rejection preserves `code` and `data`, including
  `plugin_process_failed` fields `pluginId`, `filterId`, `operation`,
  `failureKind`, and `retryable`.
- Enabled status uses the confirmed color, degraded uses warning, and error
  text uses the shared error token. Long permission/error text wraps inside the
  row; actions remain reachable at supported viewports. EN and zh-CN strings
  are required.

### 4. Validation & Error Matrix

| Condition | Required UI behavior |
| --- | --- |
| Package dialog canceled | No Engine call, no alert, current list unchanged |
| User cancels inspection confirmation | No install/upgrade mutation |
| Install/lifecycle RPC fails | Named alert shows formatted error; busy state clears |
| Stale revision on mutation | Typed conflict alert; reload Engine projections; do not invent success |
| Plugin process crashes during document import | Structured rejection retains code/data; Refresh shows degraded row and safe lastError |
| Degraded plugin after Engine restart | Row remains degraded and contribution is absent from `filter.list` |
| Catalog unavailable | Empty bundled band + safe diagnostics; local install still offered |
| Tier 1 package is installed without grants | Show installed/pending review; no contribution appears and no process starts |
| Tier 1 grant is revoked | Reload Engine-owned disabled status; filter, QA, and pipeline adapters are absent |
| Empty list | Render localized empty state, not a placeholder plugin |
| Long diagnostics/permissions at 1250x744 | Wrap inside row with no document overflow or action overlap |

### 5. Good / Base / Bad Cases

- Good: inspect then install a local archive, apply a bundled catalog entry,
  review permissions, enable, list versions, roll back, disable, and uninstall
  from one named Plugins surface without developer tools.
- Base: refresh after an out-of-panel crash and render the durable degraded row
  without a console error.
- Bad: catch an Engine error as `String(error)` before reading its code/data,
  import the plugin entry in React, set status/sourceKind optimistically, or
  pass a filesystem path into `plugin.bundled.apply`.

### 6. Tests Required

- Real-Engine E2E covers empty/install/enabled/restart/disabled/uninstalled and
  crash/degraded/restart paths on a **fresh** desktop build (not a stale dist).
- Bundled Path A: catalog available, install/restore allowlisted core package,
  `sourceKind === "bundled"`, no resource path / `.tlplugin` name leak in UI or
  serialized catalog projections.
- Local archive Path B: fixture archive path must sit **outside** the configured
  bundled root (copy catalog archive to a temp dir); assert inspect and installed
  row both show `local archive`, then uninstall with empty console errors.
- The Tier 1 real-Engine flow installs the official manifest-only toolkit,
  reviews and grants every request, enables without a child process, survives
  app restart, and then disables and uninstalls with no page/console errors.
- Assert the exact typed failure code/data, absence from `filter.list`, visible
  safe lastError, a subsequent ordinary RPC, and no stderr leakage.
- Assert every button/tab/region has an accessible name and console/page error
  collections remain empty.
- Capture and inspect 1250x744, 1680x942, and 1920x1080 for installed, bundled,
  inspection, and permission states; assert no global horizontal overflow.

### 7. Wrong vs Correct

#### Wrong

```typescript
catch (error) {
  setPlugins((rows) => rows.map((row) => ({ ...row, status: "degraded" })));
}
```

```typescript
// Points fixture at resources/plugins/*.tlplugin then expects "local archive"
// after install — Engine correctly classifies verified catalog archives as bundled.
env.TRANSLUNAR_TEST_PLUGIN_SOURCE = path.join(resourcesPlugins, "example.hello-srt-0.1.0.tlplugin");
```

#### Correct

```typescript
catch (error: unknown) {
  setError(formatError(error));
  await load(); // Render Engine-owned status, revision, sourceKind, and lastError.
}
```

```typescript
const tempArchive = path.join(mkdtempSync(...), "hello-srt.tlplugin");
copyFileSync(catalogArchive, tempArchive);
env.TRANSLUNAR_TEST_PLUGIN_SOURCE = tempArchive;
// Assert inspect + installed row both show local archive; no absolute path in UI.
```

## Plugin Permission Review Surface

### 1. Scope / Trigger

Use this contract when rendering plugin capability requests, version changes,
grant scopes, consent decisions, or immutable audit evidence in the Plugins
panel. The renderer is a review client for Engine-owned authority; it does not
infer whether a plugin may attach or perform an operation.

### 2. Signatures

```typescript
window.translunar.invoke("plugin.permission.review", { pluginId });
window.translunar.invoke("plugin.permission.audit.list", {
  pluginId, requestId?, offset, limit,
});
window.translunar.invoke("plugin.permission.grant", {
  pluginId, requestId, expectedRevision, scope, actor, reason,
});
window.translunar.invoke("plugin.permission.deny" |
  "plugin.permission.revoke", {
  pluginId, requestId, expectedRevision, actor, reason,
});
```

The dialog consumes generated `PluginCapabilityReview`,
`PluginCapabilityRequestView`, `PluginCapabilityScope`, and
`PluginCapabilityAuditEntry` types only.

### 3. Contracts

- Open review loads the current review and first bounded audit page together.
  Closing the dialog discards local scope/reason drafts; reopening reloads
  authoritative requests, changes, decisions, revisions, and audit entries.
- Each request shows capability ID, localized effect, requested/granted scope,
  required/optional status, contribution ID, supported flag, risk, decision,
  version-change kind, actor/reason, and revision without displaying secrets.
- A grant requires a non-empty reason, a supported request, and a scope no
  broader than the request. Unsupported optional requests remain visible and
  have Grant disabled. Deny/revoke use the exact displayed request revision.
- Every successful decision reloads review, audit, plugin inventory, and the
  owning Insights projection. The renderer never optimistically changes
  decision, plugin status, attachment, or audit order.
- The named modal traps focus, supports Escape, restores focus to its opener,
  and keeps the reason field, scope controls, actions, and audit reachable by
  keyboard. The dialog uses the shared surface tokens and must not inherit the
  global full-width input rule for checkboxes.
- English and Simplified Chinese catalogs own all labels/effects. Long IDs,
  scopes, reasons, and unsupported text wrap without horizontal document or
  dialog overflow at 1250x744, 1680x942, and 1920x1080.

### 4. Validation & Error Matrix

| Condition | Required UI behavior |
| --- | --- |
| Review/audit load fails | Keep inventory usable, show named bounded error, clear busy state |
| Reason is blank | Disable grant/deny/revoke without hiding request evidence |
| Request is unsupported | Show unsupported effect/status; disable Grant; allow an explicit deny when valid |
| Grant scope is broader than requested | Keep Grant disabled; do not send the RPC |
| Engine returns `conflict` | Show typed error and reload authoritative review before another decision |
| Decision succeeds and detaches plugin | Reload inventory and show Engine-owned disabled state |
| Long content or 125% Windows scaling | No clipped labels, action overlap, checkbox stretching, or horizontal overflow |

### 5. Good / Base / Bad Cases

- Good: open review, inspect a version scope expansion, enter a reason, narrow
  scope, grant, enable, reopen after restart, revoke, and read ordered audit.
- Base: show an unknown optional request as unsupported and pending while the
  known required request remains independently reviewable.
- Bad: hide unsupported requests, grant every request on install, mutate the
  plugin row optimistically, or expose raw manifest/credential values as scope.

### 6. Tests Required

- Unit tests cover scope containment controls, supported/unsupported action
  guards, decision labels, localization keys, and bounded error formatting.
- Real-Engine Electron E2E covers pending install, review, scoped grant,
  enable, restart, audit display, revoke/detach, typed failure, and subsequent
  healthy RPC behavior with zero page/console errors.
- E2E asserts focus entry/return, named modal/actions, checkbox and label
  geometry, dialog/document overflow, and inspected screenshots at 1250x744,
  1680x942, and 1920x1080.

### 7. Wrong vs Correct

#### Wrong

```typescript
setPlugins((items) => items.map((item) =>
  item.id === pluginId ? { ...item, status: "enabled" } : item,
));
```

#### Correct

```typescript
await window.translunar.invoke("plugin.permission.grant", {
  pluginId,
  requestId: request.id,
  expectedRevision: request.revision,
  scope: scopeDraft,
  actor: "desktop",
  reason: reason.trim(),
});
await openReview(pluginId, true);
await load();
```

## Tier 2 Plugin Panel Isolation

### 1. Scope / Trigger

Use this contract when changing `translunar-plugin://`, plugin panel session
IPC, renderer/navigation teardown, the Plugins panel preview, or the
`MessageChannel` bridge. The iframe is untrusted package content with an opaque
origin; only Electron main may translate an Engine-validated UI contribution
into a short-lived asset session.

### 2. Signatures

The trusted preload exposes only:

```typescript
issuePluginPanelSession({ pluginId, contributionId, revision }):
  Promise<{ sessionId: string; url: string; expiresAtMs: number;
            revision: number; bridgeVersion: 1 }>;
revokePluginPanelSession(sessionId: string): Promise<boolean>;
onPluginPanelRevoked(listener: (pluginId: string | null) => void): () => void;
```

`PluginAssetSessionRegistry` owns `issue`, `handle`, `revoke`, `revokeOwner`,
`revokePlugin`, and `revokeAll`. `PluginPanelHost` renders
`<iframe sandbox="allow-scripts">`; `createPanelBridge` accepts only version 1
`ready`, `request`, and `cancel` messages. The only request method is
`panel.context` with an exact empty object.

### 3. Contracts

- Main accepts issue/revoke IPC only when `senderFrame === sender.mainFrame`
  and the top-level frame URL is the trusted renderer URL. After Engine returns
  surface metadata, main re-reads authoritative plugin status, active version,
  revision, contribution, and bridge version before issuing the session.
- A 256-bit opaque token is bound to webContents owner, plugin, active version/
  revision, contribution, canonical package root, surface, expiry, and bridge
  version. Global, owner, and plugin generation epochs make a concurrent issue
  fail when reload, navigation, crash, lifecycle mutation, or shutdown revoked
  its authority.
- Session state is `issued -> binding -> bound -> revoked`. The HTML entry may
  be fetched exactly once. A bound session may fetch only non-entry files below
  that entry's directory. Every asynchronous realpath/stat/read is followed by
  a session identity/state/expiry check, closing issue/serve versus revoke
  TOCTOU windows.
- The handler accepts GET without credentials, port, query, fragment, Range,
  encoded separator, raw/decoded dot component, traversal, symlink/reparse,
  directory, unknown MIME, or file over the configured limit. It returns
  no-store, nosniff, no-referrer and a closed CSP. ES-module assets use the
  custom scheme as the same opaque resource boundary; no network fallback is
  allowed.
- Renderer reload, main-frame navigation, render-process loss, window close,
  plugin disable/revoke/upgrade/uninstall, Engine sandbox failure, expiry, and
  app shutdown revoke matching sessions before later requests can succeed.
- The iframe receives no preload, Node, Electron IPC, same-origin authority,
  navigation, popup, form, download, worker, or network capability. Because its
  origin is opaque, the one-time initialization targets `*`; authority is the
  transferred port plus a fresh 256-bit nonce, not a `window.message` origin.
- The bridge requires the exact nonce/version handshake, unique IDs, at most 32
  pending requests, 3,000 ms deadlines, 256 KiB UTF-8 payloads, depth 16, 4,096
  nodes/items, 1,024 object entries, 256-byte keys, and strict discriminants.
  Unknown cancel, duplicate/unknown fields, bad version/nonce/codec, timeout,
  reload, or navigation closes the port and revokes the asset session.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Subframe/untrusted sender or stale Engine revision | Reject issue/revoke; no token or path disclosed |
| Revoke occurs during issue, realpath, stat, or read | Epoch/identity recheck denies response; session cannot revive |
| Entry replay or asset outside the entry directory | Generic denial and no bytes |
| Raw/encoded/normalized traversal, symlink, bad MIME, Range, query | Generic denial with no path/plugin diagnostic |
| Second iframe load, navigation, renderer reload/crash | Close bridge and revoke owner session |
| Wrong nonce/version/message shape, deep/large payload, unknown cancel | Fail closed: clear timers, close port, revoke session |
| Bridge request exceeds deadline | Return bounded timeout when possible, then close and revoke |
| Plugin lifecycle or runtime failure revokes panel | Render localized revoked state; do not retain iframe authority |

### 5. Good / Base / Bad Cases

- Good: issue from the trusted top frame, consume entry once, load local module/
  CSS assets, complete nonce handshake, request context, then revoke on disable.
- Base: close the preview before issuance completes; the late token is revoked
  immediately and never rendered.
- Bad: use `allow-same-origin`, trust `event.origin`, serve the entry twice,
  allow the whole package tree after binding, skip post-read state checks, or
  leave a port alive after an unknown cancellation.

### 6. Tests Required

- Main unit tests cover issue/revoke epochs, single-use entry, surface subtree,
  expiry, owner/plugin/global revoke, asynchronous TOCTOU, raw and normalized
  traversal, symlink/reparse, MIME/header/CSP, and generic denial.
- Renderer unit tests cover iframe attributes, nonce/version handshake, exact
  `panel.context` codec, message byte/depth/node/key/collection limits,
  duplicate IDs, unknown cancel, timeout, external revoke, timer cleanup, and
  idempotent close.
- Real Electron E2E installs/grants/enables the official example, asserts a
  nonblank Connected iframe and real bridge exchange, blocked dangerous APIs/
  network/navigation, fresh session after restart, revoke/disable/uninstall,
  zero page/console/protocol errors, and no overflow at 1250x744, 1680x942, and
  1920x1080.

### 7. Wrong vs Correct

#### Wrong

```typescript
iframe.setAttribute("sandbox", "allow-scripts allow-same-origin");
window.addEventListener("message", (event) => trust(event.origin, event.data));
```

#### Correct

```typescript
const channel = new MessageChannel();
frameWindow.postMessage({ version: 1, type: "translunar.plugin.initialize", nonce }, "*", [channel.port2]);
// Only the transferred port may complete the exact nonce/version handshake.
```

## Packaging and localization shell

- Package with `apps/desktop/electron-builder.yml`; unsigned artifacts are valid
  for development.
- Shell copy should prefer `i18n/messages.ts` catalogs (`en-US` / `zh-CN`).
- Product-facing status, dialog, tutorial, update, backup/restore, allowlist,
  and accessibility labels must use the typed catalog. Protocol/`formatError`
  technical payloads may remain audited English; product-facing structured
  codes such as `policy_denied` must map through `formatEngineError` + catalog
  keys (see Engine-Backed AI Control And Assistant). Remaining hard-coded
  English in `Workbench.tsx` is owned by the separate visual task and is not
  an excuse to add new uncatalogued shell strings elsewhere.
- Project Home may use its dedicated Settings affordance. Workbench and
  secondary workspace surfaces expose Settings through their application
  overflow menu; they must not render a fixed floating Settings control over a
  status bar, panel rail, or document content.
- Backup restore validation is main-process-owned. Read at most an 8 MiB
  `manifest.json`, reject more than 100,000 listed files, and re-check manifest
  metadata after the bounded read. Hash every manifest-listed payload with a
  stream; never load a potentially multi-gigabyte SQLite or backup file through
  `readFile` merely to compute SHA-256.
- A restore preview issues one short-lived, single-use confirmation token bound
  to the canonical backup path and exact manifest fingerprint. Apply reserves
  the token synchronously, then revalidates the backup and fingerprint before
  stopping the Engine or staging/swapping the live data directory.
- An update installation must create a workspace backup, require the returned
  path to exist, and validate that backup before `prepareInstall` or native
  installer invocation. Backup failure leaves the downloaded package staged
  but must not start installation.

### Convention: Engine resource path and package size gates

**What**: `scripts/package-desktop.mjs` stages the verified host Engine under
`apps/desktop/.package-engine-resource` and exports
`TRANSLUNAR_ENGINE_RESOURCE_DIR` as that **relative** name only. `extraResources`
in `electron-builder.yml` copies from `${env.TRANSLUNAR_ENGINE_RESOURCE_DIR}` to
`engine`. Chromium locales are limited via `electronLanguages: [en-US, zh-CN]`.

**Why**: electron-builder resolves `extraResources.from` against the project
directory (`apps/desktop`). An absolute Windows temp path is joined as
`apps/desktop\C:\Users\...\Temp\...`, so the Engine never ships
(`file source doesn't exist`). Full Chromium locale packs bloat the package by
~45 MiB without product benefit.

**Hard gates** (`pnpm release:package:check`, see `docs/packaging.md`):

| Artifact | Ceiling | Source |
| --- | --- | --- |
| Downloadable installer (`.exe` / `.dmg` / `.zip` / …) | **200 MiB** | PRD N-02 安装包 |
| Unpacked `*-unpacked` directory | **420 MiB** | Electron 41 runtime floor + app + Engine |

Do **not** re-apply the 200 MiB installer ceiling to the intermediate
`package:dir` tree — Electron alone already exceeds it. Always assert
`resources/engine/<host binary>` exists after package.

**Wrong**:
```js
// Absolute temp path → Windows drops Engine from the package
TRANSLUNAR_ENGINE_RESOURCE_DIR = await mkdtemp(join(tmpdir(), "engine-"));
```

**Correct**:
```js
const engineResourceRel = ".package-engine-resource";
// Stage under apps/desktop; pass only the relative name to electron-builder
TRANSLUNAR_ENGINE_RESOURCE_DIR = engineResourceRel;
```

**Tests required**: `package-architecture.test.mjs` (relative staging +
`electronLanguages`); `release:package:check` after a real `package:dir` /
installer build on a new candidate SHA.

## E2E Product-Shell Regression Contracts

### 1. Scope / Trigger

Use this contract when adding or repairing desktop E2E coverage for locale,
backup/restore, interop, accessibility labels, or any product-shell dialog.
These tests cross the renderer, preload, Electron main process, and real
Engine, so test setup is part of the behavior being verified.

### 2. Signatures

The shared harness accepts an optional locale and fixture seams:

```typescript
launchHarness(label, {
  locale?: "en-US" | "zh-CN",
  interopReviewInput?: string,
  interopTableInput?: string,
});
```

The corresponding main-process seams are:

```text
TRANSLUNAR_TEST_INTEROP_REVIEW
TRANSLUNAR_TEST_INTEROP_TABLE
TRANSLUNAR_TEST_BACKUP_DESTINATION
```

### 3. Contracts

- The harness sets the locale and verifies persistence **before the first
  setup/import interaction**. A test may override the default `en-US` with
  `zh-CN`, but it must not rely on the host OS locale for accessible names.
- Backup destinations and other fixture paths live outside the active
  `TRANSLUNAR_DATA_DIR`. The seam must exercise the same destination and
  no-clobber checks as a user-selected path.
- Accessible-name assertions use the rendered catalog text and `aria-label`,
  including the current locale; they do not preserve obsolete English labels.
- Interop fixture variable names are shared constants by convention: a test
  rename is incomplete until the main-process reader and every harness caller
  use the same name.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Host locale is `zh-CN` and no explicit test locale is supplied | Harness pins `en-US` before setup and verifies it after reload |
| Test requests `zh-CN` | All later locators use the Chinese catalog/accessibility names |
| Backup seam resolves inside live data directory | Test setup rejects or relocates it; no live workspace mutation is allowed |
| Interop env name differs between harness and main | Focused test fails before the dialog flow is counted as evidence |
| Label changed in the catalog | E2E updates its accessible-name assertion from the catalog, not a stale literal |

### 5. Good / Base / Bad Cases

- Good: create an isolated data directory, choose an external backup target,
  set locale, reload, and then perform the first UI action.
- Base: a canceled dialog returns `null`, leaves the surface unchanged, and
  does not call the Engine mutation.
- Bad: click an English `getByRole` locator before locale initialization,
  place the backup fixture under the live data directory, or silently fall
  back to a different interop environment variable.

### 6. Tests Required

- A harness unit/focused E2E assertion that the locale is persisted across a
  reload before setup interaction.
- A real-Engine backup flow that proves `manifest.json` is written outside the
  live data directory and that the success status is visible.
- Interop review and table flows that set both exact environment names and
  assert the selected fixture reaches main-process dialog handling.
- Bilingual shell/accessibility checks that assert current catalog names,
  focus entry, Escape behavior, and no unlabeled buttons.
- A full desktop E2E run on the supported Node line before release; focused
  passes are evidence for the slice only.

### 7. Wrong vs Correct

#### Wrong

```typescript
await dismissFirstRunTutorial(page);
await page.getByRole("button", { name: "Import" }).click();
await page.evaluate(() => window.translunar.updateShellSettings({ locale: "en-US" }));
```

#### Correct

```typescript
await dismissFirstRunTutorial(page);
await page.evaluate(async () => {
  await window.translunar.updateShellSettings({ locale: "en-US" });
});
await page.reload();
await expect(page.getByRole("button", { name: /Import|导入/ })).toBeVisible();
// Only now begin setup/import interactions.
```

## Plugin QA And Pipeline Projections

### 1. Scope / Trigger

Use this contract when rendering plugin contribution inventory, QA plugin
provenance, pipeline execution history, grants, compatibility, lifecycle
state, or bounded plugin failures in Electron.

### 2. Signatures

Renderer code consumes generated Engine projections only:

```text
PluginContributionDescriptor::QaRule(QaRuleContributionDescriptor)
PluginContributionDescriptor::PipelineStep(PipelineStepContributionDescriptor)
QaRunPluginRuleExecution
PipelineStepPluginBinding / PipelineStepPluginAttempt
```

Lifecycle actions continue through generated `DesktopApi` methods such as
`plugin.permission.*`, `plugin.enable`, `plugin.disable`, and
`plugin.uninstall`.

### 3. Contracts

- React displays Engine-owned owner/version/tier/state/grant/compatibility and
  history projections. It does not execute plugin code, validate config, infer
  authority, open SQLite, or reconstruct provenance from manifest JSON.
- Contribution identity and durable history remain visible after disable,
  degradation, upgrade, rollback, or uninstall. Long immutable IDs must use a
  bounded detail treatment without changing the underlying value.
- A bounded failure may display its stable code and sanitized message. The UI
  must never request or expose source/target payloads, config secrets, raw
  plugin output, stderr, or host paths as diagnostic detail.
- Controls use current lifecycle revision and generated request types. After a
  mutation, replace local display data with the authoritative Engine response.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Contribution is detached or plugin is degraded | Show inactive/degraded state and bounded last failure; do not offer execution as available |
| Grant is absent/revoked | Show exact operation authority as unavailable; route review through permission RPCs |
| Durable QA/pipeline history exists after uninstall | Continue rendering recorded owner/version provenance |
| Unknown generated union variant | Fail type checking or render the shared unknown-state fallback; never cast raw payload fields |
| 1250px viewport has more tabs than fit | Keep keyboard-operable intentional tab scrolling; prevent document-level horizontal overflow |

### 5. Good / Base / Bad Cases

- Good: show contribution version axes, exact grant, active tier/generation,
  recent attempt status, and a navigation path to durable QA/pipeline detail.
- Base: an installed plugin with pending grants shows compatible inventory but
  no active execution authority.
- Bad: mark a contribution active from manifest data, compute lifecycle state
  in React, display a raw exception, or let provenance IDs force page overflow.

### 6. Tests Required

- Unit tests cover generated-union narrowing and provenance presentation.
- Real Electron E2E covers install, review, grant, enable, QA/pipeline history,
  degraded/revoked state, disable, and uninstall with no console/page errors.
- Capture and inspect Plugins and QA/history surfaces at 1250x744, 1680x942,
  and 1920x1080 for overlap, clipping, uncontrolled overflow, keyboard access,
  and design-system consistency.

### 7. Wrong vs Correct

#### Wrong

```typescript
const active = manifest.permissions.includes("pipeline.register");
```

#### Correct

```typescript
const contribution = plugin.contributions.find((item) => item.id === id);
renderContributionState(contribution, plugin.status, plugin.lastError);
```

## Plugin AI Actions And Workbench Panel Surfaces

### 1. Scope / Trigger

Use this contract when rendering generated plugin AI actions, mounting an
Engine-registered plugin panel in the workbench, issuing an isolated panel
session, routing MessagePort bridge requests, or adapting the editor toolbar to
the space left by plugin and Suggestions docks.

### 2. Signatures

The renderer consumes generated methods only:

```text
plugin.aiAction.list / invoke / cancel / history.list
plugin.uiPanel.list / bridge.call
```

`PluginAiActions` renders `editorSelection` actions in the existing segment
overflow/action menu and `assistantSidebar` actions in the Assistant surface.
`PluginWorkbenchPanels` mounts `editorSidebar`, `assistantSidebar`, and
`bottomPanel` contributions. `PluginPanelHost` receives the exact generated
`PluginContributionOwner` and hosts only the existing isolated iframe/session
bridge.

### 3. Contracts

- React renders Engine inventory and exact owner/version/activation/state data;
  it never scans manifests, imports plugin code, infers grants, or treats a
  previously seen contribution ID as current authority.
- Plugin editor-selection actions join the existing accessible segment overflow
  menu rather than creating another row toolbar. A result remains a proposal.
  Replacement is applied only after explicit user acceptance through the
  existing revision-safe target update path.
- Panel placement is literal: editor-sidebar panels occupy a real side dock,
  assistant-sidebar panels join the Assistant region, and bottom panels join
  the bottom panel model. Built-in panels and actions retain their behavior and
  ordering.
- Explicit close state survives inventory refresh for the same exact owner.
  Lifecycle removal, revoke, upgrade, or a different owner generation removes
  stale state/session authority. A late issue result is revoked rather than
  mounted.
- The iframe remains `sandbox="allow-scripts"` with the opaque single-session
  MessagePort/nonce protocol. There is no production renderer-local bridge
  fallback. Bridge requests pass the exact owner and only the method's closed
  identifier payload (`projectId`, `segmentId`) or bounded proposal text; Engine
  responses supply the context.
- A bridge request timer remains active until the asynchronous Engine call
  settles. Timeout, malformed message, unknown cancellation, external revoke,
  navigation, reload, or unmount closes the port and revokes the asset session.
- `Workbench` observes `.editor-region` width. Below the compact threshold it
  moves segment filters into one labeled select, hides redundant TM/button text,
  and keeps icon-first controls named. No filter, search, TM, history, issue, or
  confirm capability may disappear. This is container-responsive behavior, not
  a viewport-only media query.

### 4. Validation & Error Matrix

| Condition | Required UI behavior |
| --- | --- |
| Action/panel inventory is detached, degraded, revoked, or replaced | Remove/disable the exact surface; never retain or rebind stale authority |
| User closes a panel and inventory refreshes unchanged | Keep it closed until explicit reopen |
| Action is canceled, times out, fails, or returns stale/invalid output | Keep editor text unchanged; show bounded failure; allow subsequent work |
| Proposal changes text | Require explicit acceptance and use the existing Engine mutation; no direct local patch |
| Panel issue completes after close/unmount/generation change | Revoke the late session and render no iframe |
| Bridge method/params are unknown or Engine rejects nested authority | Close/fail the request with bounded feedback; never run a local fallback |
| Editor region becomes narrow with both docks open | Compact controls without overlap, clipping, row-height distortion, or document overflow |
| Hidden compact label text | Parent control retains `aria-label`/title and keyboard operation |

### 5. Good / Base / Bad Cases

- Good: open a real editor-sidebar plugin panel, see its nonblank `Connected`
  content, invoke a selection action, explicitly accept the proposal, close the
  panel, refresh inventory, restart, and observe exact lifecycle behavior.
- Base: no active compatible contribution leaves built-in editor/Assistant/
  panel behavior unchanged and no empty plugin surface mounted.
- Bad: render selection actions as a second toolbar, apply plugin output on
  receipt, recreate a closed panel on polling refresh, send raw project context
  from React, or clear a bridge timeout before the Engine promise resolves.

### 6. Tests Required

- Renderer unit tests cover placement filtering/order, exact-owner close and
  lifecycle replacement, iframe attributes, nonce/version handshake, bridge
  timeout through async resolution, cancellation, revoke, and no local fallback.
- Real-Engine Electron E2E installs/reviews/grants/enables the public Tier 2
  example, asserts action placement and explicit acceptance, verifies iframe
  content plus `Connected`, exercises restart/revoke/upgrade/disable/uninstall,
  and fails on console/page/protocol errors.
- At 1250x744, assert every visible editor-toolbar item is inside
  `.editor-region`, pairwise non-overlapping, and document scroll width does not
  exceed client width. Repeat product evidence at 1680x942 and 1920x1080 and
  inspect panel content, accessible names, row heights, and horizontal overflow.
- Run lint, strict typecheck (including E2E), unit tests, production desktop
  build, and the full desktop E2E suite on supported Node 22/24 lanes.

### 7. Wrong vs Correct

#### Wrong

```tsx
const panel = manifest.contributions.find((item) => item.id === panelId);
const result = await localPanelBridge(method, { project, segment });
setSegments((rows) => patchTarget(rows, proposal.text));
```

#### Correct

```tsx
const panel = enginePanelInventory.items.find((item) => sameOwner(item.owner, owner));
const result = await window.translunar.invoke("plugin.uiPanel.bridge.call", {
  owner: panel.owner,
  method,
  params: { projectId, segmentId },
});
await acceptPluginProposalThroughExistingMutation(result);
```

## ORTHO Workbench Skeleton (Phase 2)

### 1. Scope / Trigger

Use this contract when changing Workbench chrome presentation: `Masthead`,
`FilterRail`, `DocumentMatrix` mounting, `ActiveAxis`, grid scrollbar
visibility, command-palette / global-search focus return, or document switch
leave-guard wiring inside `apps/desktop/src/renderer`.

Phase 2 is a **presentation extraction**. It must not change Engine, generated
contracts, preload, main-process, or persistence logic.

Source components:

- `components/workbench/Masthead.tsx`
- `components/workbench/FilterRail.tsx`
- `components/workbench/ActiveAxis.tsx`
- `components/workbench/DocumentMatrix.tsx`
- Host wiring: `Workbench.tsx`
- Focus helper: `restorePaletteOwnerFocus` in `workbench-utils.ts`

### 2. Signatures

```ts
// ActiveAxis — decorative singleton marker (parent owns residence).
type ActiveAxisVariant = "row" | "chip";
interface ActiveAxisProps {
  variant: ActiveAxisVariant;
}
// Renders one [data-axis="active"] node; aria-hidden; no focus ownership.

// FilterRail — exactly three logical groups.
type RailStatusFilter =
  | "all"
  | "untranslated"
  | "draft"
  | "confirmed"
  | "issues";
type MatchBucket =
  | "all"
  | "101"
  | "100"
  | "95-99"
  | "85-94"
  | "75-84"
  | "50-74"
  | "none"
  | "mt";
interface FilterRailProps {
  counts: FilterRailCounts; // total, untranslated, draft, confirmed, openIssues
  filter: RailStatusFilter | string;
  onFilterChange(value: RailStatusFilter): void;
  matchBucket: MatchBucket; // presentation-only except "all"
  onMatchBucketChange(value: MatchBucket): void;
  issuePosition: number;
  issueTotal: number;
  onNavigateIssue(direction: -1 | 1): void;
  showChipAxis?: boolean; // mount ActiveAxis under selected chip
  secondaryFilters?: ReactNode; // tagged/commented compact path only
}

// DocumentMatrix — document-ordinal space only.
interface DocumentMatrixProps {
  segmentStates: readonly MatrixSegmentState[]; // length = counts.total
  activeIndex: number; // document ordinal; negative = none
  viewportRange: readonly [number, number]; // [start, end) document ordinals
  onNavigate(segmentOrdinal: number): void;
  onScrollBy?(deltaY: number): void; // forward wheel to .segment-grid
  labels: DocumentMatrixLabels; // i18n from host catalog
}

// Palette focus restore (renderer-local pure helper).
function restorePaletteOwnerFocus(
  owner: HTMLElement | null | undefined,
  fallback: HTMLElement | null | undefined,
): void;
```

### 3. Contracts

#### ActiveAxis singleton

- Workbench computes one `axisResidence`: `"row" | "chip" | "hidden"`.
- Precedence: active segment row wins when `activeId` is set; otherwise the
  current status chip; otherwise hidden.
- At most one `[data-axis="active"]` under the Workbench surface in normal
  focused states. Do not render one axis per chip or per row.
- Axis is decorative (`aria-hidden`); targets keep their own focus ring and
  keyboard semantics. Prefer `--signal` and honor `prefers-reduced-motion`.
- Do not duplicate or replace the shell-owned Phase 1 Index Spine marker.
  Remove competing Workbench-only axis pseudo-elements (e.g. old
  `.id-cell::before`) when mounting `ActiveAxis`.

#### FilterRail three groups

1. Status chips: All / Untranslated / Draft / Confirmed / Issues with
   authoritative counts and `aria-pressed` (or equivalent) current state.
2. Match selector: full design vocabulary; **only `all` is live** in Phase 2.
   Non-live options are deferred/disabled presentation; they must not write
   Engine/RPC fields, fabricate scores, or filter rows.
3. Issue navigation: previous/next via existing `navigateIssue`, truthful
   `n/N`, disabled when `issueTotal === 0`.

Absent from the main rail: in-document search, Exact TM decorative strip,
command/undo/redo/comment icon strip, and the rail Confirm button. Those
behaviors stay on keyboard / command-palette / Stack / row paths
(`Ctrl+F`/`Ctrl+H`, `Ctrl+Enter`, etc.). E2E must confirm segments via the
active textarea `Control+Enter` contract, not a removed rail Confirm button.

#### DocumentMatrix document ordinals

- `segmentStates` is indexed by **authoritative document ordinal**
  (`segment.ordinal`), length = `counts.total`. Unknown/unloaded slots are
  `null` (neutral hollow). Never invent state for unloaded positions.
- Aggregate priority among fully-known members:
  `error > untranslated > draft > confirmed`. Any null/undefined member in a
  cell keeps the aggregate **neutral**.
- `activeIndex` and `viewportRange` are document ordinals, not filtered-list
  or virtual-window list indices.
- Bracket drag / ratio seeking maps through `documentOrdinalFromRatio` then
  `onNavigate(ordinal)` so filtered views still seek the correct document
  segment. Do not map drag Y through filtered scroll height alone.
- `.segment-grid` is the **sole scroll owner**. Matrix wheel and seek forward
  to that container. Hide the grid scrollbar visually while retaining
  wheel/touchpad/keyboard/programmatic/accessibility scrolling.
- Matrix keyboard: native **roving tabindex** — exactly one dot
  `tabIndex={0}`; arrows/Home/End move real DOM focus and `data-focus`; Enter
  navigates that cell's document ordinal; Escape returns focus to the grid.
  Do **not** put `aria-activedescendant` on `role="navigation"` (axe
  `aria-allowed-attr`).

#### Masthead and leave-guard

- Identity plate uses real workspace projection (project name, source → target
  locales, document/file count). No decorative fallback project names.
- Sole 45° bevel is the identity `brand-plate`.
- Document switcher calls the existing save-before-navigation path
  (`persistAllSegments` then open), never a direct load that drops drafts.
- Surface leave continues through `onRegisterLeaveGuard` → App
  `goToSurface` / `returnHome` await flush before unmount.
- Run QA / Export keep existing handlers, busy, and error semantics.

#### Focus return

- Command palette close always runs a single dismiss path that calls
  `restorePaletteOwnerFocus(invocationOwner, editorRegionFallback)`.
- Prefer a still-connected invocation owner; otherwise focus a stable
  Workbench fallback (editor region). Do not leave focus on a detached node.

#### Layout host (Phase 2–4 intentional)

- Workbench keeps the legacy flex host (`workbench-layout` /
  `editor-column` / `editor-grid-row`). Full `.wb` CSS grid +
  `data-stack=collapsed|overlay` is **still deferred after Phase 4** so Matrix
  / SegmentGrid scroll ownership stays intact. Dual-pane Stack and PreviewDock
  ship on this flex host. Do not claim `.wb` mounting is complete until a later
  layout task remounts it.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Segment active and chip focused | Exactly one axis; row residence wins |
| No active segment; status filter selected | Chip axis under selected chip |
| Matrix cell has any null member | Neutral hollow; no definitive color |
| Matrix navigate while filter hides target | Clear incompatible projection as existing seek requires; then `setActiveId` + grid scroll; do not mutate segment body |
| Match selector non-`all` chosen | No Engine request field; option deferred/disabled |
| Zero open issues | Issue prev/next disabled; show `0/0` or equivalent truthfully |
| Document switch with pending draft | Await `persistAllSegments`; on failure keep current document and show typed error |
| Palette dismiss with disconnected owner | Focus editor-region fallback |
| Navigation landmark + `aria-activedescendant` | Forbidden; use roving tabindex on dots |

### 5. Good / Base / Bad Cases

- Good: Matrix bracket drag under an Issues filter still seeks the correct
  document ordinal and scrolls the real grid without stealing textarea focus.
- Good: dismiss command palette opened from a chip; focus returns to that chip
  if still connected.
- Base: empty document (`counts.total === 0`) mounts no Matrix; rail still
  shows truthful zero counts.
- Bad: `segmentStates` built from `editorRows` indices only (filtered/list
  space), leaving gaps or wrong colors for off-window ordinals.
- Bad: one `ActiveAxis` per chip plus a row pseudo-element (DOM count > 1).
- Bad: re-adding a rail Confirm button and writing E2E against it while
  product confirm is `Control+Enter` on the active textarea.
- Bad: `role="navigation"` with `aria-activedescendant` on `.doc-matrix`.

### 6. Tests Required

- Unit: `ActiveAxis` singleton marker; `FilterRail` three groups + deferred
  match options; `DocumentMatrix` roving focus (no illegal ARIA attr, one
  tab stop, real `document.activeElement` movement, exact ordinal Enter);
  `documentOrdinalFromRatio` / `aggregateCells` / neutral mixed buckets;
  `restorePaletteOwnerFocus` connected vs disconnected owner.
- Host projection: Matrix states length equals `counts.total`; loaded rows
  write `segment.ordinal` slots only.
- E2E (when Engine binary available): Matrix present beside grid; hidden
  scrollbar with scroll still working; document switch flush; ActiveAxis
  count ≤ 1; no permanent masthead search control; segment confirm via
  `Control+Enter`; supported widths 1250×744 / 1680×942 / 1920×1080 with no
  page-level horizontal overflow; axe free of critical Matrix ARIA errors.
- Typecheck and desktop Vitest remain green without Engine/contract edits.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Filtered-list indices as Matrix state; invents colors for unknown slots.
const segmentStates = visibleRows.map((row) => row.segment.state);

// Illegal composite on navigation landmark.
<nav className="doc-matrix" aria-activedescendant={activeDotId}>
  {dots.map((dot) => (
    <button tabIndex={-1} />
  ))}
</nav>

// Second axis + rail Confirm regression.
<button data-axis="active" /> // per chip
<button>Confirm</button> // removed from Phase 2 rail
```

#### Correct

```tsx
const segmentStates = Array.from({ length: counts.total }, () => null);
for (const row of editorRows) {
  states[row.segment.ordinal] = hasIssue ? "error" : row.segment.state;
}

// Roving tabindex: one tabIndex={0}; arrows move real focus; Enter → ordinal.
<button
  id={matrixDotId(cell.startIndex)}
  tabIndex={i === rovingIndex ? 0 : -1}
  data-focus={i === rovingIndex ? true : undefined}
/>

// One axis from parent residence; confirm via textarea Control+Enter.
const axisResidence = activeId ? "row" : filter ? "chip" : "hidden";
restorePaletteOwnerFocus(owner, editorRegionRef.current);
```

## ORTHO Segment Grid and Cells (Phase 3)

### 1. Scope / Trigger

Use this contract when changing the Workbench segment grid presentation:
row/cell geometry, status lamps, target editor sizing, protected-tag capsules,
roving keyboard navigation, multi-selection/batch bar, inline QA strip, or
variable-height measurement for the virtual window.

Phase 3 is a **presentation extraction and keyboard surface**. It must not
change Engine, generated contracts, preload, main-process, draft journal
semantics, `useComposition`, leave-guard ownership, or editor-command
dispatch tables.

Source components / hook:

- `components/workbench/SegmentGrid.tsx`
- `components/workbench/SegmentRow.tsx`
- `components/workbench/SegmentStatusLamp.tsx`
- `components/workbench/TagCapsule.tsx`
- `components/workbench/SeamActionRail.tsx`
- `components/workbench/BatchBar.tsx`
- `components/workbench/InlineQaStrip.tsx`
- `components/workbench/segmentTypes.ts` (pure mappers + view contracts)
- `hooks/useRovingGrid.ts`
- Host wiring: `Workbench.tsx`
- Styles: `styles/30-surfaces/workbench.css`
- Catalog: `i18n/messages.ts`

### 2. Signatures

```ts
// Presentational lamp only — does not mutate segment/workflow/QA storage.
type SegmentLampState =
  | "untranslated"
  | "draft"
  | "confirmed"
  | "reviewed"
  | "signed"
  | "error"
  | "warning"
  | "locked";

function deriveLampState(input: {
  segmentState: SegmentState;
  workflowState: EditorWorkflowState;
  openIssue?: Pick<QaIssue, "severity" | "status"> | null;
  locked?: boolean;
}): SegmentLampState;
// Precedence: open error → open warning/info → locked → signed → reviewed →
// confirmed → draft → untranslated.

type GridColumn = "id" | "status" | "source" | "target";
function cellId(segmentId: string, column: GridColumn): string;
function rowId(segmentId: string): string;

type BatchActionId =
  | "confirm"
  | "clearTarget"
  | "lock"
  | "pretranslate"
  | "comment"
  | "cancel";

interface UseRovingGridOptions {
  rows: SegmentRowView[]; // mounted window only
  total: number; // filter-space count
  offset: number; // window start list index
  activeId: string | null;
  gridRef: RefObject<HTMLElement | null>;
  selectedIds: ReadonlySet<string>;
  anchorId: string | null;
  onSelectionChange(next: {
    selectedIds: Set<string>;
    anchorId: string | null;
  }): void;
  onActivate(segmentId: string): void;
  onSeekOrdinal?(listIndex: number): void | Promise<void>; // filter-space
  allFilteredIds?: readonly string[]; // full filter scope when expanded
  onSelectAllFilterScope?(): void | Promise<void>; // never window-only
  onRangeSelect?(
    fromListIndex: number,
    toListIndex: number,
    anchorId: string,
  ): void | Promise<void>;
  isRowEditable(segmentId: string): boolean;
  isComposing?(): boolean; // Workbench session + per-segment
}

// Host adapters (Workbench) — existing RPCs only:
// ensureFilterScopeIds → paged segment.editor.list (limit 200), cache by
//   document|filter|search|total; does not mount grid rows
// handleIgnoreFinding → window.prompt reason → qa.issue.waive (QA ids only)
// batch confirm → confirmSegment(id) per selected id
// batch clearTarget → confirm + updateDraft/scheduleSave (skip signed)
// batch lock / pretranslate → deferred toast; no bulk-sign / no invented RPC
```

### 3. Contracts

#### Workbench owns orchestration

- `Workbench` joins loaded editor rows into memoized `SegmentRowView`s (lamp,
  tags, findings, flags). Leaves receive views + stable callbacks only.
- Drafts, pending saves, composition refs, leave-guard `persistAllSegments`,
  editor commands, and ActiveAxis residence stay in Workbench.
- Target editing remains a controlled textarea (no `contenteditable`, no
  overlay editor). Capsules are atomic sibling controls ordered by existing
  tag positions.

#### Grid semantics and roving

- Grid root: `role="grid"`, one normal Tab stop, four columns (id / status /
  source / target). Rows/cells use deterministic `rowId` / `cellId`.
- Navigation mode: arrows move row/column; Enter enters target edit; Escape
  clears multi-select first (keeps anchor/Axis), then returns to navigation
  without discarding draft.
- Edit mode: focus on target textarea; Tab advances next editable target
  (seek when needed); Ctrl+Tab exits the grid region; locked/signed skip
  edit advance but remain navigable.
- Virtual seek: when destination list index is outside the mounted window,
  call `onSeekOrdinal` / Workbench window loader, stash `pendingSeekRef`, and
  complete focus/`aria-activedescendant` only after the row mounts. Never set
  `aria-activedescendant` to an unmounted cell id.
- Matrix seek remains document-ordinal; grid seek uses **filter-space list
  index**. Do not conflate the two spaces.

#### Composition-first

Every Phase 3 key path returns before `preventDefault` / selection / navigation
/ tag move / batch / overlay when any of: injected `isComposing()`, global
`useComposition` guard, `event.isComposing`, or keyCode 229. While composing:
no confirm, no draft write schedule until `compositionend` + existing 400ms
debounce, no autocomplete update, no row/editor transition animation
(`html[data-composing]`).

#### Status lamps

- One 8px shape-coded lamp + localized accessible name per row.
- Shapes: hollow / half / solid / clipped / framed / cross / slash / bar.
- Forced-colors must keep shape/text distinction; do not use Lucide as the
  primary 8px lamp. Mapping is presentation-only.

#### Tags

- Reuse existing tag metadata and mutation callbacks; no XML parse.
- Pair highlight via shared `pairKey` (`pairId` or `id`); hover/focus either
  member highlights both when both are capsule-rendered.
- Missing → source capsule error; order mismatch → target capsule warning;
  issues also feed `InlineQaStrip`.
- Selected target capsule: `Alt+Left` / `Alt+Right` → existing move once;
  suppressed under composition or signed/locked.

#### Multi-selection and batch

- Selection is a set of stable segment IDs + anchor ID. Never mount hidden
  selected rows solely to style or count them.
- Ctrl+Shift+A / cross-window Shift range must use full filter-scope IDs
  (`allFilteredIds` or `onSelectAllFilterScope` / `onRangeSelect` →
  `ensureFilterScopeIds`). **Forbidden:** silent window-only select-all.
- Multi-select keeps ActiveAxis on the **anchor only**; other selected rows
  use neutral selected treatment.
- BatchBar (36px) shows only for multi-selection; emits intent; Workbench
  adapts. Missing adapters disable or toast deferred (lock, pretranslate) —
  do not bulk-map Lock to `workflow.signed`.

#### Inline QA

- Pure strip under source/target plates; severity icon + message + supported
  Locate/Ignore. No QA evaluation in the strip.
- QA findings: Ignore requires non-empty reason then `qa.issue.waive` +
  refresh open issues. Tag findings: `canIgnore: false` (not waivable via
  that RPC).
- ≥8px clearance from target editor to first interactive QA control; do not
  steal editor focus or assertively re-announce unchanged findings.

#### Measurement and virtualization

- Keep existing editor window + overscan; never mount all rows for large
  documents.
- One shared `ResizeObserver` + height cache by list index / segment identity;
  spacers use measured heights with estimate fallback; batch updates in rAF.
- Measured stride feeds Matrix viewport / scroll index via
  `onRowStrideChange` / `editorRowStride` — not fixed height alone when
  content-sized targets grow.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Arrow past mounted window | Seek window; complete focus after mount; no stuck no-op |
| `aria-activedescendant` target unmounted | Omit attribute until cell exists |
| Key while composing / keyCode 229 | No navigation, selection, confirm, tag move, or draft schedule |
| Ctrl+Shift+A with large filter | Full filter-scope IDs via list paging; not `editorRows` length |
| Batch Lock without collab adapter | Disabled + deferred toast; never loop `setWorkflowState("signed")` on `activeId` |
| Batch Pretranslate without adapter | Deferred toast → AI Control; no invented RPC |
| Batch Clear on signed row | Skip signed; confirm destructive for others |
| Inline Ignore, empty reason | Toast required; no waive RPC |
| Inline Ignore, `tag:*` finding id | No-op (not waivable) |
| Multi-select rows | Exactly one ActiveAxis (anchor/active row) |
| Measure unknown row | Use existing estimated row height |

### 5. Good / Base / Bad Cases

- Good: Tab in edit mode seeks past window end, focuses next editable
  textarea, keeps single Axis.
- Good: Ctrl+Shift+A selects 500 filtered IDs while ~100 rows are mounted;
  BatchBar reports total and hidden counts.
- Good: Ignore prompts reason, waives via Engine, refreshes issues, restores
  usable focus.
- Base: single-row selection hides BatchBar; Escape in navigate clears
  multi-select and keeps anchor.
- Bad: select-all = `visibleSegments.map(id)` only.
- Bad: batch Lock = `for (id of selected) { setActiveId(id); setWorkflowState("signed") }`.
- Bad: `contenteditable` or second draft timer for capsules/IME.
- Bad: `aria-activedescendant` pointing at a virtualized-away cell id.

### 6. Tests Required

- Unit: `deriveLampState` eight states + precedence; TagCapsule pair /
  missing / order / Alt move / composition suppress; `useRovingGrid` seek
  complete, Tab-in-edit, select-all expansion hooks, Escape, composition
  priority; SegmentGrid role/tabIndex/batch visibility/single Axis;
  SegmentRow lamp/QA/draft callbacks.
- Host: filter-scope expansion does not mount full document; batch
  lock/pretranslate non-mutating; Ignore waive path for QA ids only.
- E2E residual (when harness/Engine available): ten IME outcomes, axe with
  batch + inline QA visible, 10k mounted-row bound + same-machine P95.
- Typecheck and desktop Vitest green without Engine/contract package edits.

### 7. Wrong vs Correct

#### Wrong

```ts
// Window-only select-all sold as filter scope.
allFilteredIds={visibleSegments.map((r) => r.segment.id)};

// Lock races activeId and bulk-signs.
for (const id of selectedIds) {
  setActiveId(id);
  await setWorkflowState("signed");
}

// Seek without post-mount complete → stuck focus / unmounted descendant.
await onSeekOrdinal(listIndex);
return; // never sets focusSegmentId after rows update
```

#### Correct

```ts
// Expand via existing segment.editor.list pages (limit 200), cache by scope key.
const ids = await ensureFilterScopeIds();
onSelectionChange({ selectedIds: new Set(ids), anchorId });

// Missing batch adapter: disable + deferred toast (lock ≠ signed).
if (action === "lock") {
  setToast(t("workbench.batch.lockDeferred"));
  return;
}

// pendingSeekRef + effect on offset/rows → completeMove only when mounted.
if (pendingSeekRef.current && rowIndexById.has(destinationId)) {
  completeMove(pendingSeekRef.current);
}
```

## ORTHO Stack Dual-Pane and Preview Dock (Phase 4)

### 1. Scope / Trigger

Use this contract when changing the Workbench Stack (matches + terms + AI
drawer), match word-diff presentation, grounding inspector honesty, or the
preview dock under the grid column.

Phase 4 is a **presentation extraction**. It must not change Engine, generated
contracts, preload, main-process, TM/term scoring, or AI grounding semantics.

Source components:

- `components/workbench/Stack/StackPanel.tsx` — replaces tabbed `SuggestionsPanel`
- `components/workbench/Stack/MatchList.tsx` / `MatchCard.tsx`
- `components/workbench/Stack/TermList.tsx` / `TermRow.tsx`
- `components/workbench/Stack/AssistantDrawer.tsx`
- `components/workbench/Stack/GroundingInspector.tsx`
- `components/workbench/Stack/wordDiff.ts` (+ `wordDiff.test.ts`)
- `components/workbench/Stack/stackTypes.ts`
- `components/workbench/PreviewDock/PreviewDock.tsx` (+ `previewTypes.ts`)
- Host wiring: `Workbench.tsx` (`assistantOpen`, match/term hooks, prefs)
- Live reuse: `LiveAssistantPanel.tsx` mounts shared `GroundingInspector`
- Styles: `styles/30-surfaces/workbench-stack.css`
- Catalog: `i18n/messages.ts` (en + zh)

### 2. Signatures

```ts
import type {
  EditorMutationResult,
  PromptBundle,
  Segment,
  TermMatch,
  TmEntry,
} from "@translunar/contracts";
import type { PanelMode } from "../../workbench-utils"; // docked | collapsed | maximized

interface StackPanelProps {
  projectId: string;
  sourceLocale: string;
  targetLocale: string;
  mode: PanelMode; // expanded when not "collapsed"; maximized clamped by host
  onModeChange(mode: PanelMode): void;
  assistantOpen: boolean; // replaces retired suggestionTab === "assistant"
  onAssistantOpenChange(open: boolean): void;
  activeSegment: Segment | undefined;
  matches: TmEntry[];
  matchesLoading: boolean;
  matchesError: string | null;
  termMatches: TermMatch[];
  termLoading: boolean;
  termSettled: boolean;
  termError: string | null;
  onInsert(target: string): void;
  onApplyMutation(mutation: EditorMutationResult): void;
}

// Pure client word-level diff — no Engine, no color-block styling.
type DiffKind = "equal" | "delete" | "insert";
interface DiffToken {
  kind: DiffKind;
  text: string;
}
function tokenize(text: string): string[];
function wordDiff(activeSource: string, matchSource: string): DiffToken[];
// equal strings → single equal token (or []); delete = only in match source;
// insert = only in active source; LCS on whitespace / non-whitespace runs.

interface GroundingInspectorProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  snapshot: { contextKey: string; bundle: PromptBundle } | null;
  unavailableReason?: string | null;
}
// Real bundle → details/sections from bundle.sections. No bundle + reason →
// honest unavailable status. No bundle + no reason → render nothing.
// Never label UI "grounded" without inspectable section content.

interface PreviewDockProps {
  document: Document;
  activeSegment: Segment | undefined;
  segments: Segment[];
  total: number;
  mode: PanelMode;
  onModeChange(mode: PanelMode): void;
  height: number;
  onHeightChange(height: number): void;
  followActive: boolean;
  onFollowActiveChange(follow: boolean): void;
  onNavigateSegment(segmentId: string, ordinal: number): void;
  onSourceCorrected(segment: Segment): void;
}
// Host still owns PDF page list/get via existing effects inside PreviewDock.
```

### 3. Contracts

#### Stack dual-pane (no tabs)

- **Matches** and **Terms** sections are always co-mounted and co-visible when
  the stack is expanded. No Matches | Terms | Assistant | QA tab strip.
- QA is **not** re-hosted in Stack (Phase 3 inline QA + future QA Surface).
- Workbench retires `suggestionTab`; use `assistantOpen: boolean` only.
- Data remains Workbench-owned: `matches*`, `termMatches*`, insert, apply
  mutation. Stack leaves are presentational.

#### Single collapse control

- One primary collapse control when expanded → collapsed rail; one expand on
  the rail. **No** bidirectional arrow pair and **no** floating capsule as a
  second primary chrome.
- `Ctrl+9` / `editor.toggleSuggestions` continues to call
  `togglePanelCollapsed` on `suggestionsMode`.
- Collapsed body stays mounted, `inert` + `aria-hidden`; focus moves to the
  rail expand control; expand returns focus to the collapse control.
- Preference: if stored mode is `maximized`, clamp to `docked` on read for
  Stack. Do not restore maximize as a peer primary stack control.

#### Match cards and word-diff

- Cards use rule separators (not bordered card chrome). Header: score tier,
  library/source label, date; body: source (diffed) + target on deck; footer
  provenance + Insert (+ Alt+1..9 hint for ranks 1–9 when wired).
- Diff styling: `<del>` line-through + muted; `<ins>` 1px underline. **No**
  green/blue highlight blocks.
- Exact project TM UI may show **100%** tier when the Engine only returns exact
  hits (no invented fuzzy score). Do not add a client fuzzy ranker.

#### Term rows

- Compact `source → preferred target` + state chip (`preferred` | `forbidden` |
  `pending` via i18n). Forbidden uses error ink / clear mark and
  `data-forbidden`.
- Insert only for non-forbidden translations when the host supplies `onInsert`.
- No new term write RPC; add-term remains intent-only if unwired.

#### Assistant drawer + grounding honesty

- AI is a **bottom drawer**: collapsed bar (~status label); expanded hosts
  existing `AssistantPanel` / Live / Offline / plugin panels — no new AI RPC.
- Expanding the drawer must not hide Terms entirely; matches keep a usable
  min-height (~180px) under flex constraints.
- `GroundingInspector` renders only from a real `PromptBundle` (existing
  `ai.grounding.preview` / LiveAssistant path). Counts and section text come
  from the bundle. Unavailable → honest status string; never claim grounded
  without inspectable sections.
- Share one `GroundingInspector` between LiveAssistant and Stack; do not fork
  grounding presentation.

#### Preview dock (grid column only)

- Mount under the **editor/grid column only**, never under Stack.
- Chrome: document meta, follow-active checkbox, collapse/expand, pop-out,
  existing height drag (`clampPreviewHeight` / prefs), `Ctrl+P` toggle path.
- Follow-active highlight: signal-wash + left signal edge
  (`[data-preview-active]`), not a heavy orange frame.
- PDF: real page image + text layer when `pdf.page.*` data exists; dual column
  when both image and text exist; otherwise single path + honesty.
- Non-paginated formats: structure path only; explicit limitation copy — never
  fake print layout or page numbers.
- Pop-out is best-effort (`window.open` / hash). On block, disable control with
  honest aria-label/title. Do not claim multi-monitor product polish.

#### Layout host residual

- Dual-pane Stack + PreviewDock ship on legacy flex. `.wb` +
  `data-stack=collapsed|overlay` remain deferred (dead CSS until remount).
- Collapse rail width may still follow legacy `.suggestions-panel` tokens
  (~48px) rather than design 40px until `.wb` remount — document residual; do
  not break dual-pane for rail pixel perfection.
- `.segment-grid` remains sole scroll owner; do not add overflow-y owners on
  matrix or outer flex that steal Matrix viewport sync.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Expanded stack, TM + term hits | Matches and Terms both visible without tab switch |
| Stack collapse | Single control; body inert/aria-hidden; focus on rail expand |
| Stored `suggestionsMode: maximized` | Read as `docked`; no dual maximize/collapse primary chrome |
| Match source equals active source | Plain text; no empty ins/del noise |
| Match source differs | Word-level del/ins only; no color-block diff CSS |
| Forbidden term translation | Error treatment; no insert button for forbidden |
| Grounding snapshot null, no reason | Inspector renders nothing (not “grounded”) |
| Grounding snapshot null + reason | Honest unavailable status |
| Grounding snapshot present | Sections from `bundle.sections` only |
| Preview pop-out blocked | Control disabled + localized blocked reason |
| Non-PDF without layout structure | Limitation/honesty copy; no fake pages |
| Preview navigate click | Host `onNavigateSegment` only; no local `activeId` mutation |
| Engine/contracts/preload change for Phase 4 | Forbidden — expression-only |

### 5. Good / Base / Bad Cases

- Good: select a segment with TM + terms → both lists on screen; open AI drawer
  → generate → GroundingInspector lists real injected sections.
- Good: `Ctrl+9` collapses stack to rail; focus on expand; expand restores
  collapse control focus.
- Good: Preview under grid follows active segment with signal edge; PDF still
  loads page image when document is PDF.
- Base: no TM/terms → empty/loading/error visual states without circular
  spinners; assistant drawer stays collapsed by default.
- Bad: restore Matches/Terms/Assistant/QA tablist or put QA list back in Stack.
- Bad: dual maximize + collapse as peer primary stack controls or floating
  capsule toggle.
- Bad: green/blue block diff, invent fuzzy TM scores, or label UI “grounded”
  without a real `PromptBundle`.
- Bad: mount Preview under Stack, or remount `.wb` mid-task if it breaks Matrix
  / grid scroll ownership without a dedicated layout pass.

### 6. Tests Required

- Unit: `wordDiff` equal / substitute / insert / delete / empty; CJK or
  whitespace tokenization smoke as covered by colocated tests.
- Unit: `StackPanel` no tablist; Matches + Terms co-mounted; single collapse
  (no maximize peer label); collapsed body inert path where tested.
- Integration/host: Workbench wires `assistantOpen`, insert, applyMutation,
  preview prefs; no new Engine methods.
- Typecheck + `apps/desktop` renderer Vitest green without contracts package
  edits.
- E2E residual (when harness available): stack collapse intermediate geometry,
  Ctrl+9, preview follow/navigate, PDF page path, en/zh chrome strings; no
  page horizontal overflow at 1250×744 / 1680×942 / 1920×1080.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Tabbed mutual-exclusive panes — fails co-visible AC.
<div role="tablist">Matches | Terms | Assistant | QA</div>

// Color-block “diff” and invented fuzzy score.
<span style={{ background: "lightgreen" }}>{match.sourceText}</span>
<span>{Math.round(localFuzzy(match) * 100)}%</span>

// Grounding badge without inspectable content.
{didGenerate && <span>Grounded</span>}

// Second primary collapse chrome.
<button>Maximize</button>
<button>Collapse</button>
```

#### Correct

```tsx
// Co-visible sections + drawer + single collapse.
<section className="sec sec--matches">…</section>
<section className="sec sec--terms">…</section>
<AssistantDrawer open={assistantOpen} onOpenChange={setAssistantOpen} />
<button onClick={() => onModeChange(togglePanelCollapsed(mode))} />

// Word-level del/ins vs active source.
const tokens = wordDiff(activeSegment?.sourceText ?? "", match.sourceText);
tokens.map((t) =>
  t.kind === "delete" ? <del>{t.text}</del> :
  t.kind === "insert" ? <ins>{t.text}</ins> : <span>{t.text}</span>,
);

// Honest grounding only with real PromptBundle.
<GroundingInspector
  open={open}
  onOpenChange={setOpen}
  snapshot={bundle ? { contextKey, bundle } : null}
  unavailableReason={reason}
/>
```

## ORTHO Project Surfaces (Phase 5)

### 1. Scope / Trigger

Use this contract when changing Project Home, the setup wizard, or Project
Insights chrome/layout: composition rails, home §E2 tabs and project cards,
setup §E5 Stepper and form groups, insights §E3 vertical tab list, overview
decision actions, or extracted insights panels.

Phase 5 is a **presentation extraction**. It must not change Engine,
generated contracts, preload, main-process, `project-home-utils` clone/snippet
semantics, or invent new project lifecycle RPC methods.

Source components:

- Orchestrators (App-stable import paths):
  - `ProjectHome.tsx` — load/mutate home, dialogs, open VT
  - `SetupView.tsx` — options load, create, batch import, diagnostics
  - `ProjectInsightsPage.tsx` — load/mutate insights, busy/error/dialogs
- `components/project/CompositionRail.tsx` — shared 35%/30% brand rail
- `components/project/HomeTabList.tsx` — §E2 horizontal tabs
- `components/project/InsightsTabList.tsx` — §E3 vertical grouped tabs
- `components/project/Stepper.tsx` — §E5 vertical step list
- `components/project/ProjectCard.tsx`, `ProjectsPane.tsx`,
  `TemplatesPane.tsx`, `RecyclePane.tsx`
- `components/project/insights/*` — Overview, Files, Analysis, Reimport,
  Archive, History panels + `insightsShared.tsx`
- Styles: `styles/30-surfaces/project-home.css`, `setup.css`, `insights.css`
  (imported from `styles/index.css`)
- Catalog: `i18n/messages.ts` (`home.*` / `setup.*` / `insights.*`, en + zh)
- Pure helpers remain in `project-home-utils.ts` (+ tests)

### 2. Signatures

```ts
// Parent navigation contracts (unchanged)
interface ProjectHomeProps {
  onCreate(): void;
  onOpen(
    projectId: string,
    documentId?: string,
    segmentId?: string,
    segmentOrdinal?: number,
  ): Promise<void>;
}

interface SetupViewProps {
  onCreated(projectId: string, documentId: string): Promise<void>;
  onCancel?(): void;
}

// Insights — existing required props + additive optional deep-links
interface ProjectInsightsPageProps {
  snapshot: ProjectSnapshot;
  document: Document;
  onRefresh(): Promise<void>;
  onOpenDocument(documentId: string): Promise<void>;
  onOpenProject(projectId: string, documentId?: string): Promise<void>;
  onReturnHome(): void;
  onOpenQa?(): void; // residual copy when parent does not wire
  onOpenAiControl?(): void;
}

type HomeTabId = "projects" | "search" | "templates" | "recycle";

type InsightsTabId =
  | "overview"
  | "files"
  | "analysis"
  | "assets"
  | "alignment"
  | "interop"
  | "reimport"
  | "task-packages"
  | "discussions"
  | "plugins"
  | "archive"
  | "history";

// §E5 Stepper — zero-based current; optional navigate only ≤ current
interface StepperProps {
  steps: readonly { id: string; label: string }[];
  current: number;
  onSelect?(index: number): void;
  ariaLabel: string;
}
```

Layout shells (CSS grid contracts):

```css
.project-home-shell {
  display: grid;
  grid-template-columns: minmax(240px, 35%) minmax(0, 65%);
}
.setup-wizard-shell {
  display: grid;
  grid-template-columns: minmax(200px, 30%) minmax(0, 70%);
}
/* Insights: ~180px vertical tablist + content */
.project-card[data-opening] {
  view-transition-name: project-identity;
}
/* Masthead receive: .identity { view-transition-name: project-identity; } */
```

Engine methods remain the Project Lifecycle set (`project.*`, `recycle.*`,
`search.global`, `document.*`, `analysis.*`, `history.list`, archive export/
restore). No new invoke names or preload fields.

### 3. Contracts

#### Project Home 35/65

- **No** permanent left four-item vertical nav column (`project-home-nav`).
- Left `CompositionRail`: brand plate + inert CSS field + honest summary
  from data already loaded (project/template/recycle counts, last refresh).
  **Forbidden:** invent cross-project TM/term/corpus totals without RPC.
- Right: chrome (title, restore archive, new project) + horizontal
  `HomeTabList` §E2 (`projects` · `search` · `templates` · `recycle`) with
  counts on labels when totals are known.
- Projects pane: Active/Archived segmented control + plate/seam `ProjectCard`
  grid (`repeat(auto-fill, minmax(280px, 1fr))`, gap 0, rule seams) + paging.
- Search: existing `GlobalSearchPanel`; snippets only via
  `parseSearchSnippet` (never `dangerouslySetInnerHTML`).
- Templates: CRUD via existing template RPCs + `cloneTemplateDefinition`.
- Recycle: restore / permanent purge (name-confirm for purge).
- Empty state §D6: copy + primary create — not a huge dashed frame.
- Refresh: rail footer or meta text/button + last-loaded time; **no FAB**.
- Settings gear FAB must not return on Home (settings stay shell/Index Spine).

#### Project cards and `project-open` VT

- Plate + 3px Band Echo (only Echo on this surface), domain/locale, 4px
  progress from analytics completion, mono counts, archived desaturation +
  badge, overflow menu (open / lifecycle archive-restore / recycle; omit
  inventing save-as-template or export if not already wired on home).
- Open path: resolve document → set `openingProjectId` / card `data-opening`
  → `useViewTransition` → `onOpen(...)` → clear opening in finally.
- Shared name: card `[data-opening]` and Masthead `.identity` use
  `view-transition-name: project-identity`. Prefer surface transition when
  reduced motion or VT unsupported. Do not block open on perfect FLIP.
- Cards default `view-transition-name: none` so only the opening card morphs.

#### Setup wizard 30/70 + Stepper

- Left rail: composition + live summary (locales, file count) + `Stepper`
  (mono `01`/`02`/`03` + 12px gap + title; current left Active Axis; done
  check; future muted). Left rail `view-transition-name: none`.
- Right panel max-width ~720px; step content may use `data-wizard-dir` for
  next/back motion — not full-page wipe.
- Steps: (1) project identity — name + locales (source ≠ target), domain;
  omit workspace path picker unless already implemented. (2) configuration
  groups: reuse / quality / automation with consequence meta from real
  selection data only. (3) files dropzone + pickers + atomicity choice.
- Remove decorative SQLITE/LOCAL footer chips and wasteful side info columns.
- Create: `project.create` | `createFromTemplate` + `batchImport` + empty
  rollback unchanged. Dependency diagnostics stay until explicit open workspace.
- Preserve tutorial anchors (e.g. `tutorial-target-import`, create target).

#### Insights vertical tabs + overview + extracts

- Replace horizontal overflow strip with `InsightsTabList` §E3 (~180px):
  grouped presentation maps all twelve prior tab ids without dropping
  capability (overview/files/analysis · assets group · workflow group ·
  system group including archive + history).
- Selected: left Active Axis + shade; keyboard Arrow/Home/End; `role="tablist"`
  vertical orientation; roving `tabIndex`.
- Overview: every major metric block ends with a decision action. Prefer
  workbench `onOpenDocument` / files tab / history focus. Optional
  `onOpenQa` / `onOpenAiControl` only when parent wires them — otherwise
  residual localized copy, **never** a dead button that invents a surface.
- Stale analysis: banner + existing `analysis.run` re-run path.
- Orchestrator owns load/mutate/busy/error/dialogs; panels under
  `components/project/insights/*` receive props/callbacks. Embedded
  Asset/Alignment/Interop/Task/Discussion/Plugins panels remain mounts
  (Phase 6 owns deep asset rewrites).

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Home without cross-project TM totals | Show honest project-derived / refresh facts only |
| Open project with no active documents | Existing `home.noActiveDocuments` (or equivalent); no invented doc |
| Canceled archive restore / source dialog | No RPC; surface unchanged |
| Setup step 1 source === target | Block advance; `setup.languagesMustDiffer` |
| Setup dependency diagnostics present | Stay on Setup; explicit Open workspace only |
| Mixed batch import | Keep every diagnostic; successful IDs for explicit open |
| Overview QA/AI with no parent callback | Residual copy; no dead button |
| Analysis metric stale | Stale banner + re-run via existing analysis RPC |
| History/asset metric unavailable | `Unavailable` state from payload; never fabricate zero |
| Card open under reduced motion | Update without VT; still call `onOpen` and clear `data-opening` |
| Engine/contracts/preload change for Phase 5 | Forbidden — expression-only |

### 5. Good / Base / Bad Cases

- Good: Home 35/65 → horizontal tabs with counts → open card with VT →
  workspace; archive/recycle/restore archive still hit existing methods.
- Good: Setup three steps with grouped configuration, create + import,
  languages differ enforced, diagnostics then Open workspace.
- Good: Insights vertical groups reach all twelve former tabs; overview
  blocks expose actions or residual; subpanels extracted from the monolith.
- Base: empty projects tab uses §D6 empty + create; cancel dialogs leave
  lists unchanged.
- Bad: restore permanent four-item left nav on Home or horizontal-only
  insights strip that hides tabs off-screen without a vertical list.
- Bad: invent TM/term totals, vanity charts without actions, or new IPC
  for overview deep-links.
- Bad: auto-dismiss Setup dependency diagnostics or parse search HTML via
  `dangerouslySetInnerHTML`.
- Bad: leave ProjectInsights as a 1.6k monolith restyled only when extracts
  are low-risk.

### 6. Tests Required

- Unit: keep `project-home-utils.test.ts` (snippet parse, template clone).
- Unit: `Stepper` index/status/`aria-current`; `InsightsTabList` /
  `HomeTabList` keyboard roving when covered by colocated tests.
- Typecheck + `apps/desktop` renderer Vitest green without contracts/package
  Engine edits.
- Manual / E2E residual: create project three steps; card open; archive
  recycle; insights groups + overview actions; en/zh chrome; reduced-motion
  open still clears opening state.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Permanent vertical four-item home nav + invented TM total.
<nav className="project-home-nav">…</nav>
<span>{fakeTmTotal}</span>

// Dead QA button without parent route.
<button onClick={() => {}}>Open QA</button>

// Full-page wipe including stepper rail; auto-open workspace with diagnostics.
startViewTransition(() => setMode("workspace"));
useEffect(() => { void onCreated(id, doc); }, [created]);
```

#### Correct

```tsx
// 35/65 + honest counts + VT open.
<div className="project-home-shell">
  <CompositionRail title={…} footer={refreshMeta}>…</CompositionRail>
  <HomeTabList tabs={tabsWithCounts} active={tab} onChange={setTab} />
</div>
setOpeningProjectId(projectId);
await runTransition(async () => {
  await onOpen(projectId, documentId);
});
setOpeningProjectId(null);

// Overview: wire optional callbacks or residual — never dead control.
{onOpenQa ? (
  <button type="button" onClick={onOpenQa}>{t("insights.actionOpenQa")}</button>
) : (
  <p className="meta">{t("insights.residualQa")}</p>
)}

// Setup: keep diagnostics until explicit open.
setDependencyDiagnostics(result.diagnostics);
<button type="button" onClick={() => void onCreated(projectId, documentId)}>
  {t("setup.openWorkspace")}
</button>
```

## ORTHO Quality and Assets Surfaces (Phase 6)

### 1. Scope / Trigger

Use this contract when changing QA review, export review, or the Assets
surface (Spine label **资产**, surface id still `translation-memory`):
three-column QA layout, in-place target fix, export gate banner + degradation
lists, five-tab assets shell, TM/terms hubs, or ORTHO host styling for shared
curation/alignment/interop panels.

Phase 6 is a **presentation extraction**. It must not change Engine,
generated contracts, preload, main-process, provenance/curation/alignment
utils semantics (except additive pure presentation helpers with tests), or
invent new QA/export/TM/term RPC methods.

Source components:

- Orchestrators (stable import paths):
  - `QaReviewPage.tsx` — profiles/runs/issues/queue, run, waive, fix, report
  - `ExportReviewPage.tsx` — gate check, blockers, override export
  - `components/assets/AssetsSurface.tsx` — five tabs + overview strip
- `components/quality/*` — LiveMatrix, distribution/list/evidence, profile
  drawer, run history, export gate/degradation/actions, `qa-presenters.ts`
- `components/assets/*` — tab list, overview strip, TmHubPanel, TermbaseHubPanel
- Heavy panels stay at renderer root for Insights dual-host:
  `AssetCurationPanel.tsx`, `AlignmentCorpusPanel.tsx`, `InteropPanel.tsx`
  (`TaskPackagePanel.tsx` remains Insights process tab only)
- Styles: `styles/30-surfaces/quality.css`, `assets.css` (via `styles/index.css`)
- Catalog: `i18n/messages.ts` (`qa.*` / `export.*` / `assets.*`, en + zh)
- Routing: `WorkbenchPages.WorkspacePage` maps `translation-memory` → Assets

### 2. Signatures

```ts
// Workspace pages share WorkspacePageProps (snapshot, document, segments,
// issues, onNavigate, onRefresh, onOpenSegment, …). Do not require new App
// surface ids.

// In-place fix — mirror Workbench field set exactly
await window.translunar.invoke("segment.updateTarget", {
  segmentId: segment.id,
  targetText,
  expectedRevision: segment.revision,
});
// then: onRefresh() + reload issues; never silent success

// Export gate + delivery (payload shapes unchanged)
await window.translunar.invoke("qa.gate.check", { projectId, documentId });
await window.translunar.invoke("document.export", {
  documentId,
  outputPath,
  // only when gate.clear === false and override complete:
  qaOverride?: { actor: string; reason: string },
});

// Assets overview — real list totals only (limit:1 is fine for total)
await window.translunar.invoke("tm.library.list", { projectId, offset: 0, limit: 1 });
await window.translunar.invoke("termbase.list", { projectId, offset: 0, limit: 1 });

type AssetsTabId = "tm" | "terms" | "curation" | "alignment" | "interop";
// Default tab: "curation" when practical

// Pure presenters (unit-tested)
buildSeverityMatrix(segmentCount, issues, { maxCells?: number }): MatrixCellState[];
groupIssuesBySeverity(issues): IssueSeverityGroup[];
sliceWithSpans(text, spans): HighlightSlice[];
nextOpenIssueId(issues, currentId): string | null;
```

Layout shells (CSS grid contracts):

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
.export-ortho { /* gate stack; max-width ~960px */ }
.export-banner[data-state="blocked"] { border-inline-start: 3px solid var(--err); }
.export-banner[data-state="clear"] { border-inline-start: 3px solid var(--ok); }
.assets-ortho {
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-block-size: 0;
  height: 100%;
}
.tm-hub {
  display: grid;
  grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
}
```

Engine method sets remain the pre-Phase-6 catalog:

- QA: `qa.profile.*`, `qa.run` / `qa.run.list`, `qa.issue.*`, `qa.report.export`,
  `qa.gate.check`, `review.stats`, `review.queue`
- Segment: `segment.updateTarget` (Workbench shape)
- Export: `document.export` (+ existing path picker)
- TM/terms: `tm.library.*`, `tm.search` / `tm.lookupExact`, `termbase.*`, `term.search`
- Curation / alignment / interop: existing panel invoke graphs only

No new invoke names or preload fields.

### 3. Contracts

#### QA three-column (分布 / 清单 / 证据)

- Primary grid is **left distribution · center issue list · right evidence** —
  not filter-rail + bottom review-band as the main composition.
- Left (~180px): Live Matrix (segment ordinal → max severity from **loaded**
  issues; label partial projection when paginated), severity chips with
  counts, human-readable category/scope filters, open profile editor.
- Center (1fr): issue **rows** (3px severity edge; `severity · display name`;
  message line; waived desaturation; plugin provenance strip; `ruleId` mono
  meta only). Group by severity. Reviewer queue folds into a secondary
  group; open-segment only unless accept/reject RPCs already exist elsewhere
  (**do not invent** review decision methods).
- Right (~320–420px): segment source/target from `segments` prop (honest empty
  if missing); span wash via `evidence.sourceSpans` / `targetSpans`; actions
  定位到段 · 就地修复 · 忽略 (waive requires actor+reason).
- Header: title + last run meta + Run QA; history from real `qa.run.list`.
- Empty: no completed run → §D6 + run action.
- Profile editor: ~420px drawer; `qa.profile.clone` for built-ins,
  `qa.profile.update` for custom; mandatory-review via existing
  `project.update` configuration path.
- Live Matrix is **not** DocumentMatrix; cap cells (e.g. 2000); never invent
  full-document aggregation without an Engine method.

#### In-place fix

- Constrained target editor on evidence column; persist with
  `segment.updateTarget` using revision from matching `segments` entry.
- Ctrl+Enter: save and advance to next open issue when possible.
- After success: reload issues + parent `onRefresh`; do not require Workbench
  navigation. Failure: inline error.
- Plain text target is complete for this phase; TagCapsule parity is residual.

#### Export gate + degradation

- Delivery gate (not marketing hero): §A8 banner blocked (`--err`) vs clear
  (`--ok` + can-export).
- Gate rows use **real** `QaGateResult` / run fields only (blocking errors,
  warnings, checked segments, policy counts when present — no invented
  “all confirmed” if API omits the field).
- Actions: 查看问题 → `onNavigate("qa-review")`; 重新检查 → `qa.gate.check`.
- Primary export: original format via `document.export` + path picker.
  Extra formats residual (disabled + honest note) unless already invokable.
- **降级清单 required:**
  - Pre-export: `document.degradation` (code, message, structuralPath);
    empty → honest “no recorded degradation findings”.
  - Post-export: `ExportDocumentResult.degradation` on success.
- Override: actor+reason + `qaOverride` only when gate blocked; danger styling.
- Busy: deterministic text; **no** circular spinner.

#### Assets five tabs

- Surface id **`translation-memory`** unchanged (shell/keymap); content is
  Assets shell with header 资产 + overview strip of **real list totals only**
  (no fake grand totals).
- Exactly five §E2 tabs: TM · terms · curation · alignment · interop.
  Default tab: **curation** when practical.
- TM hub: library list + detail/search via `tm.library.*` + `tm.search` /
  `tm.lookupExact`; health matrix only from real buckets or inert residual.
- Terms hub: `termbase.list` / mount / create / `term.search` (import/export
  optional if already patterned elsewhere — not a forced AC).
- Curation / alignment / interop: mount existing panels (same props Insights
  uses); ORTHO token surfaces when styling is touched.
- TaskPackagePanel stays Insights-only (not a sixth assets tab).
- Dual-host Insights embeds remain valid; Assets is Spine destination.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No completed QA run | §D6 empty + Run QA; no fake issue rows |
| Issue list paginated (PAGE_SIZE) | Matrix caption/honest partial projection; no new aggregation RPC |
| Segment missing for selected issue | Honest empty source/target; do not invent text |
| In-place save fails | Inline error; do not claim success or advance |
| Waive without actor+reason | Block waive; require both fields |
| Gate blocked, override incomplete | Export disabled |
| Gate clear | Export enabled without override |
| Pre-export degradation empty | Honest empty copy (not zeros as “findings”) |
| Extra export formats unavailable | Residual disabled note; original format only |
| TM/term overview totals | From `*.list` `total` only; never fabricate |
| TM health buckets missing | Inert residual / honesty copy; no fake matrix clicks |
| Review queue non-empty | Secondary list group; open segment only if no decision RPCs |
| Engine/contracts/preload change for Phase 6 | Forbidden — expression-only |

### 5. Good / Base / Bad Cases

- Good: QA three columns; run QA; select issue; span evidence; in-place fix
  saves via `segment.updateTarget` and reloads; waive with actor+reason.
- Good: Export blocked banner → view issues; clear banner → export original
  format; pre/post degradation lists visible.
- Good: Assets five tabs default curation; TM/terms hubs use library RPCs;
  Insights still mounts curation/alignment/interop/task packages.
- Base: empty run §D6; empty degradation honest; overview counts null until
  list returns.
- Bad: restore filter-rail + bottom review-band as primary QA composition.
- Bad: invent severity aggregation, export formats, review accept/reject, or
  cross-project asset totals without Engine support.
- Bad: ruleId-only titles without human severity/display name + message.
- Bad: move/delete panel root files so Insights imports break.
- Bad: circular spinners, permanent box-shadow chrome, fake telemetry.

### 6. Tests Required

- Unit: `components/quality/qa-presenters.test.ts` (matrix projection, groups,
  span slice, next open issue).
- Unit: keep `plugin-provenance-utils`, `asset-curation-utils`,
  `alignment-corpus-utils` green when touched.
- Typecheck: `apps/desktop` renderer green without contracts/engine/preload
  package edits.
- Manual residual: run QA end-to-end; in-place fix + Ctrl+Enter advance;
  export path + override; five assets tabs; en/zh chrome; Insights dual-host.

### 7. Wrong vs Correct

#### Wrong

```tsx
// Invent full-document severity without aggregation RPC.
const cells = await inventSeverityForAllSegments(document.segmentCount);

// Rule id as sole title; no message/display name.
<title>{issue.ruleId}</title>

// Export without gate discipline / invented format RPC.
await invoke("document.exportXliff", { … });

// Fake overview total.
<span>{128_436}</span>

// Sixth assets tab for task packages (belongs on Insights).
tabs.push({ id: "task-packages", … });
```

#### Correct

```tsx
// Partial matrix from loaded issues + honest caption.
const cells = buildSeverityMatrix(document.segmentCount, issues, {
  maxCells: 2_000,
});

// Human row + mono rule meta.
<span>{severity} · {displayName}</span>
<span className="mono meta">{issue.ruleId}</span>

// Gate + original-format export; override only when blocked.
await invoke("qa.gate.check", { projectId, documentId });
await invoke("document.export", {
  documentId,
  outputPath,
  ...(!gate.clear ? { qaOverride: { actor, reason } } : {}),
});

// Real list totals only.
const page = await invoke("tm.library.list", { projectId, offset: 0, limit: 1 });
setTmTotal(page.total);

// Five tabs; default curation; dual-host panels at stable paths.
const [tab, setTab] = useState<AssetsTabId>("curation");
// TaskPackagePanel remains under Insights only.
```
