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
