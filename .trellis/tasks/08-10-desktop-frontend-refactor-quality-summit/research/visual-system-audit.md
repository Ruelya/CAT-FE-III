# Research: Current frontend visual system and planning implications

- Query: What visual-system contracts are actually implemented in the Electron renderer, specifically for tokens, bundled fonts, icon conventions, appearance persistence, layout breakpoints, and responsive behavior; where do source and active Trellis specs disagree; and what must the summit plan resolve before visual implementation begins?
- Scope: internal
- Date: 2026-08-10

## Findings

### Executive assessment

The renderer already has a coherent color and appearance core, but it does not yet have the complete visual foundation described by the parent task. The strongest source-backed pieces are the light/dark surface palette, versioned renderer-local appearance persistence, runtime accent/focus derivation, first-paint fallback, Phosphor icon usage, solid custom window chrome, and reduced-motion token override. The weakest pieces are typography activation, semantic token coverage, compact-layout policy, and consistency between source, specs, and emitted build artifacts.

The planning consequence is that `08-10-desktop-visual-foundation` must be a real dependency rather than a cosmetic prelude. It needs to settle the font-loading contract, semantic token names, radius migration, appearance derivation, control geometry, and layer/elevation rules before any shell or domain surface task restyles shared primitives. The Workbench and shell tasks must then implement responsive behavior against container/window constraints; leaving this entirely to the late accessibility audit would force structural rework after visual polish.

Current strengths to preserve:

- Warm paper/ink light palette, solid dark palette, advanced-brown default seed, and five-color brand ribbon are centralized in `tokens.css` (`apps/desktop/src/renderer/tokens.css:5`, `apps/desktop/src/renderer/tokens.css:39`, `apps/desktop/src/renderer/tokens.css:87`).
- Appearance is stored under the single versioned renderer key `translunar.renderer.appearance.v1`, not in `ProductShellSettings` (`apps/desktop/src/renderer/state/appearance.ts:6`, `apps/desktop/src/renderer/state/use-product-settings.ts:211`).
- Appearance is applied before React renders (`apps/desktop/src/renderer/main.tsx:4`, `apps/desktop/src/renderer/appearance-bootstrap.ts:10`).
- New renderer icon imports are Phosphor. No renderer `lucide-react` import or hand-authored SVG was found.
- Global focus-visible and reduced-motion mechanisms exist (`apps/desktop/src/renderer/styles.css:176`, `apps/desktop/src/renderer/tokens.css:119`).
- Custom title-bar drag/no-drag regions and platform-specific window controls are token-colored and structurally isolated (`apps/desktop/src/renderer/styles.css:197`, `apps/desktop/src/renderer/styles.css:264`, `apps/desktop/src/renderer/styles.css:286`).

Highest-priority gaps:

1. Five bundled font files exist, but there is no `@font-face`, no CSS reference to them, and the current production output contains no emitted font asset. The active UI remains on Segoe/system fonts.
2. The token layer is shallow and internally inconsistent: several component values bypass tokens, one referenced color token is undefined, PDF width is only an ad hoc fallback, and z-index/control-size/scrim/type-role tokens do not exist.
3. Static dark accent declarations disagree with the runtime accent algorithm. Because bootstrap always writes inline accent variables, the CSS dark accent family is normally superseded at runtime.
4. There are no width or container queries and no `ResizeObserver`-driven compact mode. The active Workbench spec says `.editor-region` must be container-responsive, but that element and behavior do not exist in current renderer source.
5. An active component guideline still describes fixed P0 appearance and forbids `localStorage`, directly contradicting the later P4 contract, quality guide, implementation, and E2E persistence test.

### 1. Token system: implemented baseline

`styles.css` imports `tokens.css` as the single visual entry point (`apps/desktop/src/renderer/styles.css:1`). The root/light token set currently contains:

| Domain | Current source-backed values |
| --- | --- |
| Surfaces | canvas `#f4f1ec`, surface `#fbfaf7`, raised `#fffdf9`, subtle `#ece6de` |
| Borders | default `#d8d0c5`, strong `#b7aa9c` |
| Text | ink `#261f1a`, muted `#6b6158`, inverse/on-accent `#fffdf9` |
| Accent | seed/accent `#765847`, hover `#624638`, active `#513a2e`, soft `#ebe0d6` |
| Semantic | success `#1f5c3c`, warning `#7a4f0f`, error `#a83f3f`, focus `#765847` |
| Brand mark | burnt, ochre, lichen, teal, and dusk, reserved for the ribbon |
| Spacing | 4, 8, 12, 16, 24, 32 px (`--space-1` through `--space-6`) |
| Radius | 6, 10, 14 px (`sm`, `md`, `lg`) |
| Elevation | two shadows (`sm`, `md`) |
| Type | one system sans stack; five sizes from 12 to 24 px; tight/body line heights |
| Motion | 120 ms fast, 180 ms shell, one standard easing |
| Layout | 48 px chrome, 320 px TM panel, 36 px collapsed TM rail |
| Focus | 2 px focus outline and 2 px offset |

