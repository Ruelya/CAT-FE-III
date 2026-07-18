# Frontend Quality Guidelines

## Automated Checks

The supported Node range is 22.17.x through 22.x, with pnpm 10.18.3. Run:

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
- Check no renderer console/page errors in Playwright.

## Review Checklist

- Renderer contains no Node/Electron imports and no domain/persistence rules.
- All async actions handle errors and expose a busy/disabled state where
  duplicate invocation would be unsafe.
- Navigation flushes pending saves before unmounting Workbench.
- Generated contracts, labels, aria state, and CSS transitions agree.
- Responsive screenshots show the editor, Suggestions, status, and Preview
  boundaries without overlap at the three supported viewport sizes.
- Production build is tested, including Vite's relative asset base and preload
  output.

## Avoid

- No snapshot-only UI tests that miss keyboard and data-flow behavior.
- No exact-pixel assertions tied to one DPI scale.
- No disabled button that hides a save or engine error.
- No animation implemented by unmounting the animated subtree.
- No broad `eslint-disable` or TypeScript suppression in production code.
