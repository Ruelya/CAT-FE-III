# WP7 design-token convergence evidence

Measured 2026-07-26 on the Windows Electron lane from the shared Workbench
renderer.

## Delivered migration

- Added `--radius-input: 4px`, `--radius-button: 6px`, and
  `--radius-panel: 8px` as the rectangular radius tiers.
- Added `--space-1` through `--space-6` for the 4/8/12/16/24/32px spacing
  scale.
- Migrated rectangular radii across `styles.css`, then reviewed Workbench
  inputs/tags, command buttons, popovers, panels, and contained result cards
  against their semantic tier.
- Migrated the app bar, editor toolbar, segment table/tools, loading and empty
  states, Suggestions, Assistant, Preview, and professional editor overlays to
  the spacing scale where the value represents layout spacing.
- Raised task-owned Workbench metadata to an 11px floor. Source and target
  content remain 14px or larger and no type was reduced to avoid wrapping.

Off-scale values retained in those groups are control geometry, border width,
the Suggestions cut-terminal dimensions, scrollbar geometry, optical
alignment, or animation distance. Raw `0`, `1px`, and `50%` radii remain only
for square indicators/registration marks and true circles.

## Audits and focused verification

```text
rg -n "border-radius:\s*(3|5|7|9)px" styles.css             0 matches
task-owned Workbench sub-11px selector audit                 0 matches
whole-stylesheet sub-11px audit                              118 matches
WOFF2 payload                                                7,963,684 bytes
pnpm exec prettier --check <focused files>                   pass
pnpm --filter @translunar/desktop typecheck                  pass
pnpm build:desktop                                           pass
pnpm --filter @translunar/desktop exec playwright test \
  tests/e2e/workbench.spec.ts --grep \
  "keeps active segment actions|keeps panel motion|\
   keeps non-PDF Preview|applies the workbench visual polish" \
  --workers=1                                                4 passed
```

The 118 remaining small-type declarations belong to Setup, QA/review,
Insights, asset curation, collaboration, and product-shell surfaces outside
the PRD's bounded Workbench groups. They remain visible in the WP8 global
audit and are not presented as migrated.

The focused E2E verifies 125% editor density and IME behavior, panel geometry,
truthful Preview navigation and mounted/inert collapse behavior, light/dark
contrast, reduced motion, focus treatment, clean renderer logs, and supported
viewport boundaries.

## Visual evidence

| Theme | 1250x744 | 1680x942 | 1920x1080 |
| --- | --- | --- | --- |
| Light | `screenshots/wp7-tokens-light-1250x744.png` | `screenshots/wp7-tokens-light-1680x942.png` | `screenshots/wp7-tokens-light-1920x1080.png` |
| Dark | `screenshots/wp7-tokens-dark-1250x744.png` | `screenshots/wp7-tokens-dark-1680x942.png` | `screenshots/wp7-tokens-dark-1920x1080.png` |

Workbench-owned content remains contained at all three widths. WP8 removed the
global Settings FAB from Workbench and secondary workspace surfaces and routed
Settings through their application menus. The refreshed matrix above shows no
fixed control covering the compact status bar.