Sources: `apps/desktop/src/renderer/tokens.css:10`, `apps/desktop/src/renderer/tokens.css:46`, `apps/desktop/src/renderer/tokens.css:54`, `apps/desktop/src/renderer/tokens.css:59`, `apps/desktop/src/renderer/tokens.css:63`, `apps/desktop/src/renderer/tokens.css:74`, and `apps/desktop/src/renderer/tokens.css:79`.

The dark theme replaces surfaces, borders, text, accent, semantics, and shadows (`apps/desktop/src/renderer/tokens.css:87`). Spacing, radii, type scale, motion, and layout remain common through cascade inheritance. Semantic colors are explicitly theme-fixed rather than seed-derived, matching the P4 contract (`.trellis/spec/frontend/ai-plugins-settings.md:360`).

The base component system is recognizable but small:

- Buttons: primary, secondary, ghost, danger, icon-only, and small (`apps/desktop/src/renderer/styles.css:380`).
- Fields: shared label/control/error rules, followed later by a second `.field`/descendant-input block (`apps/desktop/src/renderer/styles.css:453`, `apps/desktop/src/renderer/styles.css:834`).
- Surfaces: padded stage, masthead, framed panel, centered/stack layouts (`apps/desktop/src/renderer/styles.css:483`).
- Dialogs: fixed scrim, raised solid dialog, shared action row (`apps/desktop/src/renderer/styles.css:583`).
- Dense operational patterns: P4 tables/forms, segment table, editor panels, TM/PDF panels, status chips, data tables, and confined scroll containers.

This is sufficient to preserve current behavior, but not sufficient for the parent requirement to converge typography, spacing, radii, borders, elevation, focus, motion, and z-index into semantic roles.

### 2. Token debt and CSS drift

#### Undefined or ad hoc variables

- `.editor-command-bar__menu` uses `var(--color-ink)` with no fallback, but `--color-ink` is not defined. The shadow declaration can therefore become invalid (`apps/desktop/src/renderer/styles.css:752`; compare `apps/desktop/src/renderer/tokens.css:20`).
- `.pdf-canvas__image` references undefined `--color-surface-elevated` but supplies a fallback to `--color-surface` (`apps/desktop/src/renderer/styles.css:1449`). The canonical token is currently named `--color-surface-raised` (`apps/desktop/src/renderer/tokens.css:13`).
- `--pdf-panel-width` is not declared in `tokens.css`; each grid declaration falls back locally to 280 px (`apps/desktop/src/renderer/styles.css:675`).
- `--space-6`, `--color-accent-seed`, and the CSS `--color-focus` declaration are defined but not directly consumed by `styles.css`; focus is consumed indirectly through `--focus-ring`, while accent seed is owned by runtime appearance code.

#### Foundation values bypassing tokens

- Raw radii appear at 3 px and 4 px in editor menu items, fields, and brand geometry (`apps/desktop/src/renderer/styles.css:229`, `apps/desktop/src/renderer/styles.css:765`, `apps/desktop/src/renderer/styles.css:845`).
- Raw spacing/padding/font values appear in command menu items and PDF overlays (`apps/desktop/src/renderer/styles.css:755`, `apps/desktop/src/renderer/styles.css:763`, `apps/desktop/src/renderer/styles.css:1428`, `apps/desktop/src/renderer/styles.css:1470`).
- A raw menu shadow bypasses the elevation tokens (`apps/desktop/src/renderer/styles.css:752`).
- Layer values are literals (`z-index: 1`, `20`, and `40`) rather than named layer tokens (`apps/desktop/src/renderer/styles.css:589`, `apps/desktop/src/renderer/styles.css:746`, `apps/desktop/src/renderer/styles.css:898`).
- The modal scrim is a light-ink literal and is not theme-tokenized (`apps/desktop/src/renderer/styles.css:588`).
- Layout-only inline styles remain in Welcome, Workbench, QA, and Export (`apps/desktop/src/renderer/surfaces/Welcome.tsx:25`, `apps/desktop/src/renderer/surfaces/Workbench.tsx:120`, `apps/desktop/src/renderer/surfaces/QaReview.tsx:94`, `apps/desktop/src/renderer/surfaces/ExportReview.tsx:70`). The percentage positioning in `PdfPageReview` is data-derived geometry and is a legitimate inline-style exception (`apps/desktop/src/renderer/workbench/PdfPageReview.tsx:219`).

#### Radius and target-size migration

