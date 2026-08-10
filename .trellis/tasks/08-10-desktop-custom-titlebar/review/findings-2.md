# Findings round 2

## meta
- task: `.trellis/tasks/08-10-desktop-custom-titlebar`
- branch: `task/08-10-desktop-custom-titlebar`
- head_sha: `31f0f72453cbc2f6e0aee03f8781d94af8cbc2f6e0d0`
- round: 2

## need_verify
- required: false

### Verify mission
- none; `verify-1.md` was read in full. Its Windows runtime evidence is sufficient for this host, and the unavailable macOS/Linux branches are recorded as accepted residual platform risk rather than a new evidence mission.

## issues
### F1
- severity: minor
- files: `apps/desktop/src/renderer/shell/use-window-chrome.ts:17-24`, `apps/desktop/src/renderer/App.tsx:37-40`, `apps/desktop/src/renderer/shell/AppChrome.tsx:116-141`
- problem: The renderer still initializes the platform branch to `custom` and changes it to `macos` only in a passive effect. A macOS first React commit can therefore mount custom window controls before the native `hiddenInset` branch and its reserved inset are applied.
- minimal_fix: If macOS first-frame fidelity is brought into scope, initialize the platform synchronously from `getWindowChromePlatform()` before the first `AppChrome` render and retain the effect only for maximized-state querying and resize cleanup.
- status: wontfix

### F2
- severity: major
- files: `apps/desktop/src/main/index.ts:394-412`, `apps/desktop/src/main/index.ts:1143-1167`, `apps/desktop/src/main/window-chrome.ts`, `apps/desktop/src/renderer/shell/use-window-chrome.ts`, `apps/desktop/src/renderer/shell/AppChrome.tsx`, `apps/desktop/src/renderer/styles.css`, `apps/desktop/tests/e2e/desktop-titlebar.spec.ts`
- problem: The original evidence-gated native-window acceptance risk is closed for the available Windows host, with explicit cross-platform residuals retained below.
- minimal_fix: None for the verified Windows scope. If a Linux or macOS runner later exposes a host-specific failure, make only the targeted platform or layout change and rerun the focused native probe.
- status: fixed

### F3
- severity: minor
- files: `apps/desktop/src/renderer/styles.css:328-330`, `apps/desktop/src/renderer/state/appearance.test.ts:177-195`
- problem: The close control active state still derives its background with the raw literal `#000` in `color-mix(in srgb, var(--color-error) 85%, #000)`. This violates the title-strip requirement that active treatments use the existing appearance-v1/semantic token system and leaves a chrome-only color derivation outside the token contract.
- minimal_fix: Replace `#000` with an existing token (or remove the one-off active override and use an existing semantic state), then extend the focused style contract so the close active rule contains no raw black literal while preserving light/dark contrast.
- status: open

## assumptions
- `verify-1.md` is the authoritative evidence report for this round and was consumed in full, including its unanswered section and V1–V6 findings.
- Windows host evidence is accepted for the native title-bar removal, controls, min-size/resizability, maximize synchronization, security preferences, drag/no-drag computed styles, viewport overflow, and focused build/E2E checks.
- Linux/Xvfb and macOS runtime evidence is unavailable on this host. The Linux fallback and macOS traffic-light geometry/first-frame behavior remain explicitly documented residual platform risks; F1 is waived as the requested macOS residual.
- Physical drag translation, Space activation, the complete dark/custom-accent long-identity matrix, and negative forged-IPC runtime probing were not performed. The partial verify report documents these gaps; no new product failure was established from them.
- Unrelated orchestration/task bookkeeping changes remain outside this product review. No product code was changed by this review agent.

## summary_for_orchestrator
- Verdict: `need_fix`. The Windows native-window mission is satisfied for this host and F2 can be closed with the multi-OS residual explicitly accepted. F1 remains a waived macOS-only first-frame residual. F3 is still an open, host-independent product token violation caused by the raw `#000` close active-state mix; apply the minimal token-only fix and rerun the focused appearance/style test before closeout. Open counts are blocker 0, major 0, minor 1, needs_evidence 0.
