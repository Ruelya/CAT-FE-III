# Implementation plan: desktop custom title bar chrome

## Ordered checklist

### 1. Establish the platform contract

- [ ] Add `apps/desktop/src/main/window-chrome.ts` as a small pure helper that maps Electron platform values to the explicit macOS versus custom-control branches and returns the BrowserWindow title-bar options.
- [ ] Add focused unit coverage for the helper: macOS selects hidden-inset/native traffic lights; Windows and the documented non-macOS fallback select hidden-title-bar/custom-control behavior; existing size/security options are not represented as mutable renderer state.
- [ ] Confirm the helper does not import or start the Electron bootstrap so Vitest can execute it deterministically.

### 2. Add the minimal trusted bridge

- [ ] Add private main/preload channel constants for minimize, maximize/restore toggle, close, and maximized-state inspection.
- [ ] Extend `apps/desktop/src/shared/desktop-api.ts` with only window-chrome methods and the narrow platform type/capability needed by the renderer branch.
- [ ] Implement the preload methods through `ipcRenderer.invoke` and expose the platform fact without exposing Electron, Node, a raw `BrowserWindow`, or a general IPC function.
- [ ] Implement main handlers in `registerIpc()` with `assertTrustedSender()` first and `requireWindow()` as the only target. Return the resulting boolean from the maximize toggle and the current boolean from state inspection.
- [ ] Preserve all existing engine/dialog/update/plugin handlers and the secure `contextIsolation`, `nodeIntegration`, and `sandbox` values.

### 3. Switch BrowserWindow chrome by platform

- [ ] Consume the helper in `createWindow()` and remove the default title-bar behavior using Electron's hidden-title-bar configuration. Use hidden-inset on macOS and the custom-control branch on Windows/Linux as planned.
- [ ] Retain current dimensions, minimum dimensions, menu behavior, load paths, lifecycle listeners, navigation restrictions, and non-blocking bootstrap.
- [ ] Align the initial main-process background fallback with the existing light canvas if the current color is still divergent; do not add main-process appearance persistence.

### 4. Integrate AppChrome as the title strip

- [ ] Add an App-level `apps/desktop/src/renderer/shell/use-window-chrome.ts` controller/hook that reads the platform, queries maximized state on mount, updates after toggle, and re-queries on window resize with cleanup.
- [ ] Pass the controller's small view model and intent callbacks into `AppChrome`; do not put direct Electron access into product surfaces or navigation callbacks.
- [ ] Add `apps/desktop/src/renderer/shell/WindowControls.tsx` or an equivalent title-strip section. Render custom controls only on non-macOS branches, and render no duplicate controls on macOS.
- [ ] Ensure controls remain enabled when `state.mutationsEnabled` is false or the shell is in boot/recovery/reconnect states.
- [ ] Use Phosphor icons, functional `aria-label`/`title` values, real buttons, and the existing focus-visible treatment. Change the maximize control name/icon to Restore while maximized.

### 5. Implement drag, no-drag, and token styling

- [ ] Make the AppChrome title strip the draggable region with `-webkit-app-region: drag`.
- [ ] Mark navigation actions, custom window controls, buttons, and any title-strip input/select as `-webkit-app-region: no-drag`.
- [ ] Keep the current 48px shell row, ribbon, identity ellipsis, and action layout; add only the spacing/separator needed to host window controls.
- [ ] Add the macOS hidden-inset spacing class/attribute so native traffic lights cannot overlap the ribbon or identity.
- [ ] Use the existing light/dark/advanced-brown token variables for backgrounds, borders, text, hover, focus, and control states. Do not add glass or a second appearance source.
- [ ] Add reduced-motion-safe behavior if any control hover/transition is introduced; do not add a title-strip animation that changes layout.

### 6. Update test fakes and focused tests

