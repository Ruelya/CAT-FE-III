# Electron Workbench Contract

## 1. Scope / Trigger

Use this contract for `apps/desktop`, preload APIs, Electron lifecycle, Vite
packaging, React workbench state, panel interactions, or desktop tests.

Electron owns operating-system integration and presentation orchestration. It
does not own segment transitions, QA, TM, segmentation, persistence, or counts.

### Renderer layout (authoritative for new UI)

The renderer was rebuilt as a vertical slice (P0), extended for project
lifecycle discoverability (P1), editor operations plus Asset Hub (P2),
PDF/interop/task-package/reimport surfaces (P3), and AI Control / Plugins /
Collaboration / Product Settings plus appearance-v1 (P4). New work must use:

- `shell/` — product title strip (`AppChrome`), window controls, boot gate,
  Engine status banner, recovery/confirm dialogs
- `routes/` — pure surface decisions (no URL router)
- `surfaces/` — Welcome, Project Home, Create, Import, Workbench, Asset Hub,
  QA, Export, Templates, Recycle, Global Search, Project Insights, AiControl,
  Plugins, Collaboration, ProductSettings
- `workbench/` — segment grid, target editor, exact-TM panel, document
  switcher, batch import summary, editor command bar/panels, PDF page review
- `insights/` — Interop review/table panels, task package panel, section nav
- `state/` — app controller, session identity, `SaveCoordinator`, draft recovery,
  appearance-v1, P1–P4 pure helpers + dedicated domain controllers
- `lib/` — typed RPC adapter, UI errors, IME guards
- `appearance-bootstrap.ts` — pre-React apply of appearance-v1
- `tokens.css` + `styles.css` — solid light/dark tokens + derived accent; no glass

P1 multi-document, batch import, templates, recycle vs lifecycle, search
save-before-nav, feature op tokens, and switcher testids:
[project-lifecycle.md](./project-lifecycle.md).

P2 editor mutation sequences, command registry/keyboard ownership, Asset Hub
domains, exchange dialog boundary, and curation rollback:
[editor-assets.md](./editor-assets.md).

P3 PDF dock mount rules, interop/task multi-page selection, reimport retry,
and fixture-gated e2e env keys: [interop-pdf.md](./interop-pdf.md).

P4 AI Control, plugins/connectors, local collab, product settings, and
appearance-v1 contracts: [ai-plugins-settings.md](./ai-plugins-settings.md).

Custom title-bar / window chrome (platform branches, trusted bridge, drag
regions): section **Desktop custom title bar chrome** below.

