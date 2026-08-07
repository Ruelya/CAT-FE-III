# Frontend Directory Structure

## Runtime Layers

The desktop app is one package with explicit Electron boundaries:

```text
apps/desktop/
|-- src/main/       # Electron lifecycle, trusted IPC handlers, EngineClient
|-- src/preload/    # contextBridge-only DesktopApi exposure
|-- src/shared/     # small cross-runtime public types (desktop-api.ts)
|-- src/renderer/   # React surfaces, presentation state, CSS, local tests
`-- tests/e2e/      # Playwright tests against a built app and real engine
```

`apps/desktop/src/renderer/main.tsx` is the renderer entry point. `App.tsx`
owns surface/session orchestration; `ProjectHome.tsx`, `SetupView.tsx`,
`ProjectInsightsPage.tsx`, `Workbench.tsx`, `WorkbenchPages.tsx`, and
`AssistantPanel.tsx` own visible feature areas.

`Workbench.tsx` orchestrates the editor and wires ORTHO Phase 2–4 extracts under
`components/workbench/`:

```text
components/workbench/
|-- Masthead.tsx, FilterRail.tsx, ActiveAxis.tsx, DocumentMatrix.tsx
|-- SegmentGrid.tsx, SegmentRow.tsx, SegmentStatusLamp.tsx, TagCapsule.tsx
|-- SeamActionRail.tsx, BatchBar.tsx, InlineQaStrip.tsx, segmentTypes.ts
|-- Stack/
|   |-- StackPanel.tsx          # dual-pane stack (replaces SuggestionsPanel)
|   |-- MatchList.tsx, MatchCard.tsx, TermList.tsx, TermRow.tsx
|   |-- AssistantDrawer.tsx, GroundingInspector.tsx
|   |-- wordDiff.ts, stackTypes.ts, *.test.ts(x)
`-- PreviewDock/
    |-- PreviewDock.tsx         # extract of DocumentPreview
    `-- previewTypes.ts
```

ORTHO Phase 5 project-class extracts live under `components/project/`. Keep
App import paths for the three orchestrators stable:

```text
components/project/
|-- CompositionRail.tsx         # shared 35%/30% brand rail
|-- HomeTabList.tsx             # §E2 horizontal home tabs
|-- InsightsTabList.tsx         # §E3 vertical grouped insights tabs
|-- Stepper.tsx                 # §E5 setup steps
|-- ProjectCard.tsx, ProjectsPane.tsx, TemplatesPane.tsx, RecyclePane.tsx
|-- insights/
|   |-- OverviewPanel.tsx, FilesPanel.tsx, AnalysisPanel.tsx
|   |-- ReimportPanel.tsx, ArchivePanel.tsx, HistoryPanel.tsx
|   `-- insightsShared.tsx
`-- *.test.ts(x)
```

ORTHO Phase 6 quality- and asset-class extracts:

```text
components/quality/
|-- LiveMatrix.tsx              # thin severity/health matrix (not DocumentMatrix)
|-- qa-presenters.ts            # group, span slice, matrix projection (+ tests)
|-- QaDistributionColumn.tsx, QaIssueList.tsx, QaEvidencePanel.tsx
|-- QaProfileDrawer.tsx, QaRunHistoryPopover.tsx
|-- ExportGateBanner.tsx, ExportGateChecklist.tsx
|-- ExportDegradationList.tsx, ExportDeliveryActions.tsx
`-- *.test.ts(x)

components/assets/
|-- AssetsSurface.tsx           # five-tab shell; Spine id stays translation-memory
|-- AssetsTabList.tsx, AssetsOverviewStrip.tsx
|-- TmHubPanel.tsx, TermbaseHubPanel.tsx
`-- *.test.ts(x)
```

ORTHO Phase 7 AI- and plugin-class extracts:

```text
components/ai/
|-- ai-presenters.ts            # tabs, budget gate, usage stack (+ tests)
|-- consistency-presenters.ts   # client divergent-target scan (+ tests)
|-- plugin-permission-presenters.ts  # G7 rows, tier honesty (+ tests)
|-- ConsistencyRepairToast.tsx, ConsistencyRepairDrawer.tsx
`-- *.test.ts(x)

components/workbench/
|-- SelectionAiMenu.tsx         # §A4 selection-anchored plugin AI menu
`-- SelectionAiMenu.test.tsx
```

ORTHO Phase 8 system-class helpers (expression-only; no new IPC):

```text
components/system/
|-- theme-controller.ts         # light|dark|system → data-theme (+ tests)
|-- appearance-controller.ts    # density + --ui-scale (+ tests)
|-- settings-presenters.ts      # §E3 section/group ids
|-- draft-recovery-presenters.ts
|-- SurfaceStates.tsx           # loading / empty / error primitives
`-- settings/                   # optional panel extract folder (may be empty)
```