The current token scale is 6/10/14 px, while the parent task explicitly chooses 4/6/8 px (`apps/desktop/src/renderer/tokens.css:54`; `.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/prd.md:90`). This is a deliberate visual migration, not a correction that can be inferred from current source-backed specs. It should land once in the foundation task, with screenshot and geometry evidence, before domain surfaces are restyled.

Base `.btn` and `.btn--icon` meet the parent's 32 px dense-target floor, but `.btn--sm` drops to 28 px (`apps/desktop/src/renderer/styles.css:380`, `apps/desktop/src/renderer/styles.css:439`, `apps/desktop/src/renderer/styles.css:445`). PDF OCR Correct can be as short as 1.25 rem (`apps/desktop/src/renderer/styles.css:1464`). The foundation should define semantic compact/default/prominent control-height tokens, and the Workbench/accessibility tasks should remove sub-32 px interactive hit areas unless a larger invisible hit target is proven.

#### Surface material policy needs precise wording

No `backdrop-filter` exists, and primary surfaces are solid. Current CSS does use alpha/color mixing for modal scrims, selected rows, error bands, and PDF block overlays (`apps/desktop/src/renderer/styles.css:369`, `apps/desktop/src/renderer/styles.css:588`, `apps/desktop/src/renderer/styles.css:851`, `apps/desktop/src/renderer/styles.css:1461`). This does not constitute frosted glass, but it conflicts literally with the component guideline statement that alpha is allowed only for shadows (`.trellis/spec/frontend/component-guidelines.md:103`). The durable rule should distinguish forbidden translucent material/backdrop blur from legitimate overlays and state tints.

### 3. Bundled font assets are present but inactive

Five licensed WOFF2 files are checked in under `assets/fonts/`:

| Intended role | Family/file | Size | Declared range |
| --- | --- | ---: | --- |
| Display | Translunar Space Grotesk | 49,256 B | variable 300-700 |
| Interface/body | Translunar Chivo | 62,100 B | variable 100-900 |
| Metadata | Translunar Space Mono regular | 34,932 B | static 400 |
| Metadata | Translunar Space Mono bold | 35,324 B | static 700 |
| CJK/editor | Translunar Noto Sans SC | 7,782,072 B | variable 100-900 |

The manifest totals 7,963,684 bytes (7.59 MiB), records WOFF2 compression without glyph subsetting, and includes pinned upstream sources, commits, hashes, and OFL license files (`apps/desktop/src/renderer/assets/fonts/manifest.json:2`, `apps/desktop/src/renderer/assets/fonts/manifest.json:10`, `apps/desktop/src/renderer/assets/fonts/manifest.json:21`). Noto Sans SC accounts for approximately 97.7% of the font payload.

No `@font-face`, `font-display`, asset URL, or family reference exists in renderer CSS or TSX. The only active stack is `"Segoe UI Variable", "Segoe UI", system-ui, -apple-system, sans-serif` (`apps/desktop/src/renderer/tokens.css:63`). The existing `apps/desktop/dist/renderer/` snapshot contains only HTML, one CSS asset, and one JS asset; it contains no emitted WOFF2 asset. Thus the manifest's statement that the production build emitted all five files is not true of the currently present build snapshot and must be re-measured after implementation.

Planning implications:

- Foundation must add explicit `@font-face` declarations and semantic family tokens for display, interface/body, metadata, and CJK/editor roles. It must declare appropriate variable/static weights and safe platform fallbacks.
- `font-display` must be an explicit acceptance decision. The parent requests font-display behavior but does not choose a value. Startup/layout-shift evidence should determine it; `swap` is a reasonable candidate but is not established by current source.
- Do not preload the 7.78 MiB CJK face by default without measurement. The performance task should measure startup, first editor paint, fallback swap/layout shift, cache behavior, and packaged output. Subsetting or unicode-range work is a separate measured optimization because the current manifest explicitly records an unsubsetted source.
- The production verification must inspect emitted font URLs under Vite `base: "./"` (`apps/desktop/vite.config.ts:6`) and Electron `loadFile`, not only confirm that source files exist.
- The manifest phrase “Workbench uses 400, 500, 600, 700” is currently aspirational; after activation it should reflect actual CSS usage and output measurements.

### 4. Appearance ownership and persistence

#### Current storage and application flow

`RendererAppearancePreferenceV1` is exactly `{ version: 1, theme: "light" | "dark", accentSeed: string }`, with light and `#765847` defaults (`apps/desktop/src/renderer/state/appearance.ts:8`, `apps/desktop/src/renderer/state/appearance.ts:16`). Parsing accepts only version 1, a supported theme, and canonical six-digit hex; malformed, unavailable, or throwing storage falls back safely (`apps/desktop/src/renderer/state/appearance.ts:69`, `apps/desktop/src/renderer/state/appearance.ts:76`, `apps/desktop/src/renderer/state/appearance.ts:97`).

