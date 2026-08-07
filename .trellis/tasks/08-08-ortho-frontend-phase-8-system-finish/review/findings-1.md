# Findings round 1

## meta
- task: `.trellis/tasks/08-08-ortho-frontend-phase-8-system-finish`
- branch: `implement/ortho-frontend`
- head_sha: `c481782ce5ee2997462e1f2030bb2d5ce3c833f8` (working tree uncommitted Phase 8 changes)
- round: 1
- role: trellis-review
- focus: dual-theme dual-track closed; settings Surface; coach marks; draft recovery; screenshot PNG residual accepted

## need_verify
- required: false

### Verify mission
- none — dual-track closure is established by static evidence (no competing `.theme-dark` palette rules; single `data-theme` driver; unit tests + typecheck green). Runtime PNG matrix remains deferred residual per AC10/A5.

## issues

### F1
- severity: minor
- files: `apps/desktop/tests/e2e/workbench.spec.ts:3857`
- problem: E2E still asserts `.workbench-app` has class `theme-dark` after palette dual-track retirement. Product correctly dropped color dependency on `theme-*` classes; this assertion will fail when the suite runs and re-encodes the old dual-track contract.
- minimal_fix: Change expectation to resolved document theme, e.g. `await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")` (or assert both light→dark toggle via `data-theme`). Do not reintroduce `.theme-dark` class for colors.
- status: open

### F2
- severity: minor
- files: `apps/desktop/src/renderer/App.tsx:778-788` (`inspectDrafts`)
- problem: Draft recovery UI supports `currentTargetText` (wordDiff) and `unverified` (无法校验 badge + default off), but `inspectDrafts` only sets `stale` + optional `currentRevision`. Missing segment is treated as `stale` (not `unverified`); `current?.targetText` is never passed → §D8 wordDiff path is dead in production.
- minimal_fix: In `inspectDrafts` mapping: if `current` is missing after list (or list failed / no workspace), set `unverified: true` and `stale: false` (or keep restore-blocked via `canRestoreDraft`); when `current` exists, pass `currentTargetText: current.targetText` and `stale: current.revision !== record.expectedRevision`.
- status: open

### F3
- severity: nit
- files: `apps/desktop/src/renderer/ProductSettingsPage.tsx:395-397`, `:431-433`, `:463-464`
- problem: Appearance controls call both parent handlers (`onThemePreferenceChange` / `onDensityChange` / `onUiScaleChange`, which already apply controller + React state) and direct `setThemePreference` / `setDensityPreference` / `setUiScale` again. Harmless double persist/apply, slightly confusing ownership.
- minimal_fix: Keep only the `on*` props (or only the controller) so single write path matches App/Workbench.
- status: open

### F4
- severity: nit
- files: `apps/desktop/src/renderer/components/system/SurfaceStates.tsx` (unused imports); residual local `LoadingState` in `AssetCurationPanel.tsx` etc.
- problem: Shared three-state primitives exist but are not consumed; high-traffic surfaces use text/`role="status"` loading without `LoaderCircle`+`.spin` (AC7 spinner ban met). Documented residual in `09-implementation.md` §期8.
- minimal_fix: Optional later migrate `LoadingState` → `SurfaceLoading`; not required for Phase 8 closeout.
- status: open

### F5
- severity: nit
- files: `apps/desktop/src/renderer/styles.css:2850`, `:7428-7433`; residual decorative hex / PDF page paper white
- problem: A few non-token hex colors remain (PDF page canvas white, danger button white text / hover `#963326`). These are not a competing `.theme-dark` palette; dark shell/workbench still invert via aliases. Cosmetic residual only.
- minimal_fix: Map danger hover to `var(--err-ink)` / on-signal pattern when convenient; leave PDF paper intentional white if desired.
- status: open

## dual_track_verdict (AC8)