Keep stable page/panel import paths for shell and Insights dual-host:

- `QaReviewPage.tsx`, `ExportReviewPage.tsx` (orchestrators)
- Root `AssetCurationPanel.tsx`, `AlignmentCorpusPanel.tsx`, `InteropPanel.tsx`,
  `TaskPackagePanel.tsx` (do not move; Insights + Assets both mount as needed)
- `AiControlPage.tsx`, `PluginsPanel.tsx`, `PluginPanelHost.tsx`,
  `PluginAiActions.tsx` (do not move; Spine / Insights dual-host)
- `ProductSettingsPage.tsx`, `TutorialOverlay.tsx`, `DraftRecoveryDialog.tsx`
  (do not move; App owns settings open/section + draft inspect mapping)

`WorkbenchPages.WorkspacePage` routes `translation-memory` → `AssetsSurface`
and `ai-control` → `AiControlPage` (no second Band/SurfaceHeader when shell
already provides navigation). Insights continues to host `PluginsPanel`.
`App.tsx` mounts settings **inside** the Shell surface slot when
`settingsOpen` (not a full-app modal).

Grid keyboard/selection lives in `hooks/useRovingGrid.ts`. Shared interaction
math lives in `workbench-utils.ts` with colocated tests (including
`restorePaletteOwnerFocus`). Project lifecycle pure helpers stay in
`project-home-utils.ts`. QA presentation pure helpers stay in
`components/quality/qa-presenters.ts`. AI/plugin pure helpers stay in
`components/ai/*-presenters.ts`. Theme/density/scale pure helpers stay in
`components/system/*-controller.ts`. Surface CSS under `styles/30-surfaces/`:

```text
styles/30-surfaces/
|-- workbench.css
|-- workbench-stack.css
|-- project-home.css
|-- setup.css
|-- insights.css
|-- quality.css                 # .qa-ortho / .export-ortho
|-- assets.css                  # .assets-ortho / hubs
|-- ai.css                      # .ai-ortho / selection-ai / consistency
|-- plugins.css                 # .plugins-ortho / host attribution
`-- settings.css                # .settings-surface §E3 plate
```

Import new surface sheets from `styles/index.css`. Prefer shell-scoped rules
under `.project-home-shell` / `.setup-wizard-shell` / `.qa-ortho` /
`.export-ortho` / `.assets-ortho` / `.ai-ortho` / `.plugins-ortho` /
`.settings-surface` / insights main rather than growing unscoped rules in mega
`styles.css`. Global forced-colors live in `styles/01-reset.css`; legacy color
aliases under `:root` / `:root[data-theme="dark"]` in `00-tokens.css` — never
reopen a second palette on `.workbench-app.theme-dark`.

## Placement Rules

- Put OS integration, dialogs, child processes, and trusted IPC checks in
  `src/main`.
- Put only the minimal bridge in `src/preload/index.cts`; do not expose
  arbitrary Electron or Node objects.
- Put renderer-only React components and UI helpers in `src/renderer`.
- Put a type in `src/shared` only when main, preload, and renderer all need the
  same boundary definition. Engine payload types come from
  `@translunar/contracts`, not a shared handwritten duplicate.
- Put deterministic unit tests beside the source as `*.test.ts(x)`. Put
  browser/process acceptance tests under `tests/e2e/*.spec.ts`.
- Keep global styling in `src/renderer/styles.css`; use component class names
  already aligned with the workbench shell instead of introducing inline style
  objects for layout.

## Naming And Imports

Use PascalCase for React component files and exports (`Workbench`,
`AssistantPanel`), lower-kebab or descriptive names for utility files
(`workbench-utils.ts`), and `*.cts` only where Electron's CommonJS preload
output requires it. Use type-only imports for types and import generated
contracts from `@translunar/contracts`.

## Source-Backed Examples

- `src/main/engine-client.ts` owns line-delimited request correlation and
  process restart; renderer code calls it only through `DesktopApi`.
- `src/preload/index.cts` exposes `invoke`, source/export dialogs, and restart
  through `contextBridge`.
- `src/renderer/WorkbenchPages.tsx` groups review/export/TM projections while
  `Workbench.tsx` performs the save-before-navigation handoff.
- `tests/e2e/workbench.spec.ts` launches the built Electron app and uses the
  test source/export environment variables rather than mocking the engine.

## Avoid

- Do not import `electron`, `fs`, `path`, or child-process APIs in the renderer.
- Do not create a second `DesktopApi` shape in a component.
- Do not put domain filtering, QA calculation, or persistence in a page.
- Do not place Playwright specs under `src`, where Vitest or the renderer
  TypeScript project can collect them accidentally.
