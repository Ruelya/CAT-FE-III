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

## Renderer Layout (P0 + P1)

`apps/desktop/src/renderer/main.tsx` is the entry. `App.tsx` composes chrome,
boot/recovery gates, and exactly one resolved surface. Domain ownership stays
in the Engine; the renderer is a projection and interaction client.

```text
apps/desktop/src/renderer/
|-- main.tsx
|-- App.tsx
|-- global.d.ts
|-- tokens.css              # appearance custom properties (light / advanced brown)
|-- styles.css              # reset, layout, component primitives
|-- shell/                  # persistent chrome, boot gate, status banner, recovery
|   |-- AppChrome.tsx
|   |-- BootGate.tsx
|   |-- EngineStatusBanner.tsx
|   |-- RecoveryDialog.tsx
|   |-- ConfirmDialog.tsx   # reusable destructive confirm (Cancel-first)
|   `-- ModalDialog.tsx
|-- routes/                 # pure surface decisions (not a URL router)
|   `-- resolveSurface.ts
|-- surfaces/               # workflow screens
|   |-- Welcome.tsx
|   |-- ProjectHome.tsx     # active/archived lists, edit, archive, recycle entry
|   |-- CreateProject.tsx
|   |-- ImportDocument.tsx  # multi-file selectSourceDocuments + batchImport
|   |-- Workbench.tsx
|   |-- QaReview.tsx
|   |-- ExportReview.tsx
|   |-- Templates.tsx
|   |-- RecycleBin.tsx
|   |-- GlobalSearch.tsx
|   `-- ProjectInsights.tsx
|-- workbench/              # editor-specific interaction pieces
|   |-- SegmentGrid.tsx
|   |-- TargetEditor.tsx
|   |-- TmExactPanel.tsx
|   |-- PanelChrome.tsx
|   |-- DocumentSwitcher.tsx
|   `-- BatchImportSummary.tsx
|-- state/                  # cross-surface controller, session, save, recovery
|   |-- app-state.ts
|   |-- use-app-controller.ts
|   |-- session.ts
|   |-- save-coordinator.ts
|   |-- draft-recovery.ts
|   |-- appearance.ts
|   |-- document-navigation.ts  # bounded document.list aggregate, post-delete route
|   |-- template-definition.ts  # unknown-preserving P1 template keys
|   |-- search-navigation.ts    # hit classification
|   `-- analytics-view.ts       # presentation formatting only
|-- lib/                    # typed RPC adapter and pure guards
|   |-- rpc.ts
|   |-- errors.ts
|   `-- ime.ts
`-- test/                   # shared fakes for renderer tests
```

### Boundary meanings

| Directory | Owns | Does not own |
| --- | --- | --- |
| `shell/` | Chrome, boot blocking, Engine status UI, recovery/confirm dialogs | Domain mutations |
| `routes/` | Pure startup/open routing decisions | Side effects, storage, RPC |
| `surfaces/` | Workflow screens and surface-local form UI | Direct `window.translunar` (use controller commands) |
| `workbench/` | Segment grid, target editor, exact-TM panel, document switcher, import summary | Cross-surface navigation policy / flush rules |
| `state/` | App controller, session identity, save coordinator, draft classification, appearance, P1 pure helpers | Engine domain facts |
| `lib/` | Typed `invoke`, UI error projection, IME predicates | React components |

> **Stale paths:** Historical monolith files such as root-level
> `Workbench.tsx`, `WorkbenchPages.tsx`, `SetupView.tsx`, `AssistantPanel.tsx`,
> and `workbench-utils.ts` were removed by the P0 rebuild. Point new work at
> `surfaces/`, `workbench/`, `state/`, and `lib/` above. Do not reintroduce a
> multi-thousand-line root Workbench.

## Placement Rules

- Put OS integration, dialogs, child processes, and trusted IPC checks in
  `src/main`.
- Put only the minimal bridge in `src/preload/index.cts`; do not expose
  arbitrary Electron or Node objects.
- Put renderer-only React components and UI helpers in `src/renderer` under the
  folders above.
- Put a type in `src/shared` only when main, preload, and renderer all need the
  same boundary definition. Engine payload types come from
  `@translunar/contracts`, not a shared handwritten duplicate.
- Put deterministic unit tests beside the source as `*.test.ts(x)`. Put
  browser/process acceptance tests under `tests/e2e/*.spec.ts`.
- Keep appearance tokens in `tokens.css` and layout/component CSS in
  `styles.css`. Prefer class names aligned with the shell over inline style
  objects for layout.

## Naming And Imports

Use PascalCase for React component files and exports (`Workbench`,
`TargetEditor`), lower-kebab or descriptive names for utility modules
(`save-coordinator.ts`, `resolveSurface.ts`), and `*.cts` only where Electron's
CommonJS preload output requires it. Use type-only imports for types and import
generated contracts from `@translunar/contracts`.

New renderer icons import from `@phosphor-icons/react`. Do not add new
`lucide-react` usage under `src/renderer`.

## Source-Backed Examples

- `src/main/engine-client.ts` owns line-delimited request correlation and
  process restart; renderer code calls it only through `DesktopApi`.
- `src/preload/index.cts` exposes `invoke`, source/export dialogs, draft
  journal APIs, and restart through `contextBridge`.
- `src/renderer/state/use-app-controller.ts` owns surface transitions,
  save-before-leave, feature operation tokens, and P1 lifecycle commands;
  `src/renderer/state/save-coordinator.ts` owns draft generations and
  journal/domain flush.
- `src/renderer/lib/rpc.ts` is the only generic Engine invocation adapter.
- `tests/e2e/p0-vertical-slice.spec.ts` and
  `tests/e2e/p1-project-lifecycle.spec.ts` launch the built Electron app with a
  real Engine and isolated user data.
- P1 lifecycle conventions:
  [project-lifecycle.md](./project-lifecycle.md).

## Avoid

- Do not import `electron`, `fs`, `path`, or child-process APIs in the renderer.
- Do not create a second `DesktopApi` shape in a component.
- Do not put domain filtering, QA calculation, or persistence in a page.
- Do not place Playwright specs under `src`, where Vitest or the renderer
  TypeScript project can collect them accidentally.
- Do not revive the pre-rebuild root monolith layout for new features.