| Check | Result |
| --- | --- |
| Competing `.workbench-app.theme-dark` / `.theme-system` **palette** blocks | **None** — only comments in `styles.css` / `00-tokens.css` |
| Single driver | `theme-controller.ts` → `document.documentElement.dataset.theme` ∈ {light,dark}; preference light\|dark\|system |
| Legacy aliases | `:root` maps `--bg/--surface/--muted/--line/...` → ORTHO tokens once; dark recolor only under `:root[data-theme="dark"]` |
| Workbench class | `applicationClasses` no longer includes `theme-${preferences.theme}` for color |
| Three UIs same API | Settings Appearance, App palette/toggle, Workbench prefs select → `setThemePreference` / `onThemePreferenceChange` |
| `rg theme-dark` product CSS rules | No live selectors; e2e residual only (F1) |

**Conclusion:** Dual-theme dual-track is **closed** for practical dark surfaces. No fix required to re-open a second palette track.

## AC snapshot (static + unit)

| AC | Status | Notes |
| --- | --- | --- |
| AC1 Settings Surface §E3 | met | `role="region"`, vertical nav, Surface Slot mount, no `aria-modal` on settings |
| AC2 RPC preserve | met | existing `getShellSettings` / data dir / backup / update / allowlist invokes retained |
| AC3 Appearance live | met | theme / density / ui-scale wired via controllers + Appearance panel |
| AC4 Deep section | met | `settingsSection` + command palette appearance entry |
| AC5 Coach marks | met | `pointer-events: none` layer; popover only; Esc skip; no doc trap |
| AC6 Draft polish | mostly met | multi-select, defaults, clipboard, discard confirm, sequential restore; wordDiff/unverified wiring residual (F2) |
| AC7 Three-state / no spinner | met | `LoaderCircle` absent in renderer TSX; SurfaceStates residual unused (F4) |
| AC8 Dark single source | **met** | dual-track closed (table above) |
| AC9 forced-colors | met | global map in `01-reset.css`; lamps keep `forced-color-adjust: none` |
| AC10 density×zoom matrix | met | `evidence/screenshot-matrix.md` checklist; **PNG deferred accepted** |
| AC11 i18n en+zh | met | appearance / draft / coach keys present |
| AC12 typecheck + unit | met | vitest system 25 + tutorial 2 + WVS 2 green; `pnpm run typecheck` green |

## residuals accepted (no open blocker)

- Screenshot PNGs under `evidence/screenshots/` not produced (engine/capture unavailable) — per PRD A5 / orchestrator accept.
- Tutorial step enum remains 7-wide (presentation mapped).
- Shortcuts panel residual presets only.
- `components/system/settings/` extract folder empty; page still monolithic but functional.
- Dead CSS: `.shell-settings-fab { display: none }`, legacy `.settings-overlay` kept neutralized/unused for product settings.

## assumptions
- Phase validation does not require full Playwright suite green; F1 is test-debt not product dual-track failure.
- Expression-only boundary held: no contracts/preload/engine diffs in Phase 8 working tree.
- Orchestrator prefers closeout when theme + settings + coach + draft work with dual-track closed — residual F2 polish optional for a later micro-fix, not a quality-loop blocker.

## summary_for_orchestrator

Phase 8 system finish is **review-green**. Dual-theme dual-track is truly closed: no competing `.theme-dark` palette, legacy vars alias to ORTHO tokens under a single `data-theme` driver, Workbench no longer class-themes colors, and Appearance / App / Workbench share `theme-controller`. Settings is a Surface (not modal); coach marks are non-blocking; draft multi-select/bulk/clipboard work with unit coverage; forced-colors + density/scale wiring + matrix doc present; typecheck and system unit tests pass. Accept PNG matrix residual. Open issues are minor/nit only (stale e2e `theme-dark` assertion, draft wordDiff/`unverified` not wired from `inspectDrafts`, double-apply nit, unused SurfaceStates). **Recommend `ready_for_closeout`** without another fix/verify loop unless Orchestrator wants F1/F2 cleaned in a tiny optional pass before merge.

## summary_for_closeout_hint
- Record dual-track closure (already sketched in `docs/design-ii/09-implementation.md` §期8).
- Optional follow-ups: F1 e2e assert `data-theme`; F2 wire `currentTargetText`/`unverified` in `inspectDrafts`.