Bootstrap reads and applies the preference before the React tree mounts (`apps/desktop/src/renderer/appearance-bootstrap.ts:10`). `applyAppearance` sets `data-theme`, `color-scheme`, and inline derived accent/focus variables on the document root (`apps/desktop/src/renderer/state/appearance.ts:322`). Product Settings holds committed and draft preferences separately, applies only on explicit Apply, and writes the same versioned key (`apps/desktop/src/renderer/state/use-product-settings.ts:64`, `apps/desktop/src/renderer/state/use-product-settings.ts:250`). Locale remains the only shell-settings patch (`apps/desktop/src/renderer/state/use-product-settings.ts:202`).

The P4 E2E suite changes dark/custom appearance, closes Electron, relaunches with the same user-data directory, verifies the restored theme/seed, and resets to light (`apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:270`). This makes versioned renderer-local persistence a shipped contract, not an optional styling choice.

#### First-paint behavior

`index.html` hardcodes the light canvas/text and `color-scheme: light` (`apps/desktop/src/renderer/index.html:10`, `apps/desktop/src/renderer/index.html:12`). This matches the default and prevents an unstyled white/black scaffold, but it duplicates token literals. Because bootstrap is a bundled module loaded at the end of body, it is pre-React but not proven to be pre-first-paint for a persisted dark preference. The qualification task should include a persisted-dark cold-start recording or first-frame screenshot before claiming zero light flash.

#### Runtime/CSS dark accent disagreement

Dark CSS declares a lighter brown accent family (`#9a7660`, `#b08974`, `#c49d87`) (`apps/desktop/src/renderer/tokens.css:104`). Runtime `deriveAccentPalette`, however, always returns the normalized seed itself as `accent`, derives hover/active toward the selected on-accent text direction, and writes those results as inline variables (`apps/desktop/src/renderer/state/appearance.ts:281`, `apps/desktop/src/renderer/state/appearance.ts:312`, `apps/desktop/src/renderer/state/appearance.ts:332`). Since bootstrap always applies a valid preference, those inline values normally override the static dark accent family. The static dark accent values are therefore not an accurate description of the running default dark theme.

The runtime derivation also duplicates surface RGB constants. Light values match CSS, but its dark surface `{36,30,26}` and raised `{44,37,32}` do not match CSS `#24201a` and `#2e2922` (`apps/desktop/src/renderer/state/appearance.ts:298`; `apps/desktop/src/renderer/tokens.css:91`). Focus contrast is consequently calculated against slightly different dark surfaces than those rendered.

Foundation should establish one authority for theme colors and derived contrast inputs. Acceptable designs include generated/shared constants feeding both CSS and TypeScript, or a constrained runtime calculation that reads canonical computed surface tokens after the theme attribute is applied. The outcome must preserve the storage schema and key.

#### Contrast and persistence edge coverage

- Focus derivation enforces 3:1 against canvas/surface/raised and has blue fallbacks (`apps/desktop/src/renderer/state/appearance.ts:191`, `apps/desktop/src/renderer/state/appearance.ts:197`).
- The tests also require only 3:1 for text on the custom accent (`apps/desktop/src/renderer/state/appearance.test.ts:91`). The parent requires WCAG 2.2 AA; normal-size button text should be verified against the applicable 4.5:1 threshold, not inferred from this weaker test.
- Apply correctly keeps the in-memory palette and reports a local error when storage write fails (`apps/desktop/src/renderer/state/use-product-settings.ts:265`). Reset silently swallows a storage exception in `resetAppearance` and then clears `appearanceError` (`apps/desktop/src/renderer/state/appearance.ts:343`, `apps/desktop/src/renderer/state/use-product-settings.ts:275`). This does not fully satisfy the P4 statement that a storage write failure remains visible (`.trellis/spec/frontend/ai-plugins-settings.md:344`).

### 5. Icon conventions

All renderer icon imports found use `@phosphor-icons/react`:

- Application and P4 navigation: 18 px regular (`apps/desktop/src/renderer/shell/AppChrome.tsx:2`, `apps/desktop/src/renderer/shell/AppChrome.tsx:174`).
- Window controls: 12-14 px bold (`apps/desktop/src/renderer/shell/WindowControls.tsx:1`).
- Editor commands: 16 px regular/bold through a typed command-to-icon registry (`apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:29`).
- TM/PDF panel controls and task-package discard: 16 px, generally bold (`apps/desktop/src/renderer/workbench/PanelChrome.tsx:1`, `apps/desktop/src/renderer/workbench/PdfPageReview.tsx:64`, `apps/desktop/src/renderer/insights/TaskPackagePanel.tsx:103`).

No renderer `lucide-react` import, hand-authored `<svg>`, or emoji structural icon was found. The five-color Translunar mark is CSS span geometry rather than an icon-library glyph (`apps/desktop/src/renderer/shell/AppChrome.tsx:142`).

