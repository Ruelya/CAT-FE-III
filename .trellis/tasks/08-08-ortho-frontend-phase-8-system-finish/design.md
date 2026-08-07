# Design — Phase 8 system and finish

## Boundaries

| Layer | In | Out |
| --- | --- | --- |
| Renderer presentation | Settings Surface layout, coach marks, draft dialog chrome, three-state primitives, theme/density/scale controller, forced-colors CSS | Engine algorithms, new contracts, new IPC |
| App wiring | Settings open → surface slot; theme/density/scale attributes; draft multi handlers; tutorial mount | Session protocol changes |
| Utils | Additive: theme controller, settings section ids, draft selection helpers, three-state helpers + tests | Semantic changes to `tutorial-state` reducer, `draft-persist`, shell-error |
| CSS | `30-surfaces/settings.css`, system states, token aliases, forced-colors; retire dual theme classes | Temporary dual-track CSS bridge |
| IPC | Existing shell/settings/draft/update methods only | New preload fields |

## Current baseline (evidence)

- `App.tsx`: `settingsOpen` boolean mounts modal `ProductSettingsPage`; `dataset.theme` light|dark only; tutorial + draft overlays in `shellChrome`.
- `ProductSettingsPage.tsx`: modal dialog, stacked cards, full RPC graph for shell settings — **no** appearance token controls.
- `Workbench.tsx`: `className` includes `theme-${preferences.theme}`; editor zoom separate; can desync from `data-theme`.
- `styles.css`: `.workbench-app.theme-dark` / `.theme-system` redefine legacy palette vars.
- `styles/00-tokens.css`: authoritative ORTHO light/dark + density scales.
- `TutorialOverlay.tsx`: full-screen overlay + focus trap + target highlight class.
- `DraftRecoveryDialog.tsx`: single-row actions; copy exists; no bulk/select/diff.
- `WorkbenchVisualState.tsx`: loading/empty only; many panels still spin with Lucide `LoaderCircle`.
- Forced-colors: partial in workbench/lamps only.

## Target architecture

```text
App
├── themeController (light|dark|system → resolved data-theme)
├── density + ui-scale on documentElement
├── settingsOpen + settingsSection
│   └── ProductSettingsPage          # Surface layout (not modal)
│       └── components/system/settings/
│           ├── SettingsTabList      # §E3 groups
│           ├── AppearancePanel      # theme/density/scale/preview
│           ├── LocalePanel
│           ├── DataDirectoryPanel
│           ├── BackupPanel
│           ├── UpdatesPanel
│           ├── EnginesPanel
│           ├── TutorialAboutPanel
│           └── settings-presenters.ts
├── TutorialOverlay → CoachMarks     # anchored popovers
├── DraftRecoveryDialog              # multi-select polish
└── Shell Surface Slot
    └── (when settingsOpen) settings surface fills slot
        else existing home/workbench/pages

components/system/
  SurfaceLoading.tsx / SurfaceEmpty.tsx / SurfaceError.tsx
  (or extended WorkbenchVisualState)
  theme-controller.ts
  draft-recovery-presenters.ts
```

### Settings mounting strategy

**Preferred:** When `settingsOpen`, Shell’s surface slot renders `ProductSettingsPage` **instead of** (or above, full-bleed covering) the current surface content — **no scrim**, Escape/close returns previous surface. Index Spine gear remains entry; spine lamps stay on previous surface (or clear selection state) without adding a 7th lamp.

**Alternative (acceptable):** Settings as fixed full-area sibling under Shell main column with `position: absolute; inset: 0` over the slot, still without modal semantics (`role="region"` / `aria-labelledby`, not `aria-modal`).

Deep link: `setSettingsOpen(true, sectionId)`; TabList reads `section`.

### Theme single source of truth

```text
preference: light | dark | system   (localStorage key e.g. translunar.theme.v1 — extend value domain to include system)
        │
        ▼
resolve(system → matchMedia)
        │
        ▼
document.documentElement.dataset.theme = "light" | "dark"
        │
        ▼
:root[data-theme="dark"] { ORTHO tokens }
+ legacy alias block:
  --bg: var(--paper); --ink: var(--text-1); …  /* once, both themes */
```

Workbench: remove `theme-${preferences.theme}` class dependency for colors; theme control in editor prefs drawer calls `themeController.set` (same as Appearance + App toggle).

### Coach marks geometry

```css
.coach-mark {
  /* §A4: --deck, --r-pop, --elev-pop, 1px --rule-strong */
  position: fixed; /* or position: absolute + anchor() */
  z-index: /* popover layer */;
  max-inline-size: 20rem;
}
.tutorial-target-active {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}
/* NO .tutorial-overlay full-screen scrim that captures clicks */
```

Anchor order (presentation targets — map to existing step machine):

| Design step | Anchor intent | Existing id / residual |
| --- | --- | --- |
| 1 新建项目 | create CTA | `tutorial-target-create` |
| 2 文档切换 | masthead switcher | add id if missing |
| 3 译文单元格 | editor region | `tutorial-target-edit` or grid |
| 4 Stack 匹配 | stack panel | add id if missing |
| 5 Document Matrix | matrix | add id if missing |

If step enum stays 7-wide, show coach UI for steps that have targets; complete/skip still via reducer.

### Draft recovery layout

```text
Dialog lg
├── Brand plate title
├── Body + count
├── List
│   └── [☐] seg · file · time · [stale?]
│         draft text
│         current text + wordDiff if stale
└── Footer: discard-all… | copy selected | restore n
```

