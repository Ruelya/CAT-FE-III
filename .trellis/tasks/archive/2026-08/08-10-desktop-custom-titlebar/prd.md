# Desktop custom title bar chrome

## Goal

Replace the default Electron OS title bar with product-integrated desktop chrome. The existing `AppChrome` header becomes the visible title strip on platforms that use custom controls, retains the Translunar brand ribbon, and derives its solid colors from the renderer appearance-v1 tokens. Windows users receive accessible minimize, maximize/restore, and close controls without losing native window resizing or keyboard behavior. macOS keeps native traffic lights in a hidden-inset title bar when Electron supports the branch cleanly.

## Context and evidence

- `apps/desktop/src/main/index.ts` currently creates a normal framed `BrowserWindow`; no custom title-bar option is configured.
- The renderer has no `-webkit-app-region` declarations. `AppChrome` is currently an in-content header and is visually separate from the OS title bar.
- The renderer already owns appearance-v1: light is the default, advanced-brown uses `#765847`, dark mode is stored in `translunar.renderer.appearance.v1`, and solid token surfaces are used. Appearance must remain renderer-local.
- The existing BrowserWindow security boundary is `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`; the custom chrome must preserve it.
- The existing desktop shell is constrained by a 1180px minimum width, a 48px chrome row, supported viewport geometry checks, and real-Engine Electron E2E.

## Requirements

### Window frame and platform behavior

1. Windows 10+ must launch without the default title bar, using an Electron-supported hidden-title-bar or frameless configuration. The window must remain resizable and retain the current minimum dimensions.
2. Windows must render custom minimize, maximize/restore, and close controls in the product title strip. The maximize control must restore the window after it is maximized.
3. macOS must use a truthful platform branch. When the Electron runtime supports it, use a hidden-inset title bar with native traffic lights; do not render a second set of custom traffic-light controls. Reserve enough title-strip space for the native buttons so the brand, identity, and navigation do not overlap them.
4. Linux or other desktop hosts must have an explicit behavior rather than accidentally receiving Windows-only assumptions. The selected fallback may use the custom controls, provided the window remains usable in the tested Electron environment.
5. The custom title strip must expose a draggable region. Interactive elements in that strip, including all buttons and any future inputs, must be explicitly non-draggable.
6. Double-click maximize may be supported on platforms where the hidden title-bar behavior is reliable. It is optional and must not be implemented at the expense of button, input, or keyboard behavior.

### Renderer integration and appearance

7. `AppChrome` must be the product title strip rather than a second header below an OS title bar. Its brand ribbon and identity layout must stay intact unless spacing is required for native macOS traffic lights.
8. Chrome backgrounds, borders, text, focus rings, hover states, and accent treatments must use existing solid appearance-v1 tokens. Light/dark changes and custom accent seeds must update the title strip and Windows controls without a second theme store or a new appearance IPC contract.
9. No glass material, `backdrop-filter`, or translucent title-bar workaround may be introduced.
10. The title strip and controls must remain within the existing shell layout at 1250x744, 1680x942, and 1920x1080, with no horizontal overflow or clipped identity text.

### Preload boundary and accessibility

11. Add only window-chrome methods to `DesktopApi` and expose them through the existing context-isolated preload bridge. The surface must cover minimize, maximize/restore, close, and maximized-state inspection; renderer code must not import Electron or Node APIs.
12. Main-process chrome handlers must validate the trusted sender using the existing IPC guard and operate only on the application window.
13. Window controls must be real keyboard-reachable buttons with stable accessible names (`Minimize`, `Maximize`/`Restore`, and `Close` or equivalent localized functional names). Icon-only controls must use the established Phosphor icon convention, `title`, and `aria-label`.
14. Window controls must stay available while the app is booting, reconnecting, or has domain mutations disabled. Existing renderer keyboard shortcuts and native platform close/minimize behavior must continue to work.

## Acceptance criteria

- [ ] On Windows 10+ in the built Electron app, the OS title bar is absent, the product title strip is visible, the window remains resizable at the existing minimum size, and no second title strip is present.
- [ ] Windows custom controls are visible and named; Minimize invokes the main-window minimize operation, Maximize invokes maximize, the same control restores the window, and Close invokes the normal window close path.
- [ ] The maximized-state query and UI state stay synchronized after button actions and normal window resize/maximize transitions; the button exposes the correct `aria-label` and state for maximize versus restore.
- [ ] The title strip has `-webkit-app-region: drag`; its controls and interactive descendants have `-webkit-app-region: no-drag`; controls remain clickable, focusable, and keyboard operable.
- [ ] Light/default appearance uses the existing canvas/surface/border/text/accent tokens, including advanced-brown `#765847`; dark/custom-seed appearance updates the same DOM chrome without `ProductShellSettings` changes or glass CSS.
- [ ] On macOS, the app uses the hidden-inset/native traffic-light branch when launched with the supported Electron version, custom controls are not duplicated, and the reserved inset prevents overlap at the supported widths.
- [ ] The explicit non-macOS fallback branch is documented and does not rely on macOS-only traffic-light assumptions.
- [ ] Context isolation, sandbox, node-integration settings, trusted-sender validation, existing navigation restrictions, and engine IPC behavior remain unchanged.
- [ ] Existing desktop unit/integration tests and E2E suites remain green; focused chrome tests cover platform rendering, commands, accessible names, and appearance/drag-region contracts. A focused Electron E2E is added only for stable platform/window evidence.
- [ ] Lint, strict Electron/renderer/E2E typecheck, unit tests, production desktop build, and the applicable desktop E2E gate pass.

## Constraints

- Keep the main/preload/renderer boundary intact and keep context isolation and sandbox enabled.
- New bridge methods are limited to window chrome; do not add a general Electron or filesystem bridge.
- Appearance remains `translunar.renderer.appearance.v1` in renderer local storage. Do not write theme or accent to shell settings.
- Use existing solid tokens and Phosphor icons. Do not add glass, new icon libraries, or a second shell implementation.
- Do not change engine contracts, save/navigation ownership, or unrelated AppChrome navigation behavior.
- No product source code is part of this planning deliverable; implementation is a later phase.

## Out of scope

- Replacing the application menu, taskbar/dock integration, system menu commands, or native window shadows.
- Multiple-window management, tabs, detached panels, or per-window persisted geometry.
- A Windows `titleBarOverlay` implementation that leaves native controls in charge; the chosen design uses custom controls so runtime appearance tokens and the brand ribbon share one surface.
- Custom macOS traffic-light drawing or changing the macOS traffic-light symbols.
- Appearance preference redesign, new theme tokens unrelated to chrome, or persistence outside appearance-v1.
- Custom maximize gestures beyond the optional title-strip double-click behavior.

## Assumptions and confidence

- High: Electron 41.10.3 supports hidden title-bar options on the supported desktop platforms and the existing single `mainWindow` is the correct control target.
- High: the current `AppChrome` can own the drag strip without moving domain logic because it already sits at the root shell boundary.
- Medium: frameless/hidden-title-bar window resizing and maximize behavior will be stable in the project's Windows and Xvfb Electron test environments; the focused E2E should be platform-gated if window-manager behavior is not deterministic.
- High: no plan-phase external research is required beyond the repository and current Electron documentation evidence already consulted.