- [ ] Add typed default implementations to `apps/desktop/src/renderer/test/fake-desktop-api.ts` for all new DesktopApi methods; defaults must be deterministic and must not mock engine persistence.
- [ ] Add/extend unit tests for the pure platform helper and WindowControls/AppChrome behavior: platform branches, labels, keyboard activation, callback calls, maximize/restore state, drag/no-drag CSS contract, and mutation-disabled availability.
- [ ] Add a small focused Electron E2E path for title-strip reachability and, on stable Windows runners, maximize/restore plus hidden-frame evidence. Gate platform-specific assertions honestly; do not click Close in a shared test.
- [ ] Keep current P0-P4 integration and E2E suites unchanged except for shared setup assertions required by the new shell.

### 7. Validate and review

- [ ] Run the focused unit tests and renderer/electron/E2E typechecks after each boundary change.
- [ ] Run a production desktop build before Playwright because the E2E harness uses `apps/desktop/dist`.
- [ ] Run the focused title-bar E2E on the available platform, then the full desktop E2E gate; inspect console/page errors and horizontal overflow at the three supported viewport sizes.
- [ ] Run the repository lint/typecheck/unit/E2E commands required by the frontend quality contract and audit renderer CSS for `backdrop-filter` and `lucide-react`.
- [ ] Review the diff specifically for accidental changes to engine IPC, app mutation disabling, save-before-navigation, native shortcut handling, or context isolation.

## Validation commands

Run from the repository root unless a command specifies the desktop package:

1. `pnpm --filter @translunar/desktop exec vitest run src/main/window-chrome.test.ts src/renderer/shell/WindowControls.test.tsx` (adjust only if the focused component test is folded into an existing shell test; proves the pure platform and control contracts).
2. `pnpm --filter @translunar/desktop typecheck` (strict Electron, renderer, and E2E TypeScript projects).
3. `pnpm --filter @translunar/desktop build` (production renderer plus Electron/preload output).
4. `pnpm --filter @translunar/desktop exec playwright test tests/e2e/desktop-titlebar.spec.ts` (if the focused spec is added; use the platform-gated path available in the runner).
5. `pnpm lint`.
6. `pnpm typecheck`.
7. `pnpm test`.
8. `pnpm test:e2e:desktop` (authoritative full desktop build and real-Engine Electron suite).
9. `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer` (must have no new/renderer matches).

## Risk points and review gates

- **Platform options:** hidden/hidden-inset behavior differs by OS and window manager. Gate: launch and inspect the actual built Electron app before renderer polish.
- **Drag hit testing:** a missing `no-drag` rule makes buttons appear clickable but swallow pointer input. Gate: click and keyboard-activate every control and inspect computed CSS/DOM landmarks.
- **Maximize state:** external maximize/snap can make a local toggle state stale. Gate: query on mount, after toggle, and on resize; use `aria-label` and icon derived from the query.
- **macOS layout:** native traffic lights can overlap the ribbon if the inset is too small. Gate: macOS screenshot/geometry check at the supported widths, without duplicate renderer controls.
- **Appearance:** main-process background is only an initial fallback while appearance-bootstrap applies renderer-local preferences. Gate: launch light, switch to dark/custom accent, verify title strip tokens change and relaunch persistence remains appearance-v1-only.
- **Bridge security:** a window command must not accept arbitrary window IDs or bypass sender validation. Gate: review every new handler against `assertTrustedSender` and ensure no raw Electron object reaches the renderer.
- **Existing tests:** new DesktopApi fields affect fakes and any structural test fixtures. Gate: update typed fake defaults before running integration tests; do not weaken assertions or mock the engine.
- **Rollback point:** if a platform-specific frame option breaks resize/launch, revert only the option selection to the default frame while preserving the isolated helper/contract tests; if custom controls are unstable, remove their mount and handlers together rather than adding an unsafe fallback bridge.

## Definition of done

The implementation has one product title strip, one trusted window-chrome bridge, explicit macOS/native and non-macOS/custom branches, token-driven light/dark rendering, correct drag hit areas, accessible keyboard controls, passing focused tests, a successful production build, and green applicable desktop quality gates.
