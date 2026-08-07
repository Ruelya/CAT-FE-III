# ORTHO Phase 8 — system and finish

## Goal

Deliver **expression-only** system-class UI from `docs/design-ii/09-implementation.md` §期8 and `docs/design-ii/screens/system.md`:

1. **Settings as Surface** — vertical §E3 tab list (not full-screen modal / not FAB).
2. **Coach Marks tutorial** — anchored popovers + signal ring; no full-screen scrim overlay.
3. **Draft recovery polish** — §A5 Dialog + multi-select, stale/diff, bulk discard confirm, **clipboard escape**.
4. **Three-state unify** — loading / empty / error patterns (§D5 / §D6 / §F5); ban circular spinners.
5. **Dark theme full track** — close Phase 1 dual-track gap (`:root[data-theme]` vs `.workbench-app.theme-dark`) with **one source of truth**.
6. **High-contrast / forced-colors** — global `@media (forced-colors: active)` rules per `08-accessibility.md`.
7. **Density + zoom token wiring** — `data-density` / `--ui-scale` live from settings; **document density × zoom screenshot matrix** (live capture optional if engine/UI unavailable).

Branch: `implement/ortho-frontend`. i18n: **en + zh**. No new IPC, contracts, engine methods, or npm deps. Preserve shell settings / draft journal / tutorial persistence APIs and pure-util contracts listed as stable in `09-implementation.md` §3.

## Context (done / do not redo)

| Phase | Delivered (leave alone except wiring) |
| --- | --- |
| 0–1 | Shell, tokens, Band/Index/Instrument, CommandPalette; **dark dual-track intentionally open** |
| 2–4 | Workbench grid/stack/preview, ActiveAxis, composition guard |
| 5–6 | Project / quality / assets surfaces |
| 7 | AI control, selection AI, consistency drawer, plugins G7 + host bar |

**Do not** rework engine backup/update/data-directory algorithms, draft journal protocol, tutorial reducer contract shape beyond presentation remapping, preload, or invent new shell settings persistence fields unless additive and renderer-local (localStorage / `documentElement` attrs).

## Current baseline (evidence)

| Area | Location | Today |
| --- | --- | --- |
| Settings | `ProductSettingsPage.tsx` (~742 LOC) | Full-screen **modal** (`.settings-overlay` + `aria-modal`); sections stacked (locale, data dir, backup, updates, allowlist, tutorial, about). **No** appearance group for theme/density/zoom. Gear entry via Index Spine + command palette opens `settingsOpen` boolean in `App.tsx`. |
| FAB remnant | `product-shell.css` `.shell-settings-fab` | CSS still present; Phase 1 removed FAB from shell chrome — neutralize residual CSS. |
| Tutorial | `TutorialOverlay.tsx` + `tutorial-state.ts` | Full-screen `.tutorial-overlay`; highlights targets via class + `aria-describedby`; flow steps `welcome/create/import/edit/qa/export/complete` (not design’s 5 coach marks). Focus trap active. |
| Draft recovery | `DraftRecoveryDialog.tsx` | Overlay dialog; per-row restore/copy/discard; stale disables restore; **no** multi-select, bulk restore/discard-all confirm, §D8 word diff, engine-disconnected “无法校验”. Clipboard path exists. |
| Three-state | `WorkbenchVisualState.tsx` | loading/empty + skeleton variants for workbench panels. Many surfaces still use ad-hoc `LoaderCircle` + `.spin` (ProjectHome, SetupView, AssetCuration, Alignment, Discussion, Interop, TaskPackage, AnalysisPanel, …) and raw `.surface-error` paragraphs without §F5 four-part structure. |
| Theme dual-track | `App.tsx` + `Workbench.tsx` + CSS | App sets `document.documentElement.dataset.theme` (`light`\|`dark`, localStorage). Workbench still adds `theme-${preferences.theme}` (`light`\|`dark`\|`system`) on `.workbench-app`. Legacy `styles.css` `.workbench-app.theme-dark` / `.theme-system` redefines **old** `--bg/--ink/...`. New tokens live under `:root[data-theme="dark"]` in `styles/00-tokens.css`. Shell follows tokens; legacy surface CSS does not. |
| Density / zoom | tokens + Workbench prefs | `--density` / `data-density` / `--ui-scale` defined in `00-tokens.css` + `01-reset.css`; **not wired** from product settings. Workbench has **editor** `preferences.zoom` (`--editor-zoom`) separate from UI scale. |
| Forced-colors | partial | Segment lamps + some workbench CSS have local `@media (forced-colors: active)`; no global system map per `08-accessibility.md` §6. |
| Global search | `GlobalSearchPanel` | Still exist as panel; system.md wants command palette + home search only — **out of this phase’s orchestrator scope** (residual). |

