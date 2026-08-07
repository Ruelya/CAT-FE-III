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
owns surface/session orchestration; `SetupView.tsx`, `Workbench.tsx`,
`WorkbenchPages.tsx`, and `AssistantPanel.tsx` own visible feature areas.
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

Grid keyboard/selection lives in `hooks/useRovingGrid.ts`. Shared interaction
math lives in `workbench-utils.ts` with colocated tests (including
`restorePaletteOwnerFocus`). Stack/dock surface CSS:
`styles/30-surfaces/workbench-stack.css`.

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
