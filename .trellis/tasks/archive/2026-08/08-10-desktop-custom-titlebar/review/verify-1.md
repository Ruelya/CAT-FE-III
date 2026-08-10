# Verify report round 1

## mission_echo
- purpose: Prove (on available hosts) that Electron 41.10.3 actually removes the native title bar, preserves resize/minimum size, exposes usable drag/no-drag regions, synchronizes maximize state, and keeps security/navigation contracts intact — not just unit/DOM scaffolding.
- questions_addressed:
  - Q1 (Windows native title strip / resize / min size): **Yes on this host.** Production build launches with platform `custom`, custom Minimize/Maximize/Close visible, content bounds share the same top-left as window bounds (`dy=0` — no reserved OS title-bar band), `isResizable=true`, `minimumSize=[1180,700]`. Source sets `titleBarStyle: "hidden"` for non-macOS via `windowChromeTitleBarOptions`.
  - Q2 (Windows controls + maximize sync): **Yes (pointer + keyboard Enter; native unmaximize reflected).** Maximize click → `BrowserWindow.isMaximized()===true` and accessible name becomes `Restore`. Native `win.unmaximize()` → label/`data-maximized` return to Maximize/`false`. Minimize click → `isMinimized()===true` then restored. Keyboard Enter on focused Maximize maximizes. Isolated Close click → `BrowserWindow` count `0`.
  - Q3 (Linux/Xvfb fallback): **Unanswered — no Linux runner.** Host is `win32 x64` (MINGW64_NT-10.0-26200). Custom branch is shared code for non-darwin; residual host risk remains.
  - Q4 (macOS hiddenInset / traffic lights): **Unanswered — no macOS runner.** Unit mapping claims `hiddenInset` + no custom controls; F1 first-commit flash still open as static residual. Pure helper tests are not runtime proof.
  - Q5 (drag / no-drag computed styles + interactive activation): **Drag CSS contract proven; physical drag movement not pixel-proven.** Computed `-webkit-app-region`: `.app-chrome=drag`, `.app-chrome__actions=no-drag`, `.window-controls=no-drag`. Pointer clicks and keyboard Enter on Maximize succeed (not swallowed). Space activation not separately exercised. Actual window translation via drag gesture not automated.
  - Q6 (viewports 1250×744 / 1680×942 / 1920×1080, overflow, glass): **Yes for default light appearance on Windows.** Document `overflowX=false` at all three sizes; controls stay inside chrome bounds; glass audit and runtime `backdropFilter=none`; solid surface bg `rgb(251, 250, 247)`. Full dark/custom-accent matrix and long-identity clipping stress not fully exercised beyond default welcome chrome.
  - Q7 (security webPreferences + guards): **Runtime prefs intact.** `getLastWebPreferences`: `contextIsolation=true`, `nodeIntegration=false`, `sandbox=true`. Source still uses `assertTrustedSender` on window-chrome IPC and origin-locked `will-navigate`. Forged/non-main-frame IPC rejection not re-probed at runtime in this round.
- related_issues: F1, F2, F3

## environment
- cwd: `D:\Workbench\CAT-FE-III` (branch `task/08-10-desktop-custom-titlebar`, head `31f0f72`)
- host: Windows 10+ (`win32 x64`); Electron `41.10.3` via apps/desktop package
- toolchain: pnpm filter `@translunar/desktop`; existing `target/debug/translunar-engine.exe` (no rebuild required for titlebar/P0 sample)
- deviations:
  - Investigative probe script at `{task}/review/probe-titlebar.mjs` (not product code) used instead of extending the checked-in Playwright spec, to answer native `BrowserWindow` state, minimize/close, viewports, and security prefs without sharing Close with multi-assertion flows.
  - Sample P0: `p0-vertical-slice.spec.ts` — `"project home Open resumes an existing project"` (focused sample; not the full welcome→export path).
  - Linux `xvfb-run` and macOS runners unavailable — marked unanswered.
  - Physical AppChrome drag movement (cursor drag deltas) not automated — CSS + non-swallowed clicks only.
  - Did not run full monorepo / full desktop E2E suite (per avoid).

## actions
### A1
- command: `pnpm --filter @translunar/desktop typecheck`
- exit_code: 0
- duration_note: contracts prebuild + electron/renderer/e2e tsc
- log_excerpt: |
    tsc -p tsconfig.electron.json --noEmit && tsc -p tsconfig.renderer.json && tsc -p tsconfig.e2e.json
- interpretation: Desktop type surfaces (main, renderer, e2e) clean after title-bar wiring.