Stable contracts (must stay green):

- Shell: `getShellSettings` / `updateShellSettings`, data directory + backup + update + restore preview APIs already used by `ProductSettingsPage`
- Drafts: `clearDraftJournal`, draft journal load path in `App`, `segment.updateTarget` restore payload shape
- Tutorial: `tutorial-state.ts` reducer + `TutorialState` persistence shape (presentation may re-anchor; do not break skip/complete persistence)
- Utils: `useFocusTrap.ts`, `shell-error.ts`, `draft-persist.ts`, `session-utils.ts`, `i18n/*`
- No contracts/engine/preload changes

## Requirements

### R1 — Settings as Surface + vertical tab list

- **Remove modal framing**: no full-viewport scrim as the primary settings chrome; no `aria-modal` full-app dialog for product settings. Settings occupies the **Shell Surface Slot** (or equivalent full main column) as a plate layout.
- **§E3 vertical Tab List** (left ~180px `--frame` + structural seam): grouped nav
  - **应用**: 外观 · 语言与区域 · 快捷键（residual if no editable keymap store — honest empty + preset residual only）
  - **数据**: 数据目录 · 备份与恢复 · 更新
  - **引擎**: 引擎白名单（project-scoped; residual when no project）
  - **其他**: 教程与示例 · 关于与许可
- **Preserve all existing invoke/save paths** for locale, data dir migrate, backup, restore preview/confirm, update mode/check/install, engine allowlist (`project.update`), tutorial restart, open example.
- **Appearance tab (new presentation, renderer-local prefs)**:
  - Theme: 浅色 / 深色 / 跟随系统 → single driver for `documentElement` theme (see R5)
  - UI scale: 80–160% → `--ui-scale` on `:root` (or `html` style)
  - Density: compact / standard / comfortable → `documentElement.dataset.density`
  - Reduce motion override checkbox (app flag independent of OS) if already patterned or cheap localStorage; else residual
  - Non-printing chars residual if no existing workbench preference wire without engine
  - **Live preview row**: one sample segment-style row reflecting density + scale (static mock markup using tokens — not a real engine segment)
- Each control: **one-line consequence help** (i18n), not label-only.
- Immediate prefs (theme/density/scale/locale) apply without a Save bar; destructive ops keep existing confirm patterns (§F2 for migrate/restore).
- **Deep section**: support `settingsSection` id (e.g. `appearance` \| `locale` \| `data` \| `backup` \| `updates` \| `engines` \| `tutorial` \| `about` \| optional `shortcuts`) so command palette / “前往设置” can open a specific group. Persist last section in session memory only (optional).
- Entry: Index Spine gear + existing command palette action + keyboard `Ctrl+Alt+,` (document; workbench `Ctrl+,` remains editor prefs if already bound). **Do not** reintroduce FAB.
- Extract subcomponents under `components/system/` or `components/settings/` so the page is not a single mega-list; keep stable export `ProductSettingsPage` if imported elsewhere.
- CSS: `styles/30-surfaces/settings.css` (import in `styles/index.css`); neutralize `.settings-overlay` / dialog chrome when unused for product settings.

### R2 — Coach Marks tutorial

- Replace full-screen overlay presentation with **anchored coach marks**:
  - Popover deck plate §A4 geometry (CSS Anchor Positioning when available; `getBoundingClientRect` fallback)
  - Target gets 2px `--signal` highlight ring (`tutorial-target-active` restyle)
  - **No dimming scrim** that blocks the UI; optional non-target brightness dip to ~92% only if it does not trap pointer events
  - Content: one sentence + shortcut when known + `下一步` / `跳过教程`
  - Step indicator Mono `n / N` + 4px progress bar
- Tutorial **must not block** work: `aria-modal="false"`; no focus trap that prevents using the app (remove or narrow trap to the popover only without locking the document)
- Esc skips; skip/complete persistence via existing `onChange` / shell tutorial fields
- **Target map (expression)**: re-anchor to real ORTHO controls where IDs exist (`tutorial-target-*` or new stable ids on 新建项目 / 文档切换器 / 译文区 / Stack / Document Matrix). Prefer design’s five success-path steps when targets exist; if `tutorial-state.ts` step enum cannot change without shared-type churn, **map presentation copy/anchors onto existing steps** and document residual vs design’s exact 5-step table.
- **Do not** break `tutorialReducer` skip/complete semantics or persistence keys.
- Extract `CoachMark` / restyle `TutorialOverlay` in place; unit tests for reducer remain green.

