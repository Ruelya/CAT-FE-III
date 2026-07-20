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
  selectSourceDocx(): Promise<string | null>;
  selectExportPath(suggestedName: string): Promise<string | null>;
  restartEngine(): Promise<void>;
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
  HTML/XHTML/XLIFF extensions. Setup creates the project, then imports through
  document.import; legacy DOCX RPCs remain compatible.
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
setAiCredential(profileId: string, secret: string): Promise<AiCredentialStatus>;
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