### A2
- command: `pnpm --filter @translunar/desktop exec vitest run src/main/window-chrome.test.ts src/renderer/shell/WindowControls.test.tsx src/renderer/state/appearance.test.ts`
- exit_code: 0
- log_excerpt: |
    ✓ src/main/window-chrome.test.ts (4 tests)
    ✓ src/renderer/state/appearance.test.ts (11 tests)
    ✓ src/renderer/shell/WindowControls.test.tsx (6 tests)
    Test Files  3 passed (3)
    Tests  21 passed (21)
- interpretation: Platform mapping, control a11y unit coverage, and CSS drag contract string assertions hold.

### A3
- command: `pnpm --filter @translunar/desktop build`
- exit_code: 0
- log_excerpt: |
    vite v8.1.5 building client environment for production...
    ✓ built in 611ms
    dist/renderer/assets/index-CXxIduAC.css   24.93 kB
    dist/renderer/assets/index-96aD98Mc.js   701.79 kB
    + tsc -p tsconfig.electron.json
- interpretation: Production renderer + electron main compile succeed. Built CSS contains drag/no-drag; no backdrop-filter.

### A4
- command: `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer --glob '!**/*.test.*'`
- exit_code: 0
- log_excerpt: |
    (no matches)
- interpretation: No glass material or Lucide dependency in production renderer sources for this change area.

### A5
- command: `cd apps/desktop && pnpm exec playwright test tests/e2e/desktop-titlebar.spec.ts --trace on`
- exit_code: 0
- duration_note: ~1.4s
- log_excerpt: |
    [1/1] desktop custom title bar chrome › title strip is reachable with platform-gated window controls
    1 passed (1.4s)
- interpretation: Checked-in E2E on Windows: custom controls visible; Maximize→Restore→Maximize; computed drag/no-drag; no console/page errors.

### A6
- command: `node .trellis/tasks/08-10-desktop-custom-titlebar/review/probe-titlebar.mjs`
- exit_code: 0
- duration_note: second clean run after close-path fix; first run already proved all pre-close checks
- log_excerpt: |
    platform win32, PROBE_OK
    minSizeEnforced [1180,700] ok
    resizable true
    securityPrefs {contextIsolation:true,nodeIntegration:false,sandbox:true}
    platformCustom custom/custom; controls Minimize/Maximize/Close
    drag {chrome:drag, actions:no-drag, controls:no-drag}
    maximizeNative isMaximized true + Restore visible
    nativeUnmaximizeSync after BrowserWindow.unmaximize → Maximize + data-maximized=false
    minimizeNative wasMinimized true
    keyboardMaximize Enter → isMaximized true
    viewports 1250/1680/1920 overflowX false, controlsInChrome true
    noNativeTitleStripHint dy=0 (contentBounds.y === bounds.y)
    closeNative windowsLeft=0
    noGlass backdrop none
- interpretation: Native window-manager evidence on Windows closes most of F2 for this host. Close works in isolation. Title-strip absence inferred from bounds/contentBounds alignment + custom chrome only (not pixel screenshot of OS chrome).

### A7
- command: `cd apps/desktop && pnpm exec playwright test tests/e2e/p0-vertical-slice.spec.ts -g "project home Open"`
- exit_code: 0
- duration_note: ~2.4s
- log_excerpt: |
    [1/1] P0 vertical slice › project home Open resumes an existing project
    1 passed (2.4s)
- interpretation: Sample P0 path still boots Electron shell with engine + custom chrome present; no regression smoke failure on focused P0.

