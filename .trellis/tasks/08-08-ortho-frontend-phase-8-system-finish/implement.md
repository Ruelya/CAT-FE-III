# Implement — Phase 8 system and finish

## Branch

`implement/ortho-frontend` (task.branch). Do not merge master/main from this worker.

## Ordered checklist

### 0. Prep

- [ ] Confirm branch `implement/ortho-frontend` and Phases 0–7 shell/surfaces exist.
- [ ] Read `docs/design-ii/screens/system.md`, `05-components.md` A4/A5/D5/D6/E3/F2/F5, `08-accessibility.md` §§4–6, `02-foundations.md` density/theme tokens, `09-implementation.md` §期8 + Phase 1 dual-track note.
- [ ] Inventory invokes in `ProductSettingsPage` — **do not change method names/core payloads**.
- [ ] Inventory theme: `App.tsx` `THEME_KEY`, `Workbench` `preferences.theme`, `styles.css` `.theme-dark`, `00-tokens.css` `:root[data-theme]`.
- [ ] `rg "LoaderCircle" apps/desktop/src/renderer` — baseline spinner list for R4.
- [ ] Note tutorial targets via `tutorialTargetId` and DOM ids in home/workbench.

### 1. Theme controller + dual-track close (R5) — do early

- [ ] Add `components/system/theme-controller.ts`: prefer `light|dark|system`, resolve, apply `document.documentElement.dataset.theme`, persist localStorage (compatible with existing key if possible).
- [ ] Unit tests: system resolution mock matchMedia; apply/remove.
- [ ] Wire `App.tsx` read/write through controller (toggle cycles light/dark or includes system per UX).
- [ ] Wire Workbench theme `<select>` to same controller; **remove** color dependency on `theme-${preferences.theme}` class (drop class or leave harmless).
- [ ] In `00-tokens.css` (or small aliases file): map legacy `--bg/--surface/--ink/--muted/--line/...` → ORTHO tokens for both light and dark so remaining `styles.css` rules invert.
- [ ] Delete or empty `.workbench-app.theme-dark` / `.theme-system` color blocks in `styles.css` once aliases work; remove `.workbench-visual-state` dark special-case if redundant.
- [ ] Verify: set `data-theme=dark` alone darkens shell + workbench content without `.theme-dark`.

### 2. Density + ui-scale controller (R7 partial)

- [ ] Add local preference helpers for `density` and `uiScale` (localStorage).
- [ ] Apply `dataset.density` and `--ui-scale` on `documentElement` at startup + on change.
- [ ] Ensure `01-reset.css` `html { font-size: calc(16px * var(--ui-scale)) }` remains authoritative.
- [ ] Do **not** couple to Workbench `--editor-zoom`.
- [ ] Unit tests for clamp 0.8–1.6 and density enum.

### 3. Settings Surface + vertical tabs (R1)

- [ ] Add `styles/30-surfaces/settings.css`; import in `styles/index.css`.
- [ ] Add `settings-presenters.ts`: section ids, groups, labels keys.
- [ ] Refactor `ProductSettingsPage` to grid: §E3 nav + main; extract panels (appearance/locale/data/backup/updates/engines/tutorial/about).
- [ ] **Appearance panel**: theme segmented control, density segmented, scale slider+number, live preview row, help lines; optional reduce-motion residual.
- [ ] Remove modal overlay / `aria-modal` / focus-trap-as-app-modal; use surface region semantics; Esc closes via App.
- [ ] `App.tsx`: mount settings in Surface Slot (preferred) or full-bleed non-modal layer; pass `section` + `onSectionChange`; call `flushBeforeLeave` when opening from workbench if appropriate.
- [ ] Command palette / spine gear: support open with section (shortcuts residual).
- [ ] Keyboard: document `Ctrl+Alt+,` open settings if free.
- [ ] Neutralize `.shell-settings-fab` and obsolete modal-only rules in `product-shell.css`.
- [ ] Preserve all RPC paths (locale, data dir, backup, restore, updates, allowlist, tutorial restart, example).
- [ ] i18n en+zh for group titles and appearance strings.

### 4. Coach marks tutorial (R2)

- [ ] Restyle/rewrite `TutorialOverlay` presentation: anchored popover, signal ring, step `n/N` + progress, no full-screen blocking scrim.
- [ ] Prefer CSS anchor; fallback fixed position from target `getBoundingClientRect` + flip.
- [ ] Remove document-level focus trap that blocks app use; Esc still skips.
- [ ] Ensure target ids exist on ORTHO controls (create, doc switcher, editor, stack, matrix) — add `id=` only where missing.
- [ ] Map copy to existing steps if enum unchanged; document residual vs design 5-step table in task notes.
- [ ] Keep `tutorial-state.ts` reducer tests green; no persistence break.
- [ ] i18n coach strings if new keys needed.

### 5. Draft recovery polish (R3)

