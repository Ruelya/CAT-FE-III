# Closeout summary: desktop custom title bar chrome

**Task:** `.trellis/tasks/08-10-desktop-custom-titlebar`  
**Branch:** `task/08-10-desktop-custom-titlebar`  
**Verdict:** `green_for_closeout` (findings-3)

## What shipped

Product-integrated desktop window chrome for Translunar Desktop:

- **Main:** pure `window-chrome.ts` maps `darwin` → `hiddenInset` / native traffic lights; Windows, Linux, and other hosts → `titleBarStyle: "hidden"` with custom renderer controls. `createWindow()` consumes the helper; trusted IPC handlers minimize / maximize-toggle / close / isMaximized with `assertTrustedSender` + `requireWindow`.
- **Preload / shared:** narrow `DesktopApi` surface only — `minimizeWindow`, `maximizeWindow` (returns resulting maximized boolean), `closeWindow`, `isWindowMaximized`, `getWindowChromePlatform` (`"macos" | "custom"`). Context isolation, sandbox, and nodeIntegration contracts unchanged.
- **Renderer:** `useWindowChrome` controller; `AppChrome` is the product title strip with drag region; `WindowControls` (Phosphor, accessible names Minimize / Maximize|Restore / Close) on non-macOS only; macOS omits custom controls and applies a 78px left inset. Window controls stay available when domain mutations are disabled.
- **Styles:** solid appearance-v1 tokens; drag/no-drag contract; no glass; close active uses `color-mix(..., var(--color-error), var(--color-text))` (F3).
- **Tests:** unit helper + WindowControls + appearance style contract; focused E2E `desktop-titlebar.spec.ts`; Windows native probe evidence in `review/verify-1.md` / `probe-titlebar.mjs`.

## Quality loop outcome

| ID | Severity | Status | Notes |
| --- | --- | --- | --- |
| F1 | minor | wontfix | macOS first-commit platform flash; waived residual until darwin runner |
| F2 | major | fixed | Windows native evidence closed acceptance risk; multi-OS residual explicit |
| F3 | minor | fixed | Close active token-only mix + appearance test lock |

Open severity ≥ major: **0**. Blockers: **0**.

## Specs touched

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | DesktopApi chrome methods; BrowserWindow platform branch; full **Scenario: Desktop custom title bar chrome** (7-section code-spec); validation matrix rows |
| `.trellis/spec/frontend/directory-structure.md` | shell window-chrome modules; main helper note |
| `.trellis/spec/frontend/component-guidelines.md` | WindowControls / use-window-chrome; title-strip token rules |
| `.trellis/spec/frontend/ai-plugins-settings.md` | Remove “title bar not shipped”; point to workbench chrome contract |
| `.trellis/spec/frontend/index.md` | Pre-dev checklist + appearance chrome note |

Task artifacts written this closeout:

- `review/findings-3.md` — `green_for_closeout`
- `closeout-summary.md` (this file)

No product feature work in closeout beyond the already-applied F3 CSS/test fix in the working tree.

## Suggested commit

**Subject:**

```text
feat(desktop): custom title bar chrome with trusted window controls
```

**Body:**

```text
Replace the default OS title bar with product AppChrome as the single
title strip. Main selects hiddenInset on macOS and hidden title bar with
custom controls on Windows/Linux. Expose only minimize/maximize/close/
isMaximized/platform through the sandboxed DesktopApi; keep trusted-sender
validation and solid appearance-v1 tokens (no glass).

Windows built-app verify covers min size, resizable, control ops, maximize
sync, drag CSS, and security prefs. macOS first-frame platform init and
Linux/macOS host geometry remain residual. Frontend specs document the
window-chrome contract for future sessions.

Task: 08-10-desktop-custom-titlebar
```

## Residual risks

1. **macOS runtime:** `hiddenInset` traffic-light geometry, no-overlap inset, and first-visible-frame control omission are unit/source-backed only (F1 waived). Prefer synchronous `getWindowChromePlatform()` init if a darwin runner elevates first-frame risk.
2. **Linux/Xvfb:** custom fallback shares the non-darwin path but is unproven under real WMs on this task host.
3. **Hard edges not instrumented:** physical AppChrome drag translation pixels, Space-key activation (Enter tested), full dark/custom-accent long-identity overflow matrix, negative forged-IPC runtime probe.
4. **Orchestration noise:** unrelated local edits (`.grok/agents/trellis-plan.md`, `07-19-complete-full-cat-prd/task.json`) should not be mixed into this task commit unless intentionally included by Orchestrator.

## Out of closeout scope

- No archive of the task directory.
- No git commit/merge (Orchestrator owns git).
- No new product features beyond documented F3 fix already in tree.