`lucide-react` remains an apparently unused desktop dependency (`apps/desktop/package.json:24`) and lockfile entry. The current static quality audit scans only `src/renderer`, so it passes while the obsolete dependency remains (`.trellis/spec/frontend/quality-guidelines.md:25`). The foundation or delivery task should remove it if a full-workspace usage check confirms it is unused, and qualification should audit both source imports and package dependencies.

The component/quality guides require both `aria-label` and `title` for icon-only controls (`.trellis/spec/frontend/component-guidelines.md:80`; `.trellis/spec/frontend/quality-guidelines.md:134`). App chrome and window controls comply. `PanelChrome`, both PDF chrome controls, and task-package Discard currently have `aria-label` but no `title` (`apps/desktop/src/renderer/workbench/PanelChrome.tsx:13`, `apps/desktop/src/renderer/workbench/PdfPageReview.tsx:64`, `apps/desktop/src/renderer/insights/TaskPackagePanel.tsx:103`). This is a small but concrete convention mismatch for the owning Workbench/Insights tasks.

Planning should preserve Phosphor rather than introduce an icon wrapper solely for consistency. A small shared icon-button primitive is justified only if it enforces the already-repeated size, hit-area, tooltip/title, aria-label, pressed/current, and disabled contracts without obscuring native button semantics.

### 6. Layout and responsive behavior

#### Current layout strategy

The renderer contains no width-based `@media` query and no `@container` query. The only media rule handles reduced motion (`apps/desktop/src/renderer/tokens.css:119`, `apps/desktop/src/renderer/styles.css:333`). No `ResizeObserver`, `.editor-region`, or compact-mode state exists in renderer source.

Current compact resilience comes from:

- Full-height grid shell with a scrollable app stage (`apps/desktop/src/renderer/styles.css:187`, `apps/desktop/src/renderer/styles.css:339`).
- `min-width: 0` on identity and central Workbench columns, plus ellipsis for the title-strip identity (`apps/desktop/src/renderer/styles.css:254`, `apps/desktop/src/renderer/styles.css:702`).
- Flex wrapping in P4 tabs/toolbars, editor command bar, Asset Hub tabs, and interop fields (`apps/desktop/src/renderer/styles.css:32`, `apps/desktop/src/renderer/styles.css:715`, `apps/desktop/src/renderer/styles.css:854`, `apps/desktop/src/renderer/styles.css:1328`).
- Confined scroll on tables, panels, the segment grid, PDF canvas, and page list.
- Auto-fit fields in interop panels (`apps/desktop/src/renderer/styles.css:1335`).

These are useful baselines, but they are not a defined breakpoint system.

#### Shell pressure points

The title strip keeps brand, all context-valid navigation icons, and Windows/Linux window controls in one non-wrapping row. Actions and window controls are `flex-shrink: 0`; only identity text yields (`apps/desktop/src/renderer/styles.css:254`, `apps/desktop/src/renderer/styles.css:264`, `apps/desktop/src/renderer/styles.css:286`). As more P4 destinations become valid, compact/125% scaling can consume the drag region or collide even when the document itself does not overflow. The shell task needs an explicit priority/overflow policy that preserves current destination gating, current-location state, tooltips, drag/no-drag behavior, and native control geometry.

#### Workbench pressure points

The Workbench supports a two-column editor/TM layout and a three-column PDF/editor/TM layout. Expanded docks reserve 280 px and 320 px; collapsed rails reserve 36 px (`apps/desktop/src/renderer/styles.css:663`). Header actions are non-wrapping and non-shrinking (`apps/desktop/src/renderer/styles.css:631`, `apps/desktop/src/renderer/styles.css:657`). Command buttons wrap, but there is no width-driven migration of labels or commands (`apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:46`, `apps/desktop/src/renderer/styles.css:715`).

The active Electron workbench spec is more explicit: Workbench must observe `.editor-region` width, move filters into a select below a compact threshold, hide only redundant text, retain every capability, and use container-responsive behavior rather than a viewport-only media query (`.trellis/spec/frontend/electron-workbench.md:2550`). Current `Workbench.tsx` renders `.workbench__main`, not `.editor-region`, and contains no observer or compact mode (`apps/desktop/src/renderer/surfaces/Workbench.tsx:223`, `apps/desktop/src/renderer/surfaces/Workbench.tsx:256`). This is active spec-to-code drift and directly relevant to the summit.

The Workbench task should own the container-responsive architecture because dock state changes editor width without changing viewport width. The later accessibility task should validate and harden it, not invent it after the editor visual redesign.

#### Required viewport matrix is incomplete

Electron permits a minimum window of 1180x700 (`apps/desktop/src/main/index.ts:398`). The parent asks for 1250x744, 1680x942, 1920x1080, and 125% text scaling. P4 E2E currently checks document overflow at the three named viewport sizes, but only while the currently selected Settings state is mounted (`apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:247`). It does not exercise the true 1180x700 minimum, every route family, dock combinations, persisted dark first paint, 125% text scaling, or container-width transitions.