Selection state local to dialog; callbacks may stay per-item (dialog loops) or additive batch props from App.

### Three-state

| Kind | Component | Notes |
| --- | --- | --- |
| loading | skeleton plate | delay show 300ms via CSS animation or hook |
| empty | title + body + actions | variants: first-run / filtered / precondition |
| error | §F5 four slots | `SurfaceError` with optional `<details>` tech |

Deprecate inline `LoadingState`/`EmptyState` duplicates in panels by importing shared.

### Forced-colors

Centralize in `styles/01-reset.css` or `00-tokens.css` end:

- Map `--text-1` → `CanvasText`, `--paper`/`--deck` → `Canvas`, `--signal` → `Highlight` (or `LinkText` if Highlight poor)
- `* { box-shadow: none }` under forced-colors
- Lamps/matrix dots: `forced-color-adjust: none` where shape must survive

## Data flow

### Settings appearance → DOM

```text
user toggles density
  → setLocalPreference('density', 'compact')
  → document.documentElement.dataset.density = 'compact'
  → :root[data-density=compact] { --density: .85 }
  → --row-min / --cell-pad / --ctl-h recompute
```

### Draft restore selected

```text
user checks rows → Restore n
  for draft of selected:
    try onRestore(draft)  // existing updateTarget + clear journal
    on fail: mark row error, continue
  refresh workspace once at end if any success
```

### Theme from three UIs

```text
AppearancePanel | App command toggle | Workbench prefs select
        └──────────► themeController.set(pref)
                           ├─ persist localStorage
                           └─ apply resolved data-theme
```

## File plan

```text
apps/desktop/src/renderer/
  App.tsx                          # settings slot mount; theme/density/scale; draft multi glue
  ProductSettingsPage.tsx          # orchestrator slim
  TutorialOverlay.tsx              # coach marks presentation
  DraftRecoveryDialog.tsx          # multi-select polish
  Workbench.tsx                    # drop theme-* color class; wire themeController
  WorkbenchVisualState.tsx         # optional extend error kind
  components/system/
    theme-controller.ts
    theme-controller.test.ts
    settings-presenters.ts
    draft-recovery-presenters.ts
    draft-recovery-presenters.test.ts
    SurfaceError.tsx / SurfaceEmpty.tsx / …
    CoachMark.tsx                  # optional extract
    settings/*                     # panels
  styles/30-surfaces/settings.css
  styles/00-tokens.css             # legacy aliases if needed
  styles/01-reset.css              # forced-colors + ensure ui-scale
  styles/index.css                 # import settings.css
  product-shell.css                # neutralize fab / old overlay if unused
  i18n/messages.ts
  styles.css                       # remove or gut .theme-dark color blocks

.trellis/tasks/.../evidence/
  screenshot-matrix.md
```

## Layout contracts

### Settings Surface

```css
.settings-surface {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  min-block-size: 0;
  height: 100%;
  background: var(--paper);
}
.settings-nav {
  background: var(--frame);
  border-inline-end: 1px solid var(--rule-strong);
}
.settings-nav__item[data-current]::before { /* Active Axis 3px */ }
.settings-main {
  overflow: auto;
  padding: var(--s-8);
}
.settings-preview-row {
  /* static dual-cell segment mock using --row-min, --cell-pad, --t-editor */
}
```

### Density / scale

- `html { font-size: calc(16px * var(--ui-scale)); }` already in reset — keep.
- Hit targets in compact: enforce min 28px via existing design rule if controls shrink.

## Trade-offs

| Choice | Why | Cost |
| --- | --- | --- |
| Settings not a spine lamp | Keeps 6-lamp model; design entry is gear | Deep link is section id, not surface enum |
| localStorage for theme/density/scale | No IPC change; expression-only | Not in `ProductShellSettings` backup blob |
| Keep tutorial step enum | Stable persistence | May not match design’s exact 5 steps |
| Dialog loops restore | No batch RPC | Slower multi-restore; acceptable for draft counts |
| Alias legacy CSS vars | Faster dual-track close without rewriting all `styles.css` | Temporary aliases until styles.css fully dies |
| Matrix doc without PNGs | Capture may need engine | AC still met via checklist |

## Rollback

- Theme: re-enable class on workbench if critical regression; keep `data-theme` as primary.
- Settings: feature-flag via keeping modal path behind dead code only if needed — prefer forward-fix.
- Tutorial: coach marks are presentation; reducer unchanged → low risk.
- No data migration; localStorage keys additive/compatible (`system` value new).

## Risks

| Risk | Mitigation |
| --- | --- |
| `styles.css` 9k LOC still hardcodes colors | Alias map + grep for hex outside tokens; fix high-visibility workbench paths first |
| Workbench theme-system vs App light/dark desync | One controller; migrate both UIs same day |
| Focus trap on tutorial blocks work | Remove document trap; popover only |
| Settings covering surface loses leave-guard flush | On open settings from workbench, optional `flushBeforeLeave` already used for surface change — call same |
| Spinner sweep incomplete | Gate AC7 on rg count of `LoaderCircle`+`spin`; list residual |
| Shortcut editor empty | Residual honest panel, not fake keybindings |

## Testing strategy

- Unit: `theme-controller` resolve system; density attr mapping; draft select defaults (stale off); settings section list pure data.
- Unit: existing `tutorial-state` + `WorkbenchVisualState` tests stay green.
- Typecheck desktop package.
- Manual: dark shell+grid; settings vertical nav; coach marks on home/workbench; draft multi-copy; forced-colors smoke if OS allows.
- Evidence: `screenshot-matrix.md` filled.