Historical root-level monolith files (`Workbench.tsx`, `WorkbenchPages.tsx`,
`SetupView.tsx`, `AssistantPanel.tsx`, `workbench-utils.ts`) are gone. Later
sections of this document may still describe Engine contracts and panel
behaviors that remain valid; file path examples that mention those deleted
files should be read as historical and mapped to the layout above.

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
  selectTaskPackageInput(): Promise<string | null>;
  selectCorpusInput(): Promise<string | null>;
  selectExchangeInput(kind: "tm" | "termbase"): Promise<string | null>;
  readManagedSource(request: ManagedSourceRequest): Promise<ManagedSourceBytes | null>;
  selectPluginPackage(): Promise<string | null>;
  issuePluginPanelSession(request: PluginPanelSessionRequest): Promise<PluginPanelSession>;
  revokePluginPanelSession(sessionId: string): Promise<boolean>;
  onPluginPanelRevoked(listener: (pluginId: string | null) => void): () => void;
  resolveDroppedPaths(files: readonly File[]): string[];
  restartEngine(): Promise<void>;
  setAiCredential(profileId: string, secret: string): Promise<void>;
  // Product shell (locale-only patch; data/backup/restore/update/tutorial)
  getSystemLocale(): Promise<string>;
  getShellSettings(): Promise<ProductShellSettings>;
  updateShellSettings(patch: ShellLocalePreferencePatch): Promise<ProductShellSettings>;
  getDataDirectoryStatus(): Promise<DataDirectoryStatus>;
  selectDataDirectory(): Promise<string | null>;
  validateDataDirectory(path: string): Promise<DataDirectoryValidation>;
  migrateDataDirectory(path: string): Promise<DataDirectoryMigrationResult>;
  selectBackupDestination(suggestedName?: string): Promise<string | null>;
  createWorkspaceBackup(destinationPath?: string | null): Promise<ShellActionResult>;
  selectRestoreSource(): Promise<string | null>;
  previewRestore(path: string): Promise<ShellActionResult>;
  restoreWorkspaceBackup(params: RestoreApplyParams): Promise<DataDirectoryMigrationResult>;
  getUpdateStatus(): Promise<UpdateStatusSnapshot>;
  setUpdateMode(mode: UpdateMode): Promise<UpdateStatusSnapshot>;
  checkForUpdates(): Promise<UpdateStatusSnapshot>;
  deferUpdate(untilMs: number): Promise<UpdateStatusSnapshot>;
  downloadUpdate(): Promise<UpdateStatusSnapshot>;
  installUpdate(): Promise<UpdateStatusSnapshot>;
  rollbackUpdate(): Promise<UpdateStatusSnapshot>;
  openUpdateInstaller(): Promise<UpdateStatusSnapshot>;
  getTutorialState(): Promise<TutorialState>;
  updateTutorialState(patch: Partial<TutorialState>): Promise<TutorialState>;
  // Window chrome (custom title bar) — narrow surface only
  minimizeWindow(): Promise<void>;
  maximizeWindow(): Promise<boolean>; // toggle; returns resulting maximized state
  closeWindow(): Promise<void>;
  isWindowMaximized(): Promise<boolean>;
  getWindowChromePlatform(): WindowChromePlatform; // "macos" | "custom"
  createLayoutPreviewSink(input: { fileType: string }): Promise<LayoutPreviewSink>;
  publishLayoutPreview(input: {
    outputPath: string;
    title: string;
    fileType: string;
  }): Promise<LayoutPreviewSession>;
  revokeLayoutPreview(): Promise<void>;
  // … draft journal, example project, engine status listeners — see desktop-api.ts
}
```

`WindowChromePlatform` is only `"macos"` | `"custom"`. Full window-chrome
contracts: **Desktop custom title bar chrome** below. Full product-shell and
plugin-panel contracts for P4 surfaces:
[ai-plugins-settings.md](./ai-plugins-settings.md).

IPC channels are main/preload-private constants. Main accepts engine methods
only when they exist in generated `ENGINE_METHODS`, and it verifies the sender
is the current main window. Window-chrome handlers use the same
`assertTrustedSender` + `requireWindow` guard and target only the single main
window.

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
- BrowserWindow title-bar style is platform-selected: macOS `hiddenInset`
  (native traffic lights), Windows/Linux/other `hidden` (renderer custom
  controls). See **Desktop custom title bar chrome**.
- Main owns file dialogs and the engine child process. Renderer receives paths
  selected by main and never imports Node filesystem APIs.
- Document structure preview (`workbench/StructurePreview.tsx`) is a live
  reconstruction from grid rows. Markdown goes through `marked` then
  `DOMPurify`. HTML reconstructs tag payloads then `DOMPurify`. Other filters
  keep tag-to-typography HTML, then the same sanitizer. The pane must keep
  `data-testid="structure-preview"` and `preview-block-${segmentId}`; a click
  or Enter/Space on a block calls the Workbench jump callback. It must not
  invent headings, tables, or page numbers the Engine did not encode in text
  or tag payloads.
- `readManagedSource` is a desktop-only read of
  `{dataDir}/sources/{documentId}.{ext}`. Main sanitizes the id and extension,
  stays inside the sources directory, and returns bytes (never the path).
  When those bytes are a DOCX, `docx-preview` may render the original imported
  file above the live jump blocks. That canvas is the source copy, not a live
  target merge, not Word COM, and not the PDF page dock. Do not add an Engine
  method for this read.
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
  UI state such as search/filter, active segment, save indicator, and panel
  collapse. Domain drafts are coordinated by `SaveCoordinator` (generations +
  DraftJournal), not claimed as confirmed status.
- Session identity is only versioned `{ projectId, documentId }` under
  `translunar.renderer.session.v1`. Validate through RPC before use; clear only
  on proven invalid/recycled identity.
- IME composition is tracked via `lib/ime.ts` and the save coordinator.
  Confirm/update/focus-advance must no-op during composition, `isComposing`,
  or keyCode/which 229; focus advances only after flush and confirmation
  succeed.
- Leaving the workbench for QA, export, Home, Search, Insights, Assets,
  another document, active-document recycle, or any P4 destination (AI Control,
  Plugins, Collaboration, Settings) must await `SaveCoordinator.flush()` before
  changing surface or hydrating the destination. On failure, remain on
  Workbench with draft and typed error intact. Surfaces reload projections
  through RPC after a successful transition.
- Multi-file import uses `selectSourceDocuments()` then one
  `project.batchImport` with `atomicity: "bestEffort"` and `{ path }` items.
  Empty picker array is cancel (no Engine call). Do not loop `document.import`.
- Archive/unarchive use `project.setLifecycle` with `active`/`archived` only.
  Soft-delete uses `recycle.delete` (never `setLifecycle("trash")`).
- Global search uses `search.global` with `includeRecycled: false`. Empty
  trimmed query makes no RPC.
- Session identity remains identity-only; `SessionContext.documents` is an
  in-memory Engine-ordered cache, not persisted.
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
- Sign-off is a single reversible action. `segment.workflow.set` accepts any
  transition without a review detour, a reason, or a confirmation dialog; the
  renderer must not reintroduce one.
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
| Navigation encounters a pending-save failure      | Stay in Workbench and show the typed save error (includes P4)   |
| Appearance storage missing/malformed              | Apply light/`#765847` defaults; boot continues                  |
| `updateShellSettings` used for theme/accent       | Invalid — appearance is renderer localStorage v1 only           |
| Window-chrome IPC sender is not the trusted main frame | Reject via `assertTrustedSender`; no window mutation       |
| Window chrome command when main window is missing | Fail through `requireWindow()`; do not target another window    |
| Domain mutations disabled / boot / reconnect      | Window controls remain enabled; never gated by `mutationsEnabled` |
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

