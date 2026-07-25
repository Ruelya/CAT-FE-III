# WP4 Suggestions header and result hierarchy evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer.

## Delivered behavior

- The Suggestions header now has one warm-ink title surface with a single
  clipped terminal (`clip-path: polygon(...)`), a separate theme-aware dot
  field, and a stable header-tools group. The title block owns no click target
  in the clipped area.
- Maximize and collapse remain separate, named icon controls. Collapse is the
  single stateful rail transition control (`data-suggestion-collapse="true"`);
  the collapsed content stays mounted, becomes `inert`/`aria-hidden`, and the
  visible rail receives focus. Expanding returns focus to the content collapse
  control.
- Tabs remain on their own row. Match, term, QA, and Assistant content keeps
  source/target or issue evidence ahead of provenance and actions; Assistant
  configuration remains inside the Assistant tab.
- Dot fields use `var(--ink)` so light and dark themes do not retain a hard-coded
  light-palette color.

## Focused verification

```text
pnpm exec prettier --check apps/desktop/src/renderer/Workbench.tsx \
  apps/desktop/src/renderer/styles.css \
  apps/desktop/tests/e2e/workbench.spec.ts                         pass
pnpm --filter @translunar/desktop typecheck                       pass
pnpm lint                                                         pass
pnpm --filter @translunar/desktop build                           pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "keeps panel motion, geometry, and Windows rendering coherent"   pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts -g \
  "applies the workbench visual polish in light and dark themes"    pass
```

The focused geometry test verifies intermediate and final collapse/expand
widths, maximize/restore boundaries, focus handoff, all three supported
viewports, the compact Assistant transcript, and no renderer console errors.
Its rendering evidence asserts the polygon cut, title/dot/tool non-overlap,
single collapse marker, and panel containment. The light/dark visual-polish
test additionally verifies contrast, reduced-motion behavior, and focus-ring
behavior.

## Visual evidence

| Surface | 1250x744 | 1680x942 | 1920x1080 |
| --- | --- | --- | --- |
| Default/docked | `screenshots/wp4-suggestions-default-1250x744.png` | `screenshots/wp4-suggestions-default-1680x942.png` | `screenshots/wp4-suggestions-default-1920x1080.png` |
| Collapsed rail | `screenshots/wp4-suggestions-collapsed-1250x744.png` | `screenshots/wp4-suggestions-collapsed-1680x942.png` | `screenshots/wp4-suggestions-collapsed-1920x1080.png` |
| Maximized | `screenshots/wp4-suggestions-maximized-1250x744.png` | `screenshots/wp4-suggestions-maximized-1680x942.png` | `screenshots/wp4-suggestions-maximized-1920x1080.png` |

Assistant compact and maximized captures are also stored as
`wp4-suggestions-assistant-1250x744.png` and
`wp4-suggestions-maximized-assistant-1920x1080.png`. The Terms and QA tabs use
the same header/tabs contract and their named empty-state captures from WP2;
the focused test switches through the same tablist while checking panel modes.

## Remaining scope boundary

Segment density, truthful non-PDF Preview structure, and mechanical radius /
spacing migration remain WP5–WP7 work packages; this package does not change
their data or virtualization contracts.
