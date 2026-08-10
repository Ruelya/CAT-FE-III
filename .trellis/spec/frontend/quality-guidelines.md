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

### Static appearance / icon audit (P0–P4)

These searches must produce no renderer matches for forbidden materials/icons:

```text
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
```

Appearance preference is the versioned renderer key
`translunar.renderer.appearance.v1` (`state/appearance.ts`) with theme +
`accentSeed` only. Defaults remain light and advanced-brown `#765847`. Do not
store theme/accent in `ProductShellSettings`. Semantic success/warning/error
tokens stay theme-fixed and independent of the custom accent seed. CSS tokens
and pure derivation helpers remain the only operational color source.

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
- Appearance/tokens: light + advanced brown defaults, dark/custom seed, total
  parse fallback, contrast/semantic independence, forbidden glass CSS
  (`state/appearance.test.ts`)
- Recovery dialog keyboard: initial focus, trap, non-destructive Escape
- P1 pure helpers: document aggregate/post-delete route, template definition
  merge, search hit classify, analytics availability formatting
- P1 integration (`App.p1.integration.test.tsx`): batch import cancel/mixed,
  document switch save-before, templates, recycle restore/purge, search nav,
  insights, example, archive/update, stale feature-op guards
- P4 pure helpers: schema merge, external connector builder, restore decoder,
  update command matrix, P4 route context (`ai-view`, `external-connector-request`,
  `product-settings-view`, `p4-route-context`, collab/plugin view tests)
- P4 controllers/surfaces: generation-scoped ops, secret lifecycle, panel
  revoke, runnable-profile honesty, offset paging (see
  [ai-plugins-settings.md](./ai-plugins-settings.md))

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

Desktop E2E (P2 editor + assets) must exercise real-Engine editor mutation path
and Asset Hub navigation across all six sections with return to Workbench.
Prefer `tests/e2e/p2-editor-assets.spec.ts`. Keep P0/P1 specs green.
Catalog/curation may remain presence-level in E2E when controller unit tests
own exact RPC params and rollback boolean contracts — see
[editor-assets.md](./editor-assets.md) residual notes.

Desktop E2E (P3 interop/PDF) and (P4 AI/plugins/settings) use real Engine with
always-on reachability plus **explicit fixture-gated skips** only when named
env fixtures are absent. Prefer `tests/e2e/p3-interop-pdf.spec.ts` and
`tests/e2e/p4-ai-plugins-settings.spec.ts`. P4 always-on covers chrome
reachability, local collab when a project exists, appearance persistence
across relaunch, locale/settings non-destructive paths, and console-error
absence. Deep AI/plugin/connector paths may skip with
`TRANSLUNAR_P4_LOOPBACK_AI`, `TRANSLUNAR_P4_PLUGIN_FIXTURE`, or
`TRANSLUNAR_P4_CONNECTOR_FIXTURE` — see
[ai-plugins-settings.md](./ai-plugins-settings.md).

### P2 unit / integration expectations

- Pure `editor-operations`: mutation apply modes, merge adjacency, shortcut
  acceptance/suppression (IME 229, inactive Workbench, unregistered chords).
- `use-editor-operations`: flush-before-mutate, stale op ignore, independent
  history read token, replace preview no-write.
- `use-asset-controller`: per-domain tokens, snapshot-before-pending search/
  paging, curation rollback success/failure/duplicate/missing snapshot.
- Extend `test/fake-desktop-api.ts` with typed defaults for every P2 method
  exercised; do not stringly-type method names in fakes.

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
| `nav-ai-control` | Chrome AI Control (P4) |
| `nav-plugins` | Chrome Plugins (P4) |
| `nav-collaboration` | Chrome Collaboration (project-gated, P4) |
| `nav-settings` | Chrome Settings (P4) |

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
  Workbench (including Search, Insights, Assets, document switch, active-
  document recycle).
- Session is identity-only; no domain snapshot in `localStorage`.
- Generated contracts, labels, aria state, and CSS transitions agree.
- Light-first paint, advanced-brown accent, no glass CSS, Phosphor icons.
- Production build is tested, including Vite's relative asset base and preload
  output.
- Editor keyboard chords are renderer-owned; main does not swallow Ctrl/Cmd+F/K.
- Asset Hub shows no placeholder sections; TM/TB import is omitted without a
  trusted dialog filter rather than faking a path.

## Avoid

- No snapshot-only UI tests that miss keyboard and data-flow behavior.
- No exact-pixel assertions tied to one DPI scale.
- No disabled button that hides a save or engine error.
- No animation implemented by unmounting the animated subtree.
- No broad `eslint-disable` or TypeScript suppression in production code.
- No new `lucide-react` or `backdrop-filter` in the renderer.
