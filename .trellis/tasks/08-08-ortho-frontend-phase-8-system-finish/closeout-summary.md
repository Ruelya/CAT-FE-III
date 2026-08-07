# Closeout — ORTHO Phase 8 system and finish

**Task:** `.trellis/tasks/08-08-ortho-frontend-phase-8-system-finish`  
**Branch:** `implement/ortho-frontend`  
**Role:** trellis-closeout  
**Status:** ready for Orchestrator commit/merge (this worker does not commit)

## What shipped

Expression-only **Phase 8** completes the ORTHO frontend series (**phases 0–8**) on `implement/ortho-frontend`:

| Area | Delivery |
| --- | --- |
| Settings Surface | `ProductSettingsPage` as Shell Surface Slot plate (`role="region"`), §E3 vertical groups, deep `settingsSection`, no modal/FAB; Appearance panel for theme/density/scale |
| Theme single source | `theme-controller.ts`: `light\|dark\|system` → resolved `html[data-theme]`; dual-track `.theme-dark` palette retired; App + Workbench + Appearance share controller |
| Density × UI scale | `appearance-controller.ts`: `data-density` + `--ui-scale` (0.8–1.6); orthogonal to `--editor-zoom`; Ctrl+Alt+[ / ] cycle |
| Coach marks | `TutorialOverlay` anchored popover + signal ring; no full-screen scrim / document focus trap; tutorial reducer/persistence unchanged |
| Draft recovery | Multi-select, stale/unverified defaults, bulk discard confirm, multi-clipboard, sequential restore; `inspectDrafts` wires `currentTargetText` + `unverified` (F2) |
| Three-state | `SurfaceStates` primitives; renderer TSX free of `LoaderCircle`+`.spin` |
| Forced-colors | Global map in `01-reset.css`; lamps keep shape encoding |
| Evidence | `evidence/screenshot-matrix.md` (+ design-ii reference); PNG capture deferred accepted |
| i18n | en + zh for settings groups, appearance, draft bulk, coach chrome |
| Micro-fix | **F1** E2E asserts `html[data-theme]` (not `.theme-dark` class); **F2** draft inspect mapping for wordDiff / 无法校验 |

**Validation (review round 1 + fixes):** desktop typecheck green; system unit tests (theme/appearance/draft presenters) + tutorial/WVS green; dual-track closed by static evidence.

## Specs touched (this closeout)

| Path | Change |
| --- | --- |
| `.trellis/spec/frontend/electron-workbench.md` | New **ORTHO System and Finish (Phase 8)** executable contract (7 sections) |
| `.trellis/spec/frontend/component-guidelines.md` | Phase 8 system extracts table + contract link |
| `.trellis/spec/frontend/directory-structure.md` | `components/system/`, `settings.css`, stable roots, dual-track ban note |
| `.trellis/spec/frontend/state-management.md` | localStorage appearance keys + single DOM apply path |
| `.trellis/spec/frontend/quality-guidelines.md` | Phase 8 unit/E2E theme assert + spinner ban + matrix residual |

Design log already records dual-track closure in `docs/design-ii/09-implementation.md` §期8 (implement-era note).

## Suggested commit message

**Subject:**

```text
feat(ui): ORTHO Phase 8 system finish — settings, theme, coach, drafts (0–8 complete)
```

**Body:**

```text
Complete ORTHO frontend Phase 8 on implement/ortho-frontend and close the
expression series (phases 0–8).

- Settings as Surface (§E3 nav, Appearance theme/density/scale, deep sections)
- theme-controller single data-theme source; retire dual-track class palettes
- appearance-controller for density × --ui-scale (orthogonal to editor zoom)
- Coach marks tutorial (no blocking scrim); draft multi-select/clipboard/bulk
- SurfaceStates + spinner sweep; global forced-colors; density×zoom matrix doc
- F1/F2: E2E html[data-theme]; inspectDrafts unverified + currentTargetText
- Spec: electron-workbench Phase 8 contract + frontend guidelines updates

Expression-only: no contracts/engine/preload changes.
```

## Residual risks / follow-ups (non-blocking)

| Item | Severity | Notes |
| --- | --- | --- |
| Density×zoom PNG screenshots | residual | Checklist + pass criteria present; capture when engine farm available |
| Tutorial step enum 7-wide vs design 5 steps | residual | Presentation mapped; reducer stable by design |
| Shortcuts panel | residual | Preset-only; no keymap store |
| SurfaceStates not fully adopted at every busy site | nit (F4) | AC7 spinner ban met; optional migrate later |
| Appearance double-apply via props + direct controller (F3) | nit | Harmless; prefer single write path cleanup |
| Cosmetic hex in `styles.css` (PDF paper, danger hover) (F5) | nit | Not a second palette track |
| Global search consolidation | out of scope | system.md residual |
| Full Playwright suite not re-run in closeout | process | F1 fixed statically; Orchestrator may run e2e before merge if desired |

## Explicit non-actions

- Did **not** archive the task (Orchestrator / finish-work policy).
- Did **not** commit or merge.
- Did **not** implement new product features beyond recording F1/F2 already present in the working tree.
