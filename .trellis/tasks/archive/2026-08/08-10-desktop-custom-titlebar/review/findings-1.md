# Findings round 1

## meta
- task: `.trellis/tasks/08-10-desktop-custom-titlebar`
- branch: `task/08-10-desktop-custom-titlebar`
- head_sha: `31f0f72453cbc2f6e0aee03f8781d94af8cbc0d0`
- round: 1

## need_verify
- required: true

### Verify mission (required if need_verify)
- purpose: Static review and focused unit/type checks establish the intended cross-layer wiring, but they cannot prove that Electron 41.10.3 and each host window manager actually remove the native title bar, preserve resize/minimum-size behavior, expose usable drag hit regions, synchronize native maximize transitions, or position macOS traffic lights without overlap.
- questions:
  - On Windows 10+ in a freshly built app, is `AppChrome` the only visible title strip, with no native title-bar row, while the window remains resizable and enforces the existing 1180×700 minimum?
  - On Windows, do Minimize, Maximize/Restore, and Close work through the trusted bridge with pointer and keyboard activation, and does the Maximize/Restore name/state follow both button-driven and native/external maximize, restore, resize, or snap transitions?
  - On Linux/Xvfb where available, does the explicit non-macOS custom-control fallback launch and remain movable, resizable, minimizable, maximizable/restorable, and closable under the active window manager?
  - On macOS where available, does `hiddenInset` retain native traffic lights, omit renderer-owned controls from the first visible frame onward, and keep the traffic lights clear of the ribbon, identity, and navigation at supported widths?
  - Do computed styles make the non-interactive `AppChrome` surface draggable and every interactive descendant/custom control non-draggable, without swallowed clicks, focus, Enter, or Space activation?
  - At 1250×744, 1680×942, and 1920×1080, do long identities and the full action/control set avoid horizontal overflow or clipping in light, dark, and custom-accent appearance, with no console/page errors and no translucent/glass material?
  - Are `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, current navigation restrictions, trusted-sender rejection, and the single-main-window target still intact in the built runtime?
- success_criteria:
  - A production build launches with one product title strip; Windows/non-macOS content reaches the hidden-title-bar frame, the window is resizable, and its reported minimum size remains 1180×700.
  - Non-macOS controls are visible, named, focusable, and operable; minimize changes the real window state, maximize then restore uses the same control, an OS-driven maximize/unmaximize is reflected by `Restore`/`Maximize`, and an isolated close check follows the normal close path.
  - Dragging an inert part of `AppChrome` moves the window; action and window-control hit targets remain `no-drag` and work by pointer and keyboard.
  - macOS evidence, when a macOS runner is available, shows native traffic lights with `hiddenInset`, no renderer controls in the visible frame, and no overlap. If no macOS runner is available, the report must mark this question unanswered/partial rather than treating the pure helper test as runtime proof.
  - Linux evidence, when a Linux/Xvfb runner is available, shows the custom fallback remains usable. If unavailable, the report records the residual host risk explicitly.
  - All three supported viewport geometries have no document-level horizontal overflow or clipped window controls/identity, and token changes update the same title-strip DOM without console/page errors.
  - Runtime inspection confirms the security web preferences and navigation guard remain unchanged; forged/non-main-frame window-chrome IPC does not gain a usable command path.
- failure_signals:
  - A native title bar remains above `AppChrome`, two title strips/traffic-light sets appear, the first visible macOS frame flashes custom controls, or native traffic lights overlap renderer content.
  - The window cannot be dragged/resized, violates the 1180×700 minimum, or a control click/keyboard event is swallowed by a drag region.
  - Minimize/close does not affect the application window, maximize cannot restore, or the accessible label/state becomes stale after native maximize/unmaximize, snap, or resize.
  - Controls or identity clip/overflow at a supported viewport, a theme/accent change leaves stale chrome colors, or console/page errors appear.
  - The focused E2E only proves DOM callbacks while native window state contradicts them, or a platform-specific branch is skipped without being listed as unanswered residual risk.
  - Security preferences, sender validation, single-window targeting, or navigation restrictions differ from the pre-change contract.
- suggested_commands:
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop exec vitest run src/main/window-chrome.test.ts src/renderer/shell/WindowControls.test.tsx src/renderer/state/appearance.test.ts`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop exec playwright test tests/e2e/desktop-titlebar.spec.ts --trace on`
  - `xvfb-run -a pnpm --filter @translunar/desktop exec playwright test tests/e2e/desktop-titlebar.spec.ts --trace on` (Linux runner only)
  - Use a focused Playwright/Electron investigative probe (`ElectronApplication.evaluate` plus page geometry/computed-style checks) to inspect the real `BrowserWindow` resizable/minimum/minimized/maximized state, security preferences, native maximize/unmaximize synchronization, and an isolated close flow; the checked-in spec currently does not answer all of those questions.
  - `rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer --glob '!**/*.test.*'`
- scope: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/window-chrome.ts`, `apps/desktop/src/preload/index.cts`, `apps/desktop/src/shared/desktop-api.ts`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/shell/{AppChrome,WindowControls,use-window-chrome}.*`, `apps/desktop/src/renderer/styles.css`, focused chrome/appearance tests, and `apps/desktop/tests/e2e/desktop-titlebar.spec.ts`; exercise only available host branches and report unavailable Windows/Linux/macOS branches explicitly.
- avoid: Do not run the full monorepo or full desktop E2E suite before the focused build/spec is understood; do not click Close in a shared multi-assertion flow; do not use exact-pixel/DPI-fragile assertions; do not weaken sandboxing, sender checks, or navigation guards to make a probe pass; do not treat a helper/unit result as native window-manager evidence.
- related_issues: F1, F2, F3

## issues
### F1
- severity: minor
- files: `apps/desktop/src/renderer/shell/use-window-chrome.ts:17-24`, `apps/desktop/src/renderer/App.tsx:37-40`, `apps/desktop/src/renderer/shell/AppChrome.tsx:116-140`
- problem: The platform state is initialized to `"custom"` and corrected to `"macos"` only in a passive effect. Therefore the first React commit on macOS contains renderer Minimize/Maximize/Close controls and lacks the 78px native-traffic-light inset, even though the `BrowserWindow` already uses `hiddenInset`. The initially hidden window may mask this on some launches, but the implementation does not guarantee the first visible/accessibility frame follows the truthful macOS branch and can flash duplicate/overlapping chrome.
- minimal_fix: Initialize `platform` synchronously with a lazy state initializer from `window.translunar.getWindowChromePlatform()` (or otherwise provide the platform before the first `AppChrome` render), remove the post-commit platform correction, and keep maximized-state querying/resize cleanup in the effect. Add an integration assertion that the first rendered macOS branch has the inset and never mounts custom controls.
- status: open

### F2
- severity: major
- files: `apps/desktop/src/main/index.ts:389-450`, `apps/desktop/src/main/index.ts:1143-1167`, `apps/desktop/src/main/window-chrome.ts:1-44`, `apps/desktop/src/renderer/shell/use-window-chrome.ts:17-75`, `apps/desktop/src/renderer/shell/AppChrome.tsx:116-319`, `apps/desktop/src/renderer/styles.css:187-337`, `apps/desktop/tests/e2e/desktop-titlebar.spec.ts:60-143`
- problem: The implementation makes native-window behavior claims that static review cannot close. The checked-in focused E2E covers steady-state platform DOM, computed drag/no-drag values, and button-driven maximize/restore, but it does not prove absence of the OS title bar, resizability/minimum dimensions, native/external maximize-state synchronization, actual drag movement, Minimize, isolated Close, supported-viewport overflow/identity clipping, runtime security preferences, Linux fallback behavior, or macOS `hiddenInset` traffic-light geometry. These are acceptance-level risks, so the issue remains evidence-gated rather than presumed passing.
- minimal_fix: No product-code change is prescribed until the verify mission identifies a failing behavior. Run the focused built-Electron mission on the available host(s), answer every question with native window/DOM evidence, record unavailable platform branches as residual risk, and then make only the targeted fix for any confirmed failure.
- status: needs_evidence

### F3
- severity: minor
- files: `apps/desktop/src/renderer/styles.css:323-330`
- problem: The close button's active state mixes `var(--color-error)` with a raw `#000`. The title-strip requirement says its hover/active treatments must come from existing appearance-v1/semantic tokens; this one-off literal creates a chrome-only color derivation and is the only production renderer use of raw black in this area.
- minimal_fix: Use an existing semantic/surface/text token for the active state, or mix `--color-error` only with another existing token after checking light/dark contrast; add the token-only close-state expectation to the focused style contract.
- status: open