### R3 — Draft recovery polish + clipboard escape

- Keep **blocking §A5 Dialog** (`lg` ~760px) — this remains one of the few required modal scenes.
- Presentation upgrades (logic stays on existing props + App handlers where possible):
  - Header brand plate + title + body explaining local draft journal
  - **Multi-select** checkboxes; non-stale default-on; **stale default-off** + `⚠已过时` + show current vs draft (prefer §D8 word diff via existing `wordDiff` when both strings available)
  - Footer: `[全部丢弃…]` (danger + §F2 confirm) · `[复制选中草稿到剪贴板]` · `[恢复选中的 n 段]`
  - Restore selected sequentially; failed rows remain with reason (App may need thin presentation state for partial failure — no new RPC)
  - Clipboard escape: multi-copy selected draft texts (joined) in addition to existing single-row copy
  - Engine disconnected / missing current revision: mark `无法校验`, default unchecked, no stale false-positive
- Preserve `onRestore` / `onDiscard` / `onCopy` / `onClose` contracts; extend props only additively if needed (`onRestoreMany`, `onDiscardAll`, `currentTargetBySegmentId` map from App if already loadable).
- Restyle off shared settings-dialog chrome into draft-recovery-specific classes under system CSS.

### R4 — Three-state unify

- Establish shared presentational primitives (extend `WorkbenchVisualState` and/or add `components/system/SurfaceStates.tsx`):
  - **Loading**: <300ms silent; ≥300ms skeleton same-shape; >3s optional meta line; **no** `LoaderCircle` + `.spin`
  - **Empty**: title + one how-to line + primary/secondary actions (§D6); ban “暂无数据” / mascot-only
  - **Error**: four-part §F5 block (what happened · data safety · recovery action · collapsible tech detail)
- Migrate **high-traffic call sites** that still spin: at minimum ProjectHome, SetupView, SegmentGrid/Workbench empty-loading paths already on `WorkbenchVisualState`, and any Phase 5–7 surface still using spinner as the primary busy affordance. Sweep remaining `LoaderCircle`+`.spin` in renderer; replace with skeleton/status text or deterministic progress already in product.
- Source scan acceptance: no new `LoaderCircle` + `className="spin"` pairs; prefer zero remaining in renderer TSX (allow residual only if listed with reason).
- CSS: move skeleton/empty/error tokens to layered styles; remove dual theme special-case for `.workbench-visual-state` once R5 lands.

### R5 — Dark theme single source of truth

- **Single driver**: `document.documentElement.dataset.theme` ∈ {`light`,`dark`} with optional `system` resolution (matchMedia `prefers-color-scheme`) performed in one place (App or small `theme-controller` helper).
- **Retire dual track**:
  - Stop relying on `.workbench-app.theme-dark` / `.theme-system` for color tokens
  - Map or delete legacy `--bg/--surface/--ink/...` so remaining `styles.css` rules consume **ORTHO tokens** (`--paper/--deck/--text-1/...`) or aliases defined once under `:root` / `:root[data-theme="dark"]`
  - Workbench preferences theme control must write the **same** controller (no second independent class theme)
- Appearance settings + App toggle + workbench theme select all call the same API (e.g. `setThemePreference('light'|'dark'|'system')`).
- Acceptance: with `data-theme="dark"`, shell **and** workbench grid/stack/legacy surfaces invert without requiring `.theme-dark` on `.workbench-app`.
- No temporary dual `@layer` bridge that re-opens specificity wars — prefer alias variables + class removal.

### R6 — High-contrast / forced-colors

- Global rules (tokens or `01-reset` / `02-primitives`):

```css
@media (forced-colors: active) {
  /* map critical tokens to system colors; kill elev shadows; hide pure decoration */
}
```

- Keep shape-encoding on status lamps (`forced-color-adjust: none` where already designed).
- Hide decorative Band/inert matrix only where design requires; do not remove interactive Matrix navigation.
- Smoke: document expected Windows High Contrast Black/White behavior in task evidence notes if OS capture unavailable.

### R7 — Density × zoom wiring + screenshot matrix

- Wire appearance controls → `html` attributes/CSS variables:
  - `data-density="compact"|"standard"|"comfortable"` (omit or `standard` for default)
  - `--ui-scale` from 0.8–1.6