## Scenario: Desktop custom title bar chrome

### 1. Scope / Trigger

Use this contract when changing:

- `BrowserWindow` frame / `titleBarStyle` options
- Main/preload private IPC for minimize, maximize/restore, close, or maximized
  state
- `DesktopApi` window-chrome methods or `WindowChromePlatform`
- `AppChrome` as the product title strip, drag/no-drag CSS, or
  `WindowControls`
- Title-strip appearance tokens (close hover/active, surface/border/text)

**Why code-spec depth:** this is a main ↔ preload ↔ renderer cross-layer
contract with platform-specific BrowserWindow options and a trusted narrow
bridge. Do not expand into a general Electron or filesystem API.

Source-backed modules:

| Layer | Paths |
| --- | --- |
| Pure main helper | `main/window-chrome.ts` (`resolveWindowChromePlatform`, `windowChromeTitleBarOptions`) |
| Main wiring | `main/index.ts` (`createWindow` options + `registerIpc` chrome handlers) |
| Preload | `preload/index.cts` |
| Shared types | `shared/desktop-api.ts` |
| Renderer controller | `renderer/shell/use-window-chrome.ts` |
| Title strip | `renderer/shell/AppChrome.tsx` |
| Controls | `renderer/shell/WindowControls.tsx` |
| Styles | `renderer/styles.css` (`.app-chrome`, `.window-controls*`) |
| Fake bridge | `renderer/test/fake-desktop-api.ts` |
| Unit | `main/window-chrome.test.ts`, `shell/WindowControls.test.tsx`, appearance style contract |
| E2E | `tests/e2e/desktop-titlebar.spec.ts` |

### 2. Signatures

```typescript
export type WindowChromePlatform = "macos" | "custom";

// DesktopApi (window chrome only)
minimizeWindow(): Promise<void>;
maximizeWindow(): Promise<boolean>; // toggle maximize/restore; return resulting maximized
closeWindow(): Promise<void>;
isWindowMaximized(): Promise<boolean>;
getWindowChromePlatform(): WindowChromePlatform; // preload platform fact, not a general process API

// Pure main helper (no Electron bootstrap import)
resolveWindowChromePlatform(platform: string): WindowChromePlatform;
windowChromeTitleBarOptions(platform: string): {
  titleBarStyle: "hidden" | "hiddenInset";
  usesCustomWindowControls: boolean;
};
```