Add 1180x700 to focused shell/Workbench checks even if the final release matrix retains the three parent sizes. Define compact thresholds from measured container geometry and capability preservation, not from arbitrary device classes.

### 7. Spec contradictions and authority resolutions

| Topic | Contradiction | Recommended planning resolution |
| --- | --- | --- |
| Appearance persistence | Component guideline calls appearance fixed P0 and says never write theme/accent to `localStorage` (`.trellis/spec/frontend/component-guidelines.md:88`, `:100`). P4, quality guide, code, and E2E require versioned local persistence (`.trellis/spec/frontend/ai-plugins-settings.md:125`; `.trellis/spec/frontend/quality-guidelines.md:33`). | Treat P4/versioned persistence as authoritative. Preserve the key/schema and update the component guideline during closeout. The prohibition should apply to ad hoc keys and `ProductShellSettings`, not appearance-v1. |
| Typography | Font manifest assigns four roles and claims Workbench usage, while tokens and emitted snapshot use only Segoe/system and emit no fonts. Parent R2 explicitly re-adopts the four bundled families. | Foundation owns activation and output verification. Treat manifest role labels as intended inputs, not evidence of current use. |
| Radius scale | Current tokens are 6/10/14 px; parent R2 selects 4/6/8 px. | Follow the newer parent decision, but record it as a deliberate migration with visual regression evidence. Do not let later surface tasks invent their own transitional values. |
| Compact Workbench | Active workbench spec requires `.editor-region` container responsiveness; current code has neither the landmark nor behavior. | Workbench child implements the container contract; accessibility child verifies at dock/container transitions and scaling. If the spec section is judged historical, explicitly replace it rather than silently ignoring it. |
| Alpha/material | Component guideline says alpha only for shadows; current UI legitimately uses scrims and state overlays while still forbidding glass. | Rewrite the durable rule around material semantics: solid panel surfaces, no backdrop blur/glass; tokenized scrims and bounded state overlays are allowed. |
| Icon audit | Source uses Phosphor consistently, but obsolete Lucide remains installed; static command scans source only. | Preserve Phosphor, remove unused Lucide after workspace-wide confirmation, and expand the audit to dependencies. |
| Source vs build snapshot | Current source close-active mix uses `var(--color-text)` and appearance tests require it, while the present minified `dist` CSS shows an older/raw-black result and no fonts. | Do not use checked-in/current `dist` as proof. Rebuild before screenshots/E2E and inspect emitted CSS/assets. |

### 8. Planning implications by child task

#### `08-10-desktop-visual-foundation`

This task should own, in one serial change set:

- `@font-face` declarations, family/weight/fallback roles, `font-display` decision, and initial type assignment for display, UI/body, metadata, and CJK/editor text.
- One semantic token vocabulary for color, typography, spacing, 4/6/8 radii, border, elevation, scrim, focus, motion, control height, panel/rail width, and z-index layers.
- Removal or explicit fallback of undefined `--color-ink`, `--color-surface-elevated`, and undeclared `--pdf-panel-width`.
- Reconciliation of static light/dark accents with runtime custom-seed derivation and canonical surface values.
- Preservation of the storage key/schema, light default, semantic-color independence, and explicit Apply/Reset UX.
- Base control states with stable 32 px minimum hit areas, including icon-only buttons.
- A documented dynamic-inline-style exception for data geometry; ordinary layout constants move to classes/tokens.

Focused evidence should include token-presence/undefined-reference static checks, unit tests for appearance parsing/derivation/storage failure, computed-style checks in light/dark/custom-seed modes, normal-text and focus contrast thresholds, font-load/fallback tests, emitted WOFF2 paths, and before/after screenshots of primitives.

#### `08-10-desktop-shell-navigation-system-states`

- Define compact title-strip navigation/overflow without damaging the drag region, platform inset, context gating, or window controls.
- Apply display/body/metadata roles deliberately to brand, identity, statuses, and dialogs.
- Keep brand ribbon colors mark-only and preserve Phosphor/title/aria conventions.
- Verify 1180x700, parent viewports, both themes, long identity text, and 125% scaling.

#### `08-10-desktop-workbench-editor-experience`

- Implement `.editor-region` or an explicitly renamed equivalent as a measured container-responsive boundary.
- Define behavior for PDF/TM dock combinations, command labels/overflow, header actions, and segment-table minimum usable width.
- Use CJK/editor and metadata font roles selectively; do not apply the 7.78 MiB face indiscriminately to all chrome.
- Normalize panel icon tooltips and eliminate sub-32 px controls.

#### Domain surface tasks

