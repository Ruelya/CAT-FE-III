# Technical design: desktop custom title bar chrome

## Design intent

Make the existing shell header the single visual title strip while keeping OS integration in the Electron main process and keeping appearance ownership in the renderer. The design chooses Electron's hidden title-bar mode plus renderer-owned Windows/Linux controls instead of `titleBarOverlay`: overlay symbols and hit areas remain partly native, while the product requirement calls for one token-driven ribbon/title strip and accessible, testable controls. macOS uses the native traffic lights because that is the platform convention and avoids redrawing them.

## Current boundaries

- Main window creation and lifecycle are in `apps/desktop/src/main/index.ts`. `createWindow()` currently uses the default frame and already has the required secure `webPreferences`.
- Main and preload intentionally duplicate private IPC channel constants. Main uses `assertTrustedSender()` and `requireWindow()` for the trusted single-window boundary.
- `apps/desktop/src/preload/index.cts` exposes the typed `DesktopApi` through `contextBridge`; `apps/desktop/src/shared/desktop-api.ts` is the renderer-facing contract and `global.d.ts` attaches it to `Window`.
- `apps/desktop/src/renderer/App.tsx` mounts `AppChrome` at the root shell. `AppChrome` currently contains the brand ribbon, current surface identity, and product navigation buttons.
- `tokens.css`, `styles.css`, `state/appearance.ts`, and `appearance-bootstrap.ts` already provide the light/dark/advanced-brown solid-token path. No shell setting or main-process appearance state should be added.

## Platform matrix

| Host | BrowserWindow title-bar mode | Visible controls | Layout treatment |
| --- | --- | --- | --- |
| Windows (`win32`) | Electron hidden title bar; custom renderer controls, with the existing resizable/minimum-size options retained | Renderer Minimize, Maximize/Restore, Close | AppChrome spans the top row and its non-interactive surface is draggable |
| macOS (`darwin`) | `hiddenInset` | Native traffic lights only; renderer window controls are omitted | Reserve a left inset in the title strip for traffic lights; brand and identity remain in the same row |
| Linux/other supported desktop host | Explicit hidden-title-bar fallback using the same custom renderer controls as Windows | Renderer Minimize, Maximize/Restore, Close | Same drag/no-drag contract as Windows; document that behavior as the fallback rather than pretending macOS traffic lights exist |

The platform mapping should be centralized in `apps/desktop/src/main/window-chrome.ts` as a small pure helper so BrowserWindow option selection is isolated from the bootstrap. The renderer receives the same explicit platform vocabulary through the narrow shared `DesktopApi` type. Unknown Electron platform strings may map to the non-macOS fallback; the renderer must only treat the explicit macOS value as native-traffic-light mode.

## Main-process contract

### BrowserWindow configuration

Add a platform-aware options helper consumed by `createWindow()`:

- macOS selects `titleBarStyle: "hiddenInset"` and does not opt into a title-bar overlay.
- Windows and the non-macOS fallback select Electron's supported `titleBarStyle: "hidden"` path, which removes the default title bar while retaining a resizable window. Do not combine this with an unnecessary second frame strategy unless an Electron runtime test proves it is required.
- Keep `width`, `height`, `minWidth`, `minHeight`, `show`, `autoHideMenuBar`, `backgroundColor`, and all secure web preferences. Align the initial background fallback with the existing light canvas token where appropriate; the renderer remains responsible for the persisted dark/custom appearance after its pre-React bootstrap.

A pure helper test should verify the macOS/non-macOS option split without importing or starting the main bootstrap. It must not assert one exact pixel geometry or rely on a particular Windows DPI scale.

### Private IPC

Add only these window-chrome operations to the existing channel maps and `DesktopApi`:

- `minimizeWindow(): Promise<void>`
- `maximizeWindow(): Promise<boolean>` — a toggle operation: maximize when normal and restore when already maximized; returns the resulting maximized state.
- `closeWindow(): Promise<void>`
- `isWindowMaximized(): Promise<boolean>`
- `getWindowChromePlatform(): WindowChromePlatform` — a small platform capability fact exposed by preload, not a general process or Electron object.

The exact names may follow the repository's existing naming convention, but the final contract must retain these four behaviors and the platform branch without exposing a raw `BrowserWindow` or arbitrary channel invoker. The platform fact can be derived in preload from the known platform value; window mutations and state inspection must use IPC handlers.

Every main handler calls `assertTrustedSender(event)` before accessing the application window. `minimizeWindow` calls the normal minimize operation, `maximizeWindow` toggles maximize/unmaximize, `isWindowMaximized` reads the current state, and `closeWindow` calls the normal close path. A missing window fails through the existing `requireWindow()` error rather than silently targeting another window. No engine handler or sender validation is changed.

## Renderer data flow

```text
BrowserWindow options
  -> main window lifecycle
  -> trusted window-chrome IPC handlers
  -> sandboxed preload DesktopApi methods
  -> App-level useWindowChrome controller
  -> AppChrome title strip + WindowControls
  -> CSS drag/no-drag and appearance-v1 tokens
```

The App-level controller owns bridge calls so presentational controls receive intent callbacks rather than importing Electron. It should:

1. Read the platform capability once from the bridge and initialize the platform branch without a renderer-side Node import.
2. Query `isWindowMaximized()` on mount and after maximize/restore actions.
3. Re-query on `window.resize` so OS maximize, restore, snap, and keyboard-driven transitions update the control state. Cleanup the listener on unmount.
4. Keep minimize/close actions independent from `state.mutationsEnabled`; domain mutation gating must never disable window management.
5. Treat command rejection as an OS-chrome error path that does not crash or unmount the app. The control may retain its last known state until the next successful query.

`AppChrome` receives a small window-chrome view model/callback set. It remains responsible for visual composition and navigation but not IPC payloads. A focused `WindowControls` component keeps platform conditional rendering and named buttons easy to test.

## Title-strip interaction and CSS

- Apply `-webkit-app-region: drag` to the top-level title strip surface.
- Apply `-webkit-app-region: no-drag` to the product action cluster, custom window-control cluster, every button, and any input/select that may later be placed in the strip. This prevents a drag click from swallowing an action.
- Keep the existing 48px shell row and make window-control hit areas fill the row with stable, pointer-sized targets. Keep identity flex-shrink/ellipsis behavior so long project/document names do not push controls out of the viewport.
- Use the existing `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent-soft`, focus, and semantic tokens. Close hover may use the existing error token only if its contrast and theme behavior are checked; do not create a parallel color palette.
- On macOS, add a platform class/attribute to provide a left inset for native traffic lights. The title strip remains one row; do not add a second height row or move the stage independently.
- Do not add `backdrop-filter`, alpha-based glass surfaces, or a new color-scheme store. Existing pre-React `applyAppearance()` continues to set `data-theme`, derived accent properties, `color-scheme`, and solid token values before React mounts.

## Accessibility and keyboard contract

- Window controls are semantic `<button type="button">` elements, are included in normal tab order, and have functional accessible names. Maximize/restore changes both the visual icon and accessible label.
- Icon-only controls use Phosphor icons plus `title` and `aria-label`, with visible `:focus-visible` styling from the existing global rule.
- The drag surface must not be the only way to move the window: the OS and normal keyboard behavior remain available, and focusable buttons are outside the drag region.
- Do not stop propagation or prevent default for editor shortcuts globally. Double-click support, if added, must be restricted to the non-interactive title strip and must not affect buttons or inputs.
- macOS relies on native traffic-light accessibility and behavior; the renderer must not announce duplicate controls.

## Tests and evidence

### Unit/integration

- Pure helper unit test: platform-to-BrowserWindow options and custom-control/native-traffic-light decision.
- `WindowControls` component test: Windows/fallback controls render with names, disabled app mutation state does not disable them, maximize/restore label follows state, and callbacks fire from pointer and keyboard activation. macOS test confirms custom controls are absent and the native-inset class/branch is selected.
- Appearance/style contract test: title strip uses the existing token names, contains drag and no-drag declarations, and contains no forbidden glass material. Extend the existing appearance test only where it remains focused on static token contracts.
- Update `test/fake-desktop-api.ts` with typed chrome defaults so existing App integration tests continue to boot without mocking the engine or bypassing the bridge.

### Electron E2E

Add a small, platform-aware title-bar spec or a focused block in the always-on P4 spec. It should launch the built app with the normal isolated user-data directory, assert the app-shell/title-strip reachability and named controls on non-macOS, and, where a stable Windows runner is available, exercise maximize then restore and inspect that the window is frameless/hidden-title-bar. On macOS assert native traffic-light mode through stable DOM/platform evidence and absence of duplicate custom controls. Avoid clicking Close in a shared flow and avoid exact-pixel assertions. Keep existing console/page-error and no-horizontal-overflow guards.

## Trade-offs

- **Hidden title bar + custom controls (chosen):** strongest token/brand integration and complete renderer accessibility; requires explicit IPC and careful drag hit areas, and Linux window-manager behavior needs verification.
- **`titleBarOverlay` (not chosen):** less custom IPC and more native platform behavior, but symbols/hover treatment and overlay metrics are platform-owned and would not be as tightly unified with appearance-v1.
- **Fully custom macOS controls (not chosen):** one visual system but duplicates familiar native traffic lights and increases platform accessibility/layout risk.
- **IPC event for maximize changes (not required initially):** an event would be more immediate for external state changes, but resize-query synchronization is smaller and keeps the bridge surface minimal. Add a narrowly scoped event only if a verified platform misses resize notifications.

## Rollout and rollback

1. Land the pure platform helper and bridge contract with no change to renderer navigation.
2. Add hidden-title-bar options and trusted handlers; validate launch, resize, and close behavior before styling.
3. Integrate AppChrome drag/no-drag styling and custom controls; verify light/dark appearance and accessibility.
4. Run focused unit/build/E2E checks, then the full desktop gates.
5. If a platform-specific window manager breaks resize or traffic-light layout, rollback only the platform option branch to the default frame while retaining isolated, tested renderer/API work for a follow-up. If custom controls cause regressions, remove their mount and handlers together and restore the default frame; do not weaken context isolation or bypass the preload boundary.