Channel names are main/preload-private constants. Renderer never sees raw
channel strings, `BrowserWindow`, `ipcRenderer`, or Node APIs.

### 3. Contracts

| Host (`process.platform`) | `titleBarStyle` | Renderer platform | Visible controls |
| --- | --- | --- | --- |
| `darwin` | `hiddenInset` | `macos` | Native traffic lights only; omit `WindowControls` |
| `win32` | `hidden` | `custom` | Minimize / Maximize\|Restore / Close |
| Linux / other | `hidden` (documented fallback) | `custom` | Same custom controls as Windows |

- Only the explicit macOS branch is native-traffic-light mode. Unknown platform
  strings map to `custom`.
- Keep existing window geometry: resizable, `minWidth` 1180, `minHeight` 700,
  current default size, secure `webPreferences`, navigation guards.
- Do **not** use `titleBarOverlay` for this product; custom controls share one
  token-driven surface with the brand ribbon.
- Do **not** draw custom macOS traffic lights.
- `AppChrome` is the single product title strip: `.app-chrome` uses
  `-webkit-app-region: drag` (and `app-region: drag`).
- Interactive descendants must be `no-drag`: actions cluster, `.window-controls`,
  and `.app-chrome button, a, input, select, textarea, [data-no-drag]`.
- macOS strip uses `data-window-chrome="macos"` with a left inset (`padding-left:
  78px`) so native traffic lights do not overlap ribbon/identity/nav.
- Appearance remains renderer-local `translunar.renderer.appearance.v1`. Chrome
  backgrounds, borders, text, hover, focus, and close states use solid
  appearance-v1 / semantic tokens only. No glass (`backdrop-filter`), no second
  theme store, no shell-settings theme patch.
- Close hover may use `--color-error` + inverse text. Close **active** must mix
  tokens only (e.g. `color-mix(..., var(--color-error), var(--color-text))`);
  raw `#000` / chrome-only literals are forbidden in production title-strip
  rules.
- `useWindowChrome` owns bridge calls. Presentational controls receive intents
  only. Controls stay available when `mutationsEnabled` is false and during
  boot/reconnect/recovery.
- Maximized state: query on mount, after maximize toggle, and on `window.resize`
  (covers OS maximize/snap/keyboard). Cleanup the listener on unmount. OS-chrome
  rejections retain last known UI state; do not crash or unmount the app.
- Accessible names: Minimize, Maximize / Restore, Close (or equivalent
  functional names). Icon-only Phosphor buttons need `title` + `aria-label` and
  visible `:focus-visible`.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| IPC sender is not trusted main window | Reject; no minimize/maximize/close |
| Main window missing | `requireWindow()` error path; no other window targeted |
| Maximize when normal | Maximize; return `true` |
| Maximize when already maximized | Restore; return `false` |
| `isWindowMaximized` after native unmaximize / snap | UI re-queries (resize) and exposes Restore vs Maximize correctly |
| Platform is `macos` | No renderer window controls; inset class applied |
| Platform is `custom` | Three named controls; no macOS inset assumption |
| Domain mutations disabled | Window controls still enabled and keyboard-reachable |
| OS-chrome command rejects | Swallow non-fatally; keep last maximized state |
| Title-strip style uses glass / raw black close active | Invalid — token-only solid chrome contract |

### 5. Good / Base / Bad Cases

- Good: Windows launches with hidden title bar, only `AppChrome` as title strip,
  Minimize/Maximize/Restore/Close work via the trusted bridge, drag on inert
  strip, no-drag on buttons, light/dark tokens update the same DOM.
- Good: macOS uses `hiddenInset`, native traffic lights, no duplicate custom
  controls, 78px left inset.
- Base: Linux uses the documented custom-control fallback; window remains
  usable under the project Electron environment.
- Bad: `titleBarOverlay` for “easier” native symbols that diverge from
  appearance-v1.
- Bad: second set of custom traffic lights on macOS.
- Bad: missing `no-drag` on buttons (clicks swallowed by drag region).
- Bad: gate window controls on `mutationsEnabled` or surface loading flags.
- Bad: expose raw Electron/`BrowserWindow`/general IPC invoker to the renderer.
- Bad: `color-mix(..., #000)` or other non-token literals on chrome control
  active states.

