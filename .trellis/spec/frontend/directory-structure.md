# Frontend Directory Structure

## Runtime Layers

The desktop app is one package with explicit Electron boundaries:

```text
apps/desktop/
|-- src/main/       # Electron lifecycle, window chrome helper, trusted IPC, EngineClient
|-- src/preload/    # contextBridge-only DesktopApi exposure
|-- src/shared/     # small cross-runtime public types (desktop-api.ts)
|-- src/renderer/   # React surfaces, presentation state, CSS, local tests
`-- tests/e2e/      # Playwright tests against a built app and real engine
```

## Renderer Layout (P0 + P1 + P2 + P3 + P4)

`apps/desktop/src/renderer/main.tsx` is the entry (after
`appearance-bootstrap.ts`). `App.tsx` composes chrome, boot/recovery gates,
and exactly one resolved surface. Domain ownership stays in the Engine; the
renderer is a projection and interaction client.

```text
apps/desktop/src/renderer/
|-- main.tsx
|-- appearance-bootstrap.ts # pre-React read/apply of appearance-v1
|-- App.tsx
|-- global.d.ts
|-- tokens.css              # solid light/dark tokens + accent operational vars
|-- styles.css              # reset, layout, component primitives
|-- shell/                  # product title strip, boot gate, status, recovery
|   |-- AppChrome.tsx       # title strip + drag region; Assets + P4 nav
|   |-- WindowControls.tsx  # custom min/max/close (non-macOS only)
|   |-- use-window-chrome.ts # trusted DesktopApi window-chrome controller
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
|   |-- Workbench.tsx       # editor + PDF dock gate (P2/P3) + reimport entry
|   |-- AssetHub.tsx        # project-scoped TM|TB|alignment|corpus|catalog|curation
|   |-- QaReview.tsx
|   |-- ExportReview.tsx
|   |-- Templates.tsx
|   |-- RecycleBin.tsx
|   |-- GlobalSearch.tsx
|   |-- ProjectInsights.tsx # analytics | interop | taskPackage sections (P1/P3)
|   |-- AiControl.tsx       # P4 AI Control surface shell
|   |-- Plugins.tsx         # P4 plugins + external connectors
|   |-- Collaboration.tsx   # P4 project-scoped local collab
|   `-- ProductSettings.tsx # P4 locale/appearance/data/updates/tutorial
|-- insights/               # P3 Insights panels (optional folder; not top-level surfaces)
|   |-- InteropReviewPanel.tsx
|   |-- InteropTablePanel.tsx
|   |-- TaskPackagePanel.tsx
|   `-- InsightsSectionNav.tsx
|-- workbench/              # editor-specific interaction pieces
|   |-- SegmentGrid.tsx
|   |-- TargetEditor.tsx
|   |-- TmExactPanel.tsx
|   |-- PanelChrome.tsx
|   |-- DocumentSwitcher.tsx
|   |-- BatchImportSummary.tsx
|   |-- EditorCommandBar.tsx  # compact P2 commands + overflow
|   |-- EditorPanels.tsx      # find/tags/structure/comments/spell/history/prefs/review
|   |-- ActivityBar.tsx       # files / preview / ACP chat rail
|   |-- StructurePreview.tsx  # live reconstruction + optional docx-preview
|   |-- EditorTabs.tsx        # open-document working set
|   |-- SegmentContextMenu.tsx
|   |-- AcpChatPanel.tsx      # ACP session UI over ai.run / conversation
|   |-- PdfPageReview.tsx     # P3 page list + canvas + block overlay
|   `-- PdfOcrCorrectDialog.tsx
|-- state/                  # cross-surface controller, session, save, recovery
|   |-- app-state.ts          # P0–P4 surface kinds (route identity only)
|   |-- use-app-controller.ts # P1–P4 enter/leave + feature-op invalidate gateway
|   |-- session.ts
|   |-- save-coordinator.ts
|   |-- draft-recovery.ts
|   |-- appearance.ts         # appearance-v1 parse/derive/apply (not shell settings)
|   |-- p4-route-context.ts   # P4 return target + project context extractors
|   |-- document-navigation.ts  # bounded document.list aggregate, post-delete route
|   |-- template-definition.ts  # unknown-preserving P1 template keys
|   |-- search-navigation.ts    # hit classification
|   |-- analytics-view.ts       # presentation formatting only
|   |-- editor-operations.ts    # pure mutation apply + command registry + shortcuts
|   |-- use-editor-operations.ts
|   |-- asset-state.ts          # local Asset Hub section state shapes
|   |-- asset-view.ts           # presentation formatting / selection guards
|   |-- use-asset-controller.ts # per-domain list/mutation op tokens
|   |-- pdf-review.ts           # P3 pure: page map, OCR guards, dock mount
|   |-- use-pdf-review.ts
|   |-- interop-view.ts         # P3 pure: eligible rows, TM library filter
|   |-- use-interop-controller.ts
|   |-- task-package-view.ts    # P3 pure: mergePageSelection, terminal guards
|   |-- use-task-package-controller.ts
|   |-- reimport-view.ts        # P3 pure: plan apply guards / disposition counts
|   |-- use-reimport-controller.ts
|   |-- ai-view.ts / ai-events.ts
|   |-- use-ai-controller.ts
|   |-- plugin-view.ts
|   |-- external-connector-request.ts
|   |-- use-plugin-controller.ts
|   |-- collab-view.ts
|   |-- use-collaboration-controller.ts
|   |-- product-settings-view.ts
|   `-- use-product-settings.ts
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
| `surfaces/` | Workflow screens and surface-local form UI | Direct `window.translunar` (use controller commands); TM scoring / alignment algorithms |
| `insights/` | Interop / task-package presentation panels and section nav | ZIP/DOCX/XLSX parse; disposition inventing |
| `workbench/` | Segment grid, target editor, exact-TM panel, document switcher, import summary, editor command/panel chrome, PDF dock chrome | Cross-surface navigation policy / flush rules; PDF byte parse |
| `state/` | App controller, session identity, save coordinator, draft classification, appearance-v1, P1–P4 pure helpers + domain controllers | Engine domain facts; filesystem parse of TMX/TBX/corpus/PDF/packages/plugins |
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
  objects for layout. Appearance preference lives only in versioned renderer
  localStorage (`translunar.renderer.appearance.v1`); apply via
  `appearance-bootstrap.ts` before React and `applyAppearance` on change.

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
  save-before-leave, feature operation tokens, P1 lifecycle commands, Assets/
  Insights entry/return, and P4 AI/Plugins/Collaboration/Settings gateways;
  `src/renderer/state/save-coordinator.ts` owns draft generations and
  journal/domain flush.
