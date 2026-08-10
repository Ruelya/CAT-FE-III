# Findings round 3

## meta
- task: `.trellis/tasks/08-10-desktop-custom-titlebar`
- branch: `task/08-10-desktop-custom-titlebar`
- head_sha: `31f0f72453cbc2f6e0aee03f8781d94af8cbc0d0` (working tree includes post-verify F3 fix)
- round: 3
- verdict: `green_for_closeout`

## need_verify
- required: false

### Verify mission
- none; Windows runtime evidence remains authoritative from `verify-1.md`. F3 is a static token-only style contract closed by product CSS + appearance unit assertion. No new native-window claims require re-probe.

## issues
### F1
- severity: minor
- files: `apps/desktop/src/renderer/shell/use-window-chrome.ts:17-24`, `apps/desktop/src/renderer/App.tsx`, `apps/desktop/src/renderer/shell/AppChrome.tsx`
- problem: Platform still initializes to `"custom"` and is corrected to `"macos"` in a passive effect. A macOS first React commit can briefly mount custom controls / omit the 78px inset before the native branch is applied.
- minimal_fix: Deferred. Synchronous lazy init from `getWindowChromePlatform()` remains the preferred follow-up when a darwin runner is available.
- status: wontfix
- residual: Accepted macOS first-frame fidelity residual (no macOS runtime disproof). Windows first paint is already `"custom"` and is not affected.

### F2
- severity: major
- files: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/window-chrome.ts`, window-chrome bridge, `AppChrome` / styles, `tests/e2e/desktop-titlebar.spec.ts`
- problem: Native-window acceptance risk was evidence-gated; Windows built runtime satisfied the product title-bar bar (`verify-1.md` V1).
- minimal_fix: None for verified Windows scope.
- status: fixed
- residual: Linux/Xvfb and macOS `hiddenInset`/traffic-light geometry remain unproven on this host; shared non-darwin path reduces Linux risk but does not prove every window manager.

### F3
- severity: minor
- files: `apps/desktop/src/renderer/styles.css:328-330`, `apps/desktop/src/renderer/state/appearance.test.ts:177-201`
- problem: Close-button active background mixed `var(--color-error)` with raw `#000`, outside the appearance-v1/semantic token contract.
- minimal_fix: Applied — active state is now `color-mix(in srgb, var(--color-error) 85%, var(--color-text))` with inverse text; focused appearance test asserts the token-only mix and forbids `#000` in the close:active rule.
- status: fixed

## assumptions
- F3 fix is present in the working tree (`styles.css` + `appearance.test.ts`) as reviewed against the F2/F3 round-2 recipe.
- `verify-1.md` remains the Windows host authority; no re-run of the native probe was required solely for the token CSS change.
- F1 remains waived as the macOS residual from round 2; not elevated to blocker.
- Physical drag pixel translation, Space-key activation, full dark/custom-accent long-identity matrix, and negative forged-IPC runtime probing stay residual notes only (no open product defect established).

## summary_for_orchestrator
- Verdict: **`green_for_closeout`**. F3 is fixed with a token-only close active mix and a locked style contract. F2 is fixed for Windows via `verify-1.md`. F1 is wontfix / waived macOS residual. Open severity counts: blocker 0, major 0, minor 0 open (1 waived residual). Safe for closeout: update frontend window-chrome specs, write `closeout-summary.md`, then Orchestrator commit/merge. Do not archive from this agent.