## assumptions
- The untracked chrome source/test files listed by `git status` are intentional parts of this task and were reviewed in full.
- Unrelated working-tree changes in `.grok/agents/trellis-plan.md` and `.trellis/tasks/07-19-complete-full-cat-prd/task.json` are orchestration/task bookkeeping and are not product findings for this review.
- No prior `findings-*.md` or `verify-*.md` existed in the task review directory.
- Local review evidence: `git diff --check` passed; desktop strict typecheck passed; focused Vitest (`window-chrome`, `WindowControls`, `appearance`) passed 21/21; the production-source glass/Lucide audit excluding assertion files produced no matches.
- A production desktop build and native Electron E2E were intentionally left to the required verify mission; no runtime platform claim is inferred from the passing unit tests.

## summary_for_orchestrator
- Verdict: `need_verify`. The cross-layer implementation is structurally aligned with the plan: platform-specific `titleBarStyle`, trusted narrow IPC, preload-only Electron access, `AppChrome` drag/no-drag regions, accessible Phosphor `WindowControls`, macOS omission/inset styling, and focused type/unit coverage are present. F2 blocks green pending built native-window evidence. F1 and F3 are bounded minor fixes: eliminate the first-commit macOS custom-control branch and remove the raw black active-state derivation. Open counts are blocker 0, major 0 open, minor 2 open, needs_evidence 1.