### 6. Tests Required

- Unit: pure platform helper (darwin → `hiddenInset`/no custom controls;
  win32/linux/other → `hidden`/custom controls).
- Unit: `WindowControls` — custom branch names/keyboard activation; macOS omits
  controls; disabled domain mutations do not disable chrome; maximize/restore
  label follows state.
- Unit/static: appearance/style contract — drag/no-drag declarations, solid
  surface tokens, macOS inset selector, no `backdrop-filter`, close:active
  token-only mix without raw `#000`.
- Fake `DesktopApi` defaults for all chrome methods so App integration tests
  boot without Engine mocks.
- Focused Electron E2E (`desktop-titlebar.spec.ts`): title strip reachability,
  platform-gated controls, maximize→restore on stable non-macOS runners,
  computed drag/no-drag, no console/page errors. Do not click Close in a shared
  multi-assertion flow. Gate macOS/Linux assertions honestly when runners are
  unavailable.
- Production build is part of real-Electron evidence. Prefer native
  BrowserWindow probes (min size, resizable, security prefs, isolated close)
  when acceptance is evidence-gated.

### 7. Wrong vs Correct

#### Wrong

```typescript
// Default framed window + overlay symbols outside appearance-v1.
new BrowserWindow({ /* no titleBarStyle */ titleBarOverlay: true });

// Renderer imports Electron and bypasses preload.
import { ipcRenderer } from "electron";
ipcRenderer.invoke("window:close");

// Drag swallows clicks; mutations gate hides close during reconnect.
<div style={{ WebkitAppRegion: "drag" }}>
  <button disabled={!mutationsEnabled} onClick={close}>×</button>
</div>
```

```css
/* Token violation + glass */
.window-controls__btn--close:active {
  background: color-mix(in srgb, var(--color-error) 85%, #000);
}
.app-chrome {
  backdrop-filter: blur(12px);
}
```

#### Correct

```typescript
const chrome = windowChromeTitleBarOptions(process.platform);
new BrowserWindow({
  ...chrome, // titleBarStyle only; keep min size + sandbox webPreferences
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
});

// Preload-only surface; main asserts trusted sender then requireWindow().
await window.translunar.maximizeWindow();
```

```css
.app-chrome {
  -webkit-app-region: drag;
  background: var(--color-surface);
}
.app-chrome button,
.window-controls {
  -webkit-app-region: no-drag;
}
.window-controls__btn--close:active {
  background: color-mix(in srgb, var(--color-error) 85%, var(--color-text));
  color: var(--color-text-inverse);
}
.app-chrome[data-window-chrome="macos"] {
  padding-left: 78px;
}
```

### Residual platform notes

- Windows built runtime has been the primary verification host for hidden frame,
  controls, min size, maximize sync, security prefs, and drag CSS.
- Linux/Xvfb and macOS traffic-light geometry remain host-gated. Do not treat
  pure helper unit tests as native window-manager proof.
- macOS first React commit currently may initialize platform as `custom` before
  an effect reads the bridge (accepted residual unless a darwin runner elevates
  it). Prefer synchronous platform init when fixing first-frame fidelity.

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
  contract remains intact; the app-bar button exposes the same command with an
  accessible name and `aria-keyshortcuts`.
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

> **P3 layout:** Workbench dock modules and mount helpers live under
> `workbench/PdfPageReview.tsx`, `state/pdf-review.ts`, `state/use-pdf-review.ts`.
> Executable mount/selection contracts: [interop-pdf.md](./interop-pdf.md).

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
- DocumentPreview / PdfPageReview loads page summaries first and lazily requests
  one PNG when visible. segmentIds map the active segment to its page; React
  does not parse the PDF structural path.
- **Mount gate (P3):** mount the PDF dock only when `shouldMountPdfDock` is true.
  Non-PDF documents that reject `pdf.page.list` with messages such as “requires
  a pdf” must **not** mount dock or error chrome (`isNonPdfDocumentListError`).
  Real list failures may show thin error chrome without fake pages.
- Original page bytes are rendered as an in-memory data URL. Renderer code
  never receives the managed source filesystem path. PDF pages stay on
  `pdf.page.get`. DOCX original-layout preview may receive file bytes only
  through `readManagedSource`.
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
- Preview and Suggestions retain docked/collapsed/maximized state and focus/
  animation rules. PDF export suggests name-translated.docx and calls generic
  document.export.