- `src/renderer/state/use-editor-operations.ts` and
  `use-asset-controller.ts` own P2 local form/paging/pending state; P4
  `use-ai-controller` / `use-plugin-controller` /
  `use-collaboration-controller` / `use-product-settings` own their domains.
  The app controller must not absorb those forms/projections.
- `src/renderer/lib/rpc.ts` is the only generic Engine invocation adapter.
- `tests/e2e/p0-vertical-slice.spec.ts` through
  `tests/e2e/p4-ai-plugins-settings.spec.ts` launch the built Electron app with
  a real Engine and isolated user data.
- P1 lifecycle conventions:
  [project-lifecycle.md](./project-lifecycle.md).
- P2 editor/Asset Hub conventions:
  [editor-assets.md](./editor-assets.md).
- P3 interop/PDF conventions:
  [interop-pdf.md](./interop-pdf.md).
- P4 AI/plugins/collab/settings + appearance-v1:
  [ai-plugins-settings.md](./ai-plugins-settings.md).

## Avoid

- Do not import `electron`, `fs`, `path`, or child-process APIs in the renderer.
- Do not create a second `DesktopApi` shape in a component.
- Do not put domain filtering, QA calculation, or persistence in a page.
- Do not place Playwright specs under `src`, where Vitest or the renderer
  TypeScript project can collect them accidentally.
- Do not revive the pre-rebuild root monolith layout for new features.
