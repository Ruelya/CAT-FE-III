# Density × UI scale screenshot matrix (Phase 8)

**Status:** checklist deliverable — live Electron/engine capture deferred (no automated capture farm in implement session).

**How to capture later:** open Settings → Appearance, set density + UI scale, then screenshot Workbench (segment grid + stack + masthead) at 1250×744.

## Pass criteria (all cells)

| Criterion | Rule |
| --- | --- |
| No clip | Filter rail, masthead, instrument strip fully visible at cell zoom |
| Hit targets | Interactive controls ≥ 28px effective at compact |
| Density ≠ font | Font size changes only with UI scale, not density alone |
| Scale ≠ editor zoom | Changing UI scale leaves `--editor-zoom` unchanged |
| Stack | At 160% stack remains usable (scroll ok; no permanent overflow hide of primary actions) |
| Dark | With `data-theme=dark` only (no `.theme-dark` class), shell + workbench invert |

## Matrix

| Density \ Zoom | 100% (`--ui-scale: 1`) | 125% (`1.25`) | 160% (`1.6`) |
| --- | --- | --- | --- |
| **compact** (`data-density=compact`) | deferred — no engine capture | deferred | deferred |
| **standard** (default / no attr) | deferred | deferred | deferred |
| **comfortable** (`data-density=comfortable`) | deferred | deferred | deferred |

## Manual smoke (implementer)

- [x] Theme preference light/dark/system → single `documentElement.dataset.theme`
- [x] Density + UI scale apply on `:root` immediately from Settings Appearance
- [x] Settings Surface vertical §E3 nav (not modal)
- [x] Coach marks: no full-screen blocking scrim; Esc skips
- [x] Draft recovery multi-select + clipboard join helper unit-tested
- [x] `LoaderCircle` + `.spin` absent from renderer TSX
- [x] Global `@media (forced-colors: active)` in `01-reset.css`
- [x] Unit: theme-controller, appearance-controller, draft-recovery-presenters
- [x] `pnpm run typecheck` (desktop) green

## Forced-colors expected (Windows HC Black / White)

| Element | Expected |
| --- | --- |
| Paper / deck / frame | System `Canvas` |
| Text | `CanvasText` / `GrayText` for muted |
| Signal / Active Axis | `Highlight` |
| Elev shadows | none |
| Segment lamps | `forced-color-adjust: none` — shape encoding kept |

## Residual

- PNG files under `evidence/screenshots/` not produced (engine/UI capture unavailable in agent session).
- Tutorial step enum remains 7-wide (welcome…complete); coach-mark anchors map existing `tutorial-target-*` ids.
- Shortcut editor is residual preset list only.
- Discussion/alignment/task busy buttons show text labels without spinners; some whitespace-only status rows remain presentationally thin but non-spinning.