### 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Source dialog canceled | Keep Setup state; do not create/import |
| Non-PDF `pdf.page.list` InvalidRequest | Hide dock; no fake pages / error chrome |
| Page summary/image loading fails (real PDF path) | Keep editor usable; thin typed preview error chrome |
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
- Direct controls and the overflow trigger use Phosphor icons
  (`@phosphor-icons/react`), a visible tooltip/title, an accessible name, and a
  stable 32px square hit area. The menu uses `role="menu"`/`role="menuitem"`,
  closes on blur or Escape, and returns focus to its trigger on Escape.
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

> **P4 rebuild:** The authoritative shipped AI Control surface, controllers,
> runnable-profile honesty, paging, apply/rehydrate, and appearance separation
> live in [ai-plugins-settings.md](./ai-plugins-settings.md)
> (`surfaces/AiControl.tsx`, `state/use-ai-controller.ts`). The rules below
> remain valid for credential/Engine authority; prefer the P4 doc for route
> identity and module paths.

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
- Product-facing AI error text on Live Assistant and AI Control must use a
  structured Engine error formatter + i18n catalog (not bare string conversion).
  When `code === "policy_denied"`, map to catalog key `error.allowlistDenied`
  and interpolate `profileId` from structured `data.profileId` (camelCase wire
  shape). Unknown codes keep the audited technical protocol message. Branch
  only on stable `code`/`data` fields—never on English `message` text. P0
  surfaces normalize errors through `lib/errors.ts` (`toUiError`); restore the
  catalog-backed formatter with AI surfaces when those modules return.

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

> **P4 rebuild:** Full plugin lifecycle, permissions, AI actions, authorized UI
> panel sessions, and external-connector invoke console contracts are in
> [ai-plugins-settings.md](./ai-plugins-settings.md)
> (`surfaces/Plugins.tsx`, `state/use-plugin-controller.ts`,
> `state/external-connector-request.ts`). The rules below remain valid for
> schema-only config and secret boundaries.

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

> **P3 layout:** Insights interop panels + `state/interop-view.ts` /
> `use-interop-controller.ts`. Cross-page selection uses `mergePageSelection`
> from `task-package-view.ts`. Full P3 contracts: [interop-pdf.md](./interop-pdf.md).

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
  **Do not replace the full selection set with the current page's eligible
  IDs.** First open seeds eligible rows; later pages must
  `mergePageSelection(current, pageRowIds, selectedOnPage)` so off-page IDs
  survive. Source provenance displays raw `sourceRow`; it must not add another
  header offset. Structural paths and diagnostics are display-only strings.
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

> **P3 layout:** Insights task panel + `state/task-package-view.ts` /
> `use-task-package-controller.ts`. Shared selection helper also used by interop.
> Reimport modal: `state/reimport-view.ts` / `use-reimport-controller.ts`
> (apply failure restores `planReady` for retry). See [interop-pdf.md](./interop-pdf.md).

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
- Shell copy should prefer typed i18n catalogs (`en-US` / `zh-CN`) when the
  catalog module is present. P0 vertical-slice surfaces use concise functional
  English labels; when the catalog returns, product-facing status, dialog,
  update, backup/restore, allowlist, and accessibility labels must use it.
  Protocol technical payloads may remain audited English; product-facing
  structured codes such as `policy_denied` must map through a structured
  formatter + catalog keys (see Engine-Backed AI Control And Assistant).
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
- `Workbench` observes the width of `.editor-region` (the element wrapping the
  command bar, segment grid, and editor panels, owned by
  `surfaces/Workbench.tsx`) with a `ResizeObserver`, and writes the resulting
  band onto `data-density="comfortable" | "compact"`. CSS reacts to that
  attribute; there is no width media query, because dock state changes the
  editor width without changing the viewport width.
- Below the compact threshold the editor moves segment filters into one labeled
  select, hides redundant TM and button label text while keeping every control
  named through `title` and `aria-label`, and keeps icon-first controls at the
  32 px target floor. No filter, search, TM, history, issue, or confirm
  capability may disappear; compact mode changes presentation only.

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
