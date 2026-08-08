# ORTHO live acceptance report

**Date:** 2026-08-08  
**Branch:** `implement/ortho-frontend`  
**Engine:** `target/debug/translunar-engine.exe` (built in-repo)  
**Desktop:** `pnpm run build` production renderer + electron main  

## Commands

```bash
cargo build -p translunar-engine
cd apps/desktop && pnpm run build
pnpm exec playwright test tests/e2e/ortho-acceptance.spec.ts
```

## Results

| Gate | Result |
| --- | --- |
| Engine binary present | **PASS** |
| ORTHO acceptance Playwright | **2/2 PASS** (~27s) |
| Band spine = 1 | **PASS** |
| No `.theme-dark` dual-track class | **PASS** |
| `[data-axis=active]` ≤ 1 | **PASS** (count=1 on active row) |
| Masthead / FilterRail / Matrix / Segment grid / Stack present | **PASS** |
| Command palette (Ctrl+K) | **PASS** |
| Console hard errors | **PASS** (none) |
| axe serious (sans color-contrast) | **1 residual:** `scrollable-region-focusable` |
| Layout regression found & fixed | **PASS** after fix (see below) |
| Unit suite (prior) | **283/283** |
| Typecheck | **PASS** |

## Critical fix during acceptance

**Bug:** `.masthead`, `.filter`, and `.segment-grid.grid` carried `grid-area: masthead|filter|grid` intended for the unused `.wb` host. On legacy `.workbench-app` (2-row grid), named areas auto-placed the masthead to the bottom and collapsed the segment grid (blank canvas).

**Fix:** scope `grid-area` under `.wb` only; size `.workbench-app` row 1 with `--masthead-h`. Files: `styles/30-surfaces/workbench.css`, `styles.css`.

## Screenshots

Directory: `docs/design-ii/reference/impl-acceptance/`

| File | Content |
| --- | --- |
| `01-home-or-shell.png` | Project home 35/65 + Index Spine + Band |
| `02-theme-dark-home.png` | Home dark via `data-theme` |
| `04-command-palette.png` | Ctrl+K palette |
| `05-workbench-1250x744.png` | Full workbench after layout fix |
| `06-workbench-1680x942.png` | Mid viewport |
| `07-workbench-1920x1080.png` | Full HD |
| `08-density-*-scale-*.png` | 3×3 density × UI scale matrix |
| `09-workbench-dark.png` | Workbench dark theme |
| `acceptance-report.json` | Machine-readable checks |

## Visual notes (from screenshots)

- **Home:** OK — composition rail, tabs, empty state, New project CTA.
- **Workbench:** OK after fix — Masthead top, FilterRail, Live Matrix, segment rows, Stack (Matches+Terms), Preview dock, Instrument strip, Active Axis on row 1.
- **Dark:** OK — strata inversion via `data-theme=dark` only.
- **Tag capsules:** source shows numbered protected-tag chips (fixture tags); acceptable for CAT fidelity.
- **Density matrix shots:** attributes applied; visual delta may be subtle at 3 segments — matrix checklist still valid for larger docs.

## Legacy e2e debt (not blocking visual acceptance)

`workbench.spec.ts` still expects some pre-ORTHO chrome (`.save-indicator`, tabbed Matches/QA as old stack, etc.). `importFixture` updated for `role=grid` and `.seg-row`. Full workflow suite needs a follow-up selector pass; core visual path is covered by `ortho-acceptance.spec.ts`.

## Verdict

**CONDITIONAL PASS for ORTHO 0–8 live acceptance** after layout hotfix.

- Product shell + workbench chrome render correctly with real Engine.
- Dual-theme track closed in live DOM.
- Structural gates green; one axe residual remaining.
- Commit layout fix + acceptance artifacts before treating release-ready.