- Consume foundation primitives rather than adding new local radii, shadows, status colors, or arbitrary inline layout values.
- Prefer unframed operational sections and dense tables/lists; use framed panels only for genuinely bounded tools/forms.
- Because all tasks touch `styles.css`, retain the parent's serial ownership rule. If CSS is split later, keep one imported entry and explicit layer/order contract so Vite still emits one predictable renderer stylesheet.

#### `08-10-desktop-accessibility-responsive-state-audit`

- Validate, rather than defer-design, compact behavior across every surface.
- Include 1180x700, the three parent viewports, 125% text scaling, both themes, reduced motion, long CJK/IDs, dock transitions, and document/container overflow.
- Verify 4.5:1 normal text, 3:1 focus/non-text indicators, stable target geometry, and tooltip/accessibility naming for icon-only controls.

#### `08-10-desktop-renderer-performance-delivery`

- Establish a pre-change baseline before fonts are activated.
- Record renderer JS/CSS/font bytes, cold/warm font requests, first useful paint, text swap/layout shift, and editor interaction cost.
- Treat Noto Sans SC as the dominant payload and decide preload/subsetting/unicode-range only from evidence.
- Inspect production output under relative asset URLs and package loading; source-file presence is not delivery proof.

#### `08-10-desktop-visual-release-qualification`

- Rebuild immediately before qualification and inventory emitted CSS/font assets.
- Capture named light/dark/custom-seed first-frame and settled screenshots across route families and required sizes.
- Include source plus dependency audits for glass/Lucide/undefined tokens/raw foundation literals.
- Preserve exact Engine workflows and record fixture-gated skips as residual risk.

### Files found

| Path | Description |
| --- | --- |
| `apps/desktop/src/renderer/tokens.css` | Current root/light/dark tokens, focus, motion, and fixed panel geometry. |
| `apps/desktop/src/renderer/styles.css` | Single renderer stylesheet containing shell, primitives, all surface families, Workbench, Insights/PDF, and P4 styles. |
| `apps/desktop/src/renderer/index.html` | CSP, viewport, and hardcoded light first-paint fallback. |
| `apps/desktop/src/renderer/main.tsx` | Imports pre-React appearance bootstrap before app render and global CSS. |
| `apps/desktop/src/renderer/appearance-bootstrap.ts` | Reads/applies appearance before React mounts. |
| `apps/desktop/src/renderer/state/appearance.ts` | Storage schema, parser, color math, accessible focus derivation, root CSS-variable application, and reset behavior. |
| `apps/desktop/src/renderer/state/appearance.test.ts` | Token, theme, contrast, storage, no-glass, first-paint, and title-strip static contracts. |
| `apps/desktop/src/renderer/state/use-product-settings.ts` | Appearance draft/apply/reset and shell-locale ownership boundary. |
| `apps/desktop/src/renderer/surfaces/ProductSettings.tsx` | User-facing light/dark and custom-accent controls. |
| `apps/desktop/src/renderer/assets/fonts/manifest.json` | Font provenance, licenses, hashes, roles, weights, and 7.59 MiB payload budget. |
| `apps/desktop/src/renderer/assets/fonts/*.woff2` | Five bundled but currently unreferenced font files. |
| `apps/desktop/src/renderer/shell/AppChrome.tsx` | Phosphor app navigation, current-state aria, ribbon, and window-control composition. |
| `apps/desktop/src/renderer/shell/WindowControls.tsx` | Phosphor custom window icons and platform branch. |
| `apps/desktop/src/renderer/surfaces/Workbench.tsx` | Current fixed-dock Workbench composition; no container compact mode. |
| `apps/desktop/src/renderer/workbench/EditorCommandBar.tsx` | Typed Phosphor registry, wrapping toolbar, and static primary/overflow placement. |
| `apps/desktop/src/renderer/workbench/PanelChrome.tsx` | Shared TM collapse control; missing `title`. |
| `apps/desktop/src/renderer/workbench/PdfPageReview.tsx` | PDF dock controls and legitimate data-derived inline overlay geometry. |
| `apps/desktop/src/renderer/insights/TaskPackagePanel.tsx` | Icon-only destructive preview control; missing `title`. |
| `apps/desktop/package.json` | Phosphor and still-installed Lucide dependencies. |
| `apps/desktop/vite.config.ts` | Renderer root, `base: "./"`, and production output directory. |
| `apps/desktop/src/main/index.ts` | BrowserWindow minimum 1180x700. |
| `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts` | Appearance relaunch/reset evidence and limited viewport-overflow loop. |
| `.trellis/spec/frontend/component-guidelines.md` | Component/icon/material rules plus the stale fixed-P0 appearance section. |
| `.trellis/spec/frontend/quality-guidelines.md` | Current appearance-v1, Phosphor, static audit, E2E, and accessibility expectations. |
| `.trellis/spec/frontend/ai-plugins-settings.md` | Authoritative P4 renderer-local appearance and visual locks. |
| `.trellis/spec/frontend/electron-workbench.md` | Renderer boundaries, custom chrome, viewport evidence, and missing container-responsive Workbench contract. |
| `.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/prd.md` | New program authority for fonts, 4/6/8 radii, themes, targets, and viewports. |

