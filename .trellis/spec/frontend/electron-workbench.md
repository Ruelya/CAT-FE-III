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

The tested toolchain is Node 22.17+ within major 22, pnpm 10.18.3, Electron
39.8.10, TypeScript 6, Vite 8, React 19, and Playwright 1.61. The workspace
signature is:

```text
pnpm bootstrap   # frozen install + Rust engine build + desktop build
pnpm dev:desktop # Vite/tsc watches + Electron
```

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
- Node 24 is rejected by `scripts/check-node-version.mjs`: Electron 39's
  `extract-zip` can stop after the first file while reporting a successful
  postinstall. `onlyBuiltDependencies: [electron]` belongs in
  `pnpm-workspace.yaml`.
- Engine responses replace persisted display state. React owns only ephemeral
  UI state such as search/filter, active segment, tab, save indicator, toast,
  and docked/collapsed/maximized panel modes.
- IME composition is tracked per segment. Ctrl/Cmd+Enter must do nothing during
  composition; focus advances only after save and confirmation succeed.
- Suggestions and Preview each have exactly three presentation modes:
  `docked`, `collapsed`, and `maximized`, with symmetric transitions.
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

## 7. Wrong vs Correct

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

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No stored session or invalid/recycled session | Show Home; remove only the invalid session key |
| Malformed session JSON/shape or a `trash` project snapshot | Remove the session key and do not request editor rows |
| Pending Workbench save rejects while leaving | Keep Workbench mounted; show the typed save error; do not clear selection |
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
- The Node 22 quality chain runs format, lint, typecheck, unit/Rust tests,
  contracts, desktop production build, Engine smoke, and the focused/full
  Electron suites. Node 24 results are development feedback only.

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
- DocumentPreview loads page summaries first and lazily requests one PNG when
  visible. segmentIds map the active segment to its page; React does not parse
  the PDF structural path.
- Original page bytes are rendered as an in-memory data URL. Renderer code
  never receives or opens the managed source path.
- OCR correction is available only for active OCR, non-confirmed blocks. The
  controlled form requires source text and reason, sends expected revision, and
  replaces grid and preview state with the returned Segment.
- Preview and Suggestions retain docked/collapsed/maximized state and focus/
  animation rules. PDF export suggests name-translated.docx and calls generic
  document.export.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Source dialog canceled | Keep Setup state; do not create/import |
| Page summary/image loading fails | Keep editor usable and show typed preview error |
| Correction reason/source empty | Disable save; make no RPC |
| Stale OCR revision | Show conflict; keep authoritative current state |
| Confirmed/non-OCR block | Do not render correction command |
| Preview collapsed | Stop page fetches, keep animated content mounted/inert |
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

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| No enabled credential-backed profile | Keep explicit offline Assistant; do not imply a network response |
| Credential save/delete fails | Clear the input only on success and show the typed error without the value |
| Stale/signed/tag-invalid proposal apply | Keep the proposal visible and show the Engine error; do not patch local target state |
| Polling panel unmount/collapse | Stop renderer polling; do not cancel the durable Engine run |
| First conversation is created during submit | Bind grounding to the returned conversation ID, not the previous null state |
| Narrow toolbar | No child text overlaps an adjacent control; hidden text retains an accessible parent label |

### 5. Good / Base / Bad Cases

- Good: create a first conversation and immediately translate; the grounding
  inspector remains attached to that new conversation through completion.
- Base: select Local preview and receive explicitly synthetic metrics without a
  provider request or keyring dependency.
- Bad: clear grounding in a passive effect keyed by the previous conversation,
  or replace the full editor page with the single row returned by AI apply.

### 6. Tests Required

- Electron E2E configures a loopback profile through trusted credential IPC,
  enables policy, inspects grounding, streams and applies a proposal, verifies
  all usage metrics, exercises batch tag rejection, and deletes the credential.
- The AI Control and online Assistant are captured at all three supported
  viewports with horizontal-overflow and adjacent-toolbar-boundary assertions.
  Console/page errors fail the test.

### 7. Wrong vs Correct

#### Wrong

```ts
const bundle = await previewGrounding(action, prompt); // captures null thread
setConversationId((await createConversation()).id);
setSegments(mutation.rows.map((row) => row.segment)); // drops the page
```

#### Correct

```ts
const conversation = activeConversationId ?? (await createConversation()).id;
const bundle = await previewGrounding(action, prompt, conversation);
applyEditorMutation(mutation); // merges returned rows into the current page
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

## Plugins panel

- Project Insights hosts a Plugins tab that lists Engine-owned plugin summaries
  via generated `plugin.*` contracts only.
- Package directory selection stays in Electron main (`selectPluginPackage`);
  E2E may set `TRANSLUNAR_TEST_PLUGIN_SOURCE`.
- Preserve typed Engine error codes across the desktop invoke envelope when
  install/enable/disable fails.
- Do not import or execute plugin code in the renderer; contributions are
  descriptors managed by the Engine.

## Packaging and localization shell

- Package with `apps/desktop/electron-builder.yml`; unsigned artifacts are valid
  for development.
- Shell copy should prefer `i18n/messages.ts` catalogs (`en-US` / `zh-CN`).
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