- Density must not change font-size; scale must not be conflated with workbench **editor** zoom (`--editor-zoom` remains editor-local).
- Keyboard optional: `Ctrl+Alt+[` / `]` density cycle if cheap and non-conflicting.
- **Screenshot matrix artifact** (required deliverable even if live capture blocked):

  | | zoom 100% | 125% | 160% |
  | --- | --- | --- | --- |
  | compact | … | … | … |
  | standard | … | … | … |
  | comfortable | … | … | … |

  File: `{task}/evidence/screenshot-matrix.md` (+ optional PNGs under `evidence/screenshots/`). If engine/Electron capture is impossible in implement, fill the matrix as a **checklist with pass criteria** and note blockers — do not block phase on photos alone.

### R8 — Expression-only + API preservation

- No engine / contracts / preload / new IPC / new npm deps.
- Stable pure modules listed in `09-implementation.md` stay behavior-stable; additive presenters/helpers OK with tests.
- Forbidden: marketing kickers, circular spinners, permanent box-shadow on resident chrome, fake progress, inventing shortcut editor persistence without a store.

## Acceptance criteria

- [ ] **AC1** Settings opens as Surface-level page with §E3 vertical groups; not a full-app modal; no settings FAB.
- [ ] **AC2** All pre-existing settings capabilities (locale, data dir, backup/restore, updates, allowlist, tutorial restart, example project, about) still work with same DesktopApi methods.
- [ ] **AC3** Appearance: theme light/dark/system, density 3-way, UI scale control apply immediately and drive tokens.
- [ ] **AC4** Settings deep section open works from command palette / programmatic section id.
- [ ] **AC5** Tutorial uses anchored coach marks (no full-screen blocking overlay); Esc skips; state persists; app remains operable during tutorial.
- [ ] **AC6** Draft recovery: multi-select, stale default-off + warning, clipboard multi-copy escape, bulk discard confirm, sequential restore without inventing RPC.
- [ ] **AC7** Shared loading/empty/error patterns in place; primary surfaces no longer use `LoaderCircle`+`.spin` as busy UI.
- [ ] **AC8** Dark theme: single `data-theme` (resolved) source; `.workbench-app.theme-dark` not required for correct dark surfaces; App + Workbench prefs aligned.
- [ ] **AC9** Global `forced-colors` rules present; lamps keep shape encoding.
- [ ] **AC10** Density × zoom matrix documented under task `evidence/`; tokens live-wired.
- [ ] **AC11** en + zh strings for new chrome (settings groups, coach marks, draft bulk, three-state, appearance).
- [ ] **AC12** `pnpm run typecheck` (desktop) green; unit tests for theme controller / density presenters / draft selection helpers / tutorial reducer green.

## Out of scope

- Global search consolidation into command palette only (system.md §4) — residual unless free cleanup of dead search box already removed.
- Full editable keymap product (import/export/presets) if no existing store — residual panel only.
- Engine crash recovery protocol changes; new draft journal schema.
- Changing Band/Spine lamp count or adding Settings as 7th spine surface.
- Real OS screenshot automation farm / visual regression platform.
- Contracts, engine, preload, packaging.
- Re-doing Phases 2–7 surface layouts except token/theme/three-state consumption.

## Assumptions

| # | Assumption | Confidence |
| --- | --- | --- |
| A1 | Settings is Surface-level content in the Shell slot, **not** a 7th Index Spine lamp (gear tool entry). | high |
| A2 | Theme/density/ui-scale may live in localStorage / document attributes without extending `ProductShellSettings` IPC. | high |
| A3 | `tutorial-state.ts` step ids may keep enum; coach-mark copy/anchors remapped in presentation. Exact design 5-step table is best-effort. | medium |
| A4 | Draft multi-restore can loop existing `onRestore`/`segment.updateTarget` from App without new batch RPC. | high |
| A5 | Live density×zoom screenshot capture may be blocked without full engine; matrix doc satisfies AC10 when images missing. | high |
| A6 | Expression-only: no contracts package edits; shared `TutorialStep` changes only if strictly required and still renderer/shared product-shell additive. | high |
| A7 | Workbench editor zoom stays independent of UI `--ui-scale`. | high |

## Notes

- Spec sources: `docs/design-ii/screens/system.md`, `09-implementation.md` §期8 + Phase 1 dual-track note, `02-foundations.md` tokens, `05-components.md` A4/A5/D5/D6/E3/F2/F5, `08-accessibility.md` density/zoom/forced-colors.
- Closeout should record dual-track closure in implementation notes for future agents.