### A8
- command: static confirm `titleBarStyle` / IPC / F3 token
- exit_code: 0
- log_excerpt: |
    window-chrome.ts: non-darwin → titleBarStyle "hidden", usesCustomWindowControls true
    index.ts createWindow: minWidth 1180, minHeight 700, titleBarStyle from chrome helper
    window IPC handlers: assertTrustedSender + requireWindow minimize/maximize/close/isMaximized
    styles.css:328-330 still color-mix(... #000) on close:active (F3)
    use-window-chrome.ts: useState("custom") then effect setPlatform (F1 still present)
- interpretation: Source matches runtime findings; F1/F3 product issues remain open as static/minor.

## findings_for_reviewer
### V1
- severity: info
- related_review_ids: F2
- title: Windows built runtime satisfies core title-bar acceptance (native strip absent, controls, min size, security prefs)
- evidence: probe-titlebar.mjs PROBE_OK; desktop-titlebar.spec.ts pass; getLastWebPreferences sandbox/contextIsolation; dy=0 bounds; min [1180,700]
- detail: On Windows host, production Electron build shows only product `AppChrome` custom controls, resizable window, correct minimum size, working Minimize/Maximize-Restore/Close (pointer), keyboard Enter maximize, native unmaximize label sync via resize listener path, no glass, no horizontal overflow at three supported sizes. This largely answers F2 for Windows.
- suggested_next: Treat F2 as Windows-satisfied with residual multi-OS risk; do not require product fix unless reviewer elevates unanswered platforms.

### V2
- severity: minor
- related_review_ids: F3
- title: Close active state still mixes raw `#000`
- evidence: `apps/desktop/src/renderer/styles.css:328-330`
- detail: Confirmed still present in production styles; not a runtime functional failure. Token-only requirement remains open.
- suggested_next: fix_recipe_hint — replace `#000` with existing semantic/surface token or mix with a token.

### V3
- severity: minor
- related_review_ids: F1
- title: macOS first-commit platform flash still in code; no macOS runtime disproof
- evidence: `use-window-chrome.ts:18-23` initializes `"custom"`; corrected only in `useEffect`
- detail: Windows path is correctly `"custom"` from first paint, so F1 does not regress Windows. macOS first-visible-frame guarantee remains unproven and statically still wrong.
- suggested_next: fix_recipe_hint on next fix round if macOS is in scope; or keep open until macOS CI evidence.

### V4
- severity: info
- related_review_ids: F2
- title: Physical drag movement and Space-key activation not instrumented
- evidence: computed `-webkit-app-region` drag/no-drag only; keyboard test used Enter only
- detail: Electron honors `-webkit-app-region` on Windows; clicks on controls were not swallowed. True window translation under pointer drag and Space activation remain residual acceptance gaps, lower severity given CSS contract + control operability.
- suggested_next: optional re-run_with Playwright mouse drag on inert chrome measuring `getBounds().x/y` delta if review requires hard proof.

### V5
- severity: info
- related_review_ids: F2
- title: Linux and macOS host branches unanswered on this verify host
- evidence: `process.platform=win32`; no xvfb/macOS runner
- detail: Shared non-darwin code path reduces Linux risk but does not prove WM-specific behavior (tiling WMs, etc.). macOS `hiddenInset`/traffic-light geometry and F1 flash require a darwin runner.
- suggested_next: out_of_scope for this Windows verify agent unless Orchestrator schedules multi-OS CI; list as residual risk in review resume.

### V6
- severity: info
- related_review_ids: new
- title: Forged window-chrome IPC / navigation guard not runtime-probed
- evidence: static `assertTrustedSender` + `will-navigate` origin check present; no negative IPC test executed
- detail: Runtime `webPreferences` match contract. Negative security tests (forged sender, non-main-frame) remain static-only this round.
- suggested_next: re-run_with optional negative IPC unit/integration if review elevates; otherwise accept static continuity.

## unanswered
- macOS: `hiddenInset` traffic lights, no custom controls from first visible frame, no overlap with ribbon/identity (no darwin runner).
- Linux/Xvfb: custom fallback under a real Linux WM (no Linux runner).
- Physical drag: does inert `AppChrome` drag translate the OS window by pointer movement?
- Space-key activation on window controls (Enter only tested).
- Full light/dark/custom-accent matrix with long project identity strings at all three viewports (default light welcome chrome only).
- Runtime negative test for forged/non-main-frame window-chrome IPC.

## overall
- mission_status: partial
- summary_for_reviewer: On the available Windows host, the built app meets the product title-bar bar for F2: native title strip effectively removed (`titleBarStyle: hidden` + content/bounds `dy=0`), `AppChrome` is the only title strip, min size 1180×700 and resizable hold, Minimize/Maximize-Restore/Close work through the trusted bridge (pointer + Enter), native unmaximize syncs the Restore→Maximize label, drag/no-drag computed styles match the contract, security webPreferences remain strict, focused titlebar E2E and a sample P0 pass, typecheck/unit/build green, no glass/Lucide in production renderer. Mission is **partial** solely because macOS/Linux runtime branches and a few hard acceptance edges (pixel drag movement, Space key, full appearance matrix, negative IPC) were not available or not instrumented — not because Windows functional checks failed. F3 (`#000` close active) and F1 (macOS first-commit custom flash) remain open minor product issues.
- recommended_review_focus:
  1. Close F2 for Windows with V1 evidence; keep multi-OS residual explicit.
  2. Decide whether F1/F3 need fix this quality round or can ship with residual notes.
  3. Optional follow-up verify only if review demands physical drag deltas or macOS/Linux hosts.