### Code patterns

- Global token consumption: `body { font-family: var(--font-sans) }` (`apps/desktop/src/renderer/styles.css:148`).
- Theme branch: `html[data-theme="dark"]` overrides fixed theme tokens (`apps/desktop/src/renderer/tokens.css:87`).
- Pre-React application: `readAppearancePreference()` then `applyAppearance(preference)` (`apps/desktop/src/renderer/appearance-bootstrap.ts:10`).
- Explicit user commit: validate seed, apply in memory, then persist and surface write failure (`apps/desktop/src/renderer/state/use-product-settings.ts:250`).
- Solid shell layout: three-row root and draggable title strip (`apps/desktop/src/renderer/styles.css:187`, `apps/desktop/src/renderer/styles.css:197`).
- Confined-scroll dense layout: P4 panel, table scroll, segment grid, PDF body (`apps/desktop/src/renderer/styles.css:39`, `apps/desktop/src/renderer/styles.css:868`, `apps/desktop/src/renderer/styles.css:873`, `apps/desktop/src/renderer/styles.css:1382`).
- Fixed Workbench docks: CSS-grid columns switch by collapsed/maximized modifier classes (`apps/desktop/src/renderer/styles.css:663`).
- Typed icon mapping: `Record<EditorCommandId, ReactNode>` uses Phosphor at consistent command size (`apps/desktop/src/renderer/workbench/EditorCommandBar.tsx:29`).
- Icon-only accessible name baseline: AppChrome supplies both `aria-label` and `title` (`apps/desktop/src/renderer/shell/AppChrome.tsx:158`).

### External references and versions

No live external web research was required. Version/provenance information below is repository-recorded:

- `@phosphor-icons/react` `^2.1.10`; obsolete/unused `lucide-react` `1.25.0` (`apps/desktop/package.json:21`).
- React/React DOM `19.2.7`, Vite `8.1.5`, Electron `41.10.3`, Playwright `1.61.1` (`apps/desktop/package.json`).
- Space Grotesk 2.0.0, Chivo 2.002, Noto Sans SC 2.004, and a Google Fonts static Space Mono release, with upstream commits/URLs and SIL OFL 1.1 licenses recorded in `apps/desktop/src/renderer/assets/fonts/manifest.json`.
- WCAG 2.2 AA is the parent task's required accessibility standard (`.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/prd.md:132`). This audit did not perform a fresh standards conformance review.

### Related specs

- `.trellis/spec/frontend/index.md` - frontend entry point and explicit appearance/icon pre-development checklist.
- `.trellis/spec/frontend/component-guidelines.md` - primitives, Phosphor rule, solid-surface rule, focus/layout behavior, and stale P0 appearance text.
- `.trellis/spec/frontend/quality-guidelines.md` - current appearance-v1 authority, static audit, icon tooltip/name requirements, production-build expectations.
- `.trellis/spec/frontend/ai-plugins-settings.md` - P4 appearance schema, Settings behavior, persistence, semantic independence, viewports, and E2E obligations.
- `.trellis/spec/frontend/electron-workbench.md` - renderer structure, window chrome, fixed/compact editor expectations, and production relative-asset contract.
- `.trellis/spec/frontend/directory-structure.md` - authoritative renderer module ownership.
- `.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/prd.md` - newest program-level visual decision set.
- `.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/design.md` - foundation-to-primitives-to-shell layering and serial `styles.css` ownership.
- `.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/implement.md` - ordered child gates and complete visual evidence matrix.

## Caveats / Not Found

- This was a read-only source inspection. No product code, spec, task metadata, tests, build output, or git state was modified; only this report was written.
- No Electron app was launched. No screenshot, Playwright, axe, computed-style, font request, performance trace, 125% scaling, reduced-motion runtime, or native platform inspection was performed. Geometry and first-paint risks identified here require runtime verification.
- No build was run. The existing `apps/desktop/dist/renderer` snapshot differs from current source in at least the title-strip close-active mix and contains no fonts; it may be stale and is not treated as authoritative.
- No git operation or history inspection was performed, per researcher scope.
- No external web documentation was fetched. Font upstream information comes from the checked-in manifest; WCAG threshold planning should be verified against the applicable normative success criteria during implementation/review.
- A full unused-dependency graph was not generated. `lucide-react` has no renderer source import, but removal should follow a workspace-wide import/build confirmation.
- The report does not choose an exact compact threshold or font-display/subsetting strategy because those decisions require measured layout and delivery evidence.
