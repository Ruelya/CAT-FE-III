# Frontend Quality Guidelines

## Automated Checks

The supported Node lanes are 22.17.x through 22.x and 24.x, with pnpm
10.18.3. Node 23.x, 25.x, and other majors are rejected. Run:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm test:e2e:desktop
```

`pnpm test` includes Vitest and the Rust workspace through the root script;
the desktop package's unit tests collect only `src/**/*.test.ts(x)`. Playwright
tests belong in `apps/desktop/tests/e2e` and launch the built Electron app with
the real engine and an isolated data directory.

`pnpm --filter @translunar/desktop exec playwright test ...` reuses the current
`apps/desktop/dist` output. After changing renderer DOM, CSS, or assets, run
`pnpm build:desktop` before that focused command. The final
`pnpm test:e2e:desktop` gate builds automatically and remains authoritative.

## Test Expectations

Unit tests cover pure interaction guards and reducer transitions, including
IME-safe confirmation, panel mode transitions, preview clamping, assistant
conversation/model/reasoning actions, and metric formatting. Do not mock the
engine to claim persistence coverage.

Desktop E2E must exercise import, editable CJK target input, debounce/restart
recovery, confirm-and-advance, TM, number QA and resolution, export, Assistant
controls/metrics, and Suggestions/Preview docked/collapsed/maximized states.
Capture evidence at 1250x744, 1680x942, and 1920x1080 and inspect for overlap,
font rendering, panel seams, focus order, and horizontal transcript overflow.

## Accessibility And Visual Review

- Every control is keyboard reachable and has a name; icon-only controls use
  Lucide plus `title`/`aria-label`.
- Use semantic roles for tabs, menus, regions, separators, and live status.
- Preserve focus across animated collapse/expand and keep hidden content inert.
- Test IME composition with a real composition event, not only a direct state
  toggle.
- Prefer numeric geometry tolerances over exact CSS strings; Windows DPI can
  produce fractional values.
- Before each keyboard-resize phase, focus the separator and assert both its
  `aria-valuenow` transition and the final numeric geometry. Panel motion can
  otherwise make a sent key and a handled key indistinguishable in a long suite.
- Check no renderer console/page errors in Playwright.
- Composite widgets must use an allowed role/attribute pair. Prefer native
  roving `tabIndex` over `aria-activedescendant` on roles that do not support
  it (e.g. do not put `aria-activedescendant` on `role="navigation"`). On
  `role="grid"`, `aria-activedescendant` is valid but must never name an
  unmounted virtualized cell—unit tests cover seek-complete after window
  update. Unit tests should assert real `document.activeElement` movement or
  an axe check, not only that an attribute string changes.
- After removing a visible control (e.g. Workbench rail Confirm), update every
  E2E path that selected it. Segment confirm is the active-textarea
  `Control+Enter` contract.
- Phase 3 grid coverage: lamp matrix, roving seek/Tab-in-edit/select-all
  expansion, single ActiveAxis under multi-select, composition-first guards,
  and batch adapter enablement. Live Electron IME matrix, axe with batch/QA
  visible, and 10k P95 remain required product quality when the Engine/harness
  is available—do not treat window-only select-all or bulk-sign Lock as green.
- Phase 4 stack/dock coverage: `wordDiff` unit cases; StackPanel co-visible
  Matches+Terms with no tablist and single collapse; GroundingInspector only
  with real `PromptBundle`; PreviewDock under grid column with honest pop-out
  residual. Do not reintroduce QA-in-stack tabs or color-block TM diffs.
- Phase 8 system coverage: unit tests for `theme-controller`,
  `appearance-controller`, and `draft-recovery-presenters`; theme E2E must
  assert `html[data-theme="light"|"dark"]` (never `.workbench-app.theme-dark`
  class). Ban new `LoaderCircle` + `className="spin"` pairs in renderer TSX.
  Density × UI scale matrix checklist under task `evidence/` (live PNGs may be
  deferred). Forced-colors rules must remain in `01-reset.css` with lamp
  `forced-color-adjust: none` preserved.

## Review Checklist

- Renderer contains no Node/Electron imports and no domain/persistence rules.
- All async actions handle errors and expose a busy/disabled state where
  duplicate invocation would be unsafe.
- Navigation flushes pending saves before unmounting Workbench.
- Generated contracts, labels, aria state, and CSS transitions agree.
- Responsive screenshots show the editor, Stack (Suggestions rail), status, and
  Preview dock boundaries without overlap at the three supported viewport sizes.
- Production build is tested, including Vite's relative asset base and preload
  output.

## Avoid

- No snapshot-only UI tests that miss keyboard and data-flow behavior.
- No exact-pixel assertions tied to one DPI scale.
- No disabled button that hides a save or engine error.
- No animation implemented by unmounting the animated subtree.
- No broad `eslint-disable` or TypeScript suppression in production code.

## Task Package Quality Gate

The real-Engine task-package E2E must cover trusted `.tltask` dialogs,
assignment export, assignment preview/import, return export, all Engine
dispositions, paging, cross-page selection, stale retry, terminal applied and
discarded states, and no-clobber/error paths. Assert accessible names for tabs,
checkboxes, pagination, dialog actions, and icon-only discard. Capture
1250x744, 1680x942, and 1920x1080 screenshots and fail on console/page errors,
horizontal overflow, overlapping controls, or text escaping its container.

The renderer must not parse package files or compute hashes/conflicts. A
failed apply must leave the preview visible and retryable; a terminal preview
must not expose another mutation command.