- [ ] Add `draft-recovery-presenters.ts`: default selection (stale off), join clipboard text, optional wordDiff pairing helpers — tests.
- [ ] Multi-select UI; bulk footer actions; discard-all → confirm (§F2 small dialog or `window.confirm` only if no shared Confirm yet — prefer in-dialog confirm step).
- [ ] Stale: badge + draft vs current + `wordDiff` when current text provided.
- [ ] App: pass current target map if cheap from workspace segments; sequential restore selected; multi clipboard.
- [ ] Engine-missing revision: unverified label, default unchecked.
- [ ] Restyle to §A5 lg dialog tokens (settings.css or system.css); stop reusing settings-overlay if confusing.

### 6. Three-state unify (R4)

- [ ] Add/extend shared `SurfaceLoading` / `SurfaceEmpty` / `SurfaceError` (or expand `WorkbenchVisualState` with `error` kind + delay).
- [ ] Migrate high-traffic spinner call sites (ProjectHome, SetupView, AssetCuration, Alignment, Discussion, Interop, TaskPackage, AnalysisPanel, Insights busy rows, …) to skeleton/status.
- [ ] `rg` clean for `LoaderCircle` + `spin`; list any residual in implement notes.
- [ ] Align empty copy with §D6 (no “暂无数据”); error copy with §F5 data-safety line where replacing banners.
- [ ] CSS for shared states under layered styles; remove spin keyframes dependency where unused.

### 7. Forced-colors (R6)

- [ ] Global `@media (forced-colors: active)` in tokens/reset: system color maps, kill elev shadows, decorative hide rules per design.
- [ ] Confirm lamps keep `forced-color-adjust: none`.
- [ ] Quick sanity in devtools forced-colors emulation if available.

### 8. Screenshot matrix + evidence (R7)

- [ ] Create `.trellis/tasks/08-08-ortho-frontend-phase-8-system-finish/evidence/screenshot-matrix.md` with 3×3 density × zoom checklist and pass criteria (layout no clip at 125%; stack behavior at 160% per a11y doc).
- [ ] Capture PNGs if Electron/engine available; else mark each cell **deferred** with reason — still complete the doc.

### 9. i18n + a11y + cleanup

- [ ] en+zh for all new strings.
- [ ] Settings nav ARIA (`aria-current`, tablist/tab or navigation+links pattern).
- [ ] Coach mark `role="dialog"` or `region` with `aria-labelledby`; focus optional first control without trapping whole app.
- [ ] Draft dialog focus trap **kept** (blocking scene).
- [ ] Run validation commands; manual AC walkthrough; list residuals.

## Validation commands

```bash
# From repo root
cd apps/desktop

# System helpers
pnpm exec vitest run src/renderer/components/system --passWithNoTests
pnpm exec vitest run src/renderer/tutorial-state --passWithNoTests
pnpm exec vitest run src/renderer/WorkbenchVisualState --passWithNoTests
pnpm exec vitest run src/renderer/DraftRecoveryDialog --passWithNoTests

# Broader renderer if time
pnpm exec vitest run src/renderer --passWithNoTests

# Typecheck
pnpm run typecheck

# Spinner debt (expect 0 or residual list)
rg -n "LoaderCircle" src/renderer -g '*.tsx' || true
rg -n "theme-dark" src/renderer -g '*.{css,tsx,ts}' || true
```

Manual:

1. Open settings from spine gear: vertical groups; switch appearance theme/density/scale — whole app (not only shell) updates; close Esc; reopen deep section.
2. Toggle dark via command palette and workbench prefs — single result; no need for `.theme-dark` class.
3. First-run / restart tutorial: coach marks anchor; can click UI; Esc skips; restart from settings.
4. Seed draft journal → recovery dialog: select, copy clipboard, restore non-stale, stale default off, discard all confirm.
5. Force busy states on home/setup: skeletons not spinners.
6. DevTools forced-colors: text/background readable; lamps shaped.
7. Fill screenshot matrix doc.

## Risk points

| Point | Watch |
| --- | --- |
| Dual-track alias incompleteness | Grep hex colors in workbench path after dark toggle |
| Settings mount steals leave-guard | Flush drafts when opening settings from workbench |
| Tutorial step enum vs design 5 steps | Presentation map; don’t break persisted step strings |
| Draft multi restore revision conflicts | Per-row failure UI; don’t claim full success |
| Focus trap regression | Settings/tutorial must not trap whole app; draft should |
| ui-scale vs editor zoom | Separate vars; don’t reset editor zoom on UI scale |
| styles.css specificity | Prefer token aliases over fighting without @layer |
| Spinner sweep scope creep | Prioritize user-visible primary busy; residual OK if listed |

## Done definition

All AC1–AC12 met or residual explicitly listed in task notes; dual-track closed for practical dark surfaces; typecheck + relevant unit tests green; `evidence/screenshot-matrix.md` present; expression-only (no contracts/engine/preload diffs).
