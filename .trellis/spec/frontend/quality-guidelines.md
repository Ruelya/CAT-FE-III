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

### P0 static appearance audit

These searches must produce no renderer matches for forbidden materials/icons:

```text
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
```

Theme/accent strings are allowed only as fixed appearance constants and CSS
tokens — not as settings controls or storage keys.

## Test Expectations

Unit tests cover pure interaction guards and controller transitions:

- Session parser: missing, malformed, unsupported version, blank IDs, valid
  identity, canonical serialization (`state/session.test.ts`)
- Surface resolver: valid session, empty/non-empty project list, open-project
  document routing (`routes/resolveSurface.test.ts`)
- IME guard: composition lifecycle, `isComposing`, keyCode/which 229, no side
  effects, post-composition confirm (`lib/ime.test.ts` + component/integration)
- Save coordinator: generations, flush stability while typing, journal error
  without Engine rollback (`state/save-coordinator.test.ts`)
- Draft recovery classification and multi-record retention
- Appearance/tokens: light + advanced brown defaults, required vars, forbidden
  glass CSS (`state/appearance.test.ts`)
- Recovery dialog keyboard: initial focus, trap, non-destructive Escape
- P1 pure helpers: document aggregate/post-delete route, template definition
  merge, search hit classify, analytics availability formatting
- P1 integration (`App.p1.integration.test.tsx`): batch import cancel/mixed,
  document switch save-before, templates, recycle restore/purge, search nav,
  insights, example, archive/update, stale feature-op guards

Do not mock the engine to claim persistence coverage in E2E. Integration tests
may use a typed `DesktopApi` fake at the renderer boundary
(`test/fake-desktop-api.ts`) with deferred promises for ordering.

Desktop E2E (P0 vertical slice) must exercise real-Engine create/import,
editable CJK target, confirm, exact TM, QA, gate-enforced export with real
output file, relaunch resume, Project Home Open, axe on stable states, and no
renderer console errors. Prefer `tests/e2e/p0-vertical-slice.spec.ts` as the
focused acceptance path for the P0 shell.

Desktop E2E (P1 project lifecycle) must exercise real-Engine multi-file import,
document switch, templates/create-from-template, recycle restore/purge and
Home/search exclusion, search jump, insights, example project identity +
relaunch. Prefer `tests/e2e/p1-project-lifecycle.spec.ts`.

### Stable P1 landmarks (`data-testid`)

Ordinary assertions still prefer roles, labels, and Engine-rendered text. Use
these landmarks when accessible names collide (especially Recycle vs Workbench
“Document”, and Home **Open** vs **Open example**):

| testid | Use |
| --- | --- |
| `document-switcher` | Switcher region root |
| `document-switcher-select` | Document `<select>` options (Engine-ordered) |
| `global-search` | Search surface root |
| `nav-search` | Chrome Search |
| `nav-insights` | Chrome Insights |

P0 Home Open must target the **Listed** project row’s exact `Open` name — not
the global Open example control.

## Accessibility And Visual Review

- Every control is keyboard reachable and has a name; icon-only controls use
  Phosphor (`@phosphor-icons/react`) plus `title`/`aria-label`.
- Use semantic roles for dialogs, regions, lists, and live status.
- Preserve focus across panel collapse/expand and recovery open/close; keep
  hidden content inert.
- Test IME composition with real composition events and keyboard 229 paths, not
  only a direct state toggle.
- Prefer numeric geometry tolerances over exact CSS strings; Windows DPI can
  produce fractional values.
- Check no renderer console/page errors in Playwright.
- No filler UI copy, guiding microcopy, or “不是”-style contrast constructions.

## Review Checklist

- Renderer contains no Node/Electron imports and no domain/persistence rules.
- All async actions handle errors and expose a busy/disabled state where
  duplicate invocation would be unsafe.
- Navigation flushes pending saves via `SaveCoordinator.flush()` before leaving
  Workbench (including Search, Insights, document switch, active-document
  recycle).
- Session is identity-only; no domain snapshot in `localStorage`.
- Generated contracts, labels, aria state, and CSS transitions agree.
- Light-first paint, advanced-brown accent, no glass CSS, Phosphor icons.
- Production build is tested, including Vite's relative asset base and preload
  output.

## Avoid

- No snapshot-only UI tests that miss keyboard and data-flow behavior.
- No exact-pixel assertions tied to one DPI scale.
- No disabled button that hides a save or engine error.
- No animation implemented by unmounting the animated subtree.
- No broad `eslint-disable` or TypeScript suppression in production code.
- No new `lucide-react` or `backdrop-filter` in the renderer.
