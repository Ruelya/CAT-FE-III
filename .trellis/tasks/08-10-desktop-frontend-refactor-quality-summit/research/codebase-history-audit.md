# Research: Desktop frontend codebase and Trellis history audit

- Query: What desktop frontend architecture exists now, what did the P0-P4 and custom-titlebar tasks require and claim to ship, which historical residuals remain current, and what evidence should drive the quality-summit plan?
- Scope: internal codebase, Trellis specs, archived task requirements/closeouts, and local UX review guidance; no git history or external web research
- Date: 2026-08-10

## Findings

### Executive result

The desktop frontend is a mature Electron/React application, not a partial scaffold. The current tree contains a typed surface machine, a central application controller, dedicated feature controllers, a typed preload boundary, custom window chrome, versioned appearance tokens, and P0-P4 real-Engine E2E suites. A quality summit should therefore preserve the existing state and Engine-authority contracts and focus on verification, visual/interaction refinement, and deliberately scoped gaps rather than replace the architecture.

The strongest current risks are evidence gaps rather than missing top-level surfaces:

1. Four P3 and three P4 deep E2E cases are fixture-gated. The archived aggregate result was `9 passed / 7 skipped / 0 failed`; skips are explicit and honest, but they are not proof that the deep workflows work against the real Engine (`apps/desktop/tests/e2e/p3-interop-pdf.spec.ts:145`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:329`, `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md:42`).
2. Custom-titlebar runtime proof is Windows-backed. macOS hidden-inset geometry/first-frame behavior and Linux window-manager behavior remain source/unit-backed (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/closeout-summary.md:69`).
3. Renderer CSS contains no width breakpoint; the only `@media` block in `styles.css` is reduced-motion handling. Current viewport assertions start at 1250x744 while the actual BrowserWindow minimum is 1180x700, so the minimum-width, long-identity, dense-toolbar, and modal-overflow matrix needs explicit runtime evidence (`apps/desktop/src/renderer/styles.css:333`, `apps/desktop/src/main/index.ts:398`, `apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:248`).
4. TM/TB import is intentionally absent because the trusted source-document selector excludes TMX/TBX/CSV/TSV. This is a known product-scope decision, not an accidentally dead button; adding it requires a main/preload/shared bridge contract (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/wp0-bridge-note.md:17`, `:21`).
5. Real OS CJK IME plus live Engine-kill/reconnect behavior and exhaustive keyboard replay were accepted as manual/evidence residuals in P0/P1 (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/closeout-summary.md:45`, `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/closeout-summary.md:56`).

Historical closeouts are claims and context, not fresh verification. No build, test, Electron launch, screenshot review, or fixture-backed flow was run during this research pass.

### Files found

#### Current implementation

| File | Description |
| --- | --- |
| `apps/desktop/src/renderer/main.tsx` | Renderer entry; appearance bootstrap and CSS load before `App`, which mounts under React `StrictMode`. |
| `apps/desktop/vite.config.ts` | Renderer root, relative asset base, React plugin, and `dist/renderer` output. |
| `apps/desktop/src/renderer/App.tsx` | Root composition; wires chrome, controller gateways, and one active product surface. |
| `apps/desktop/src/renderer/state/app-state.ts` | Discriminated `AppSurface` model, global application state, actions, reducer, and boot defaults. |
| `apps/desktop/src/renderer/state/use-app-controller.ts` | Boot/reconnect, save-before-transition, lifecycle, document switching, and cross-surface command orchestration. |
| `apps/desktop/src/renderer/state/use-editor-operations.ts` | Workbench editor mutation/read sequencing. |
| `apps/desktop/src/renderer/state/use-asset-controller.ts` | Asset Hub domains and per-domain async ownership. |
| `apps/desktop/src/renderer/state/use-pdf-review.ts` | PDF page/OCR review state. |
| `apps/desktop/src/renderer/state/use-interop-controller.ts` | Interop review/table operations. |
| `apps/desktop/src/renderer/state/use-task-package-controller.ts` | Offline task-package operations. |
| `apps/desktop/src/renderer/state/use-reimport-controller.ts` | Document reimport preview/apply flow. |
| `apps/desktop/src/renderer/state/use-ai-controller.ts` | AI Control operations and projections. |
| `apps/desktop/src/renderer/state/use-plugin-controller.ts` | Plugin lifecycle, permissions, actions, panels, and connectors. |
| `apps/desktop/src/renderer/state/use-collaboration-controller.ts` | Project collaboration operations. |
| `apps/desktop/src/renderer/state/use-product-settings.ts` | Product settings, data, backup/restore, update, and tutorial operations. |
| `apps/desktop/src/renderer/state/p4-route-context.ts` | P4 route context and return-target resolver. |
| `apps/desktop/src/renderer/lib/rpc.ts` | Generic typed Engine invocation through `window.translunar`. |
| `apps/desktop/src/renderer/shell/AppChrome.tsx` | Context-aware navigation and custom title strip. |
| `apps/desktop/src/renderer/tokens.css` | Solid light/dark semantic tokens, advanced-brown seed, spacing, and motion. |
| `apps/desktop/src/renderer/styles.css` | Global shell, surface, workbench, control, focus, and titlebar styling. |
| `apps/desktop/src/renderer/state/appearance.ts` | Versioned appearance parsing, derivation, persistence, and application. |
| `apps/desktop/src/renderer/index.html` | Pre-React light canvas/color-scheme fallback. |
| `apps/desktop/src/shared/desktop-api.ts` | Typed renderer-facing desktop API. |
| `apps/desktop/src/preload/index.cts` | Sandboxed preload exposure and IPC invocation. |
| `apps/desktop/src/main/index.ts` | BrowserWindow, trusted IPC handlers, dialogs, and Engine integration. |
| `apps/desktop/src/main/window-chrome.ts` | Platform-to-titlebar/control policy. |
| `apps/desktop/playwright.config.ts` | Serial Electron E2E configuration. |
| `apps/desktop/tests/e2e/*.spec.ts` | P0-P4 and custom-titlebar built-app acceptance suites. |

#### Historical requirements and evidence

| File | Description |
| --- | --- |
| `.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md` | P0 vertical-slice requirements and acceptance criteria. |
| `.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/closeout-summary.md` | P0 shipped claims and accepted residuals. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/prd.md` | P1 document/lifecycle/search/template requirements. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/closeout-summary.md` | P1 shipped claims, verification summary, and residuals. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md` | P2 editor and Asset Hub requirements. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/wp0-bridge-note.md` | Trusted-dialog capability audit and TM/TB import decision. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/closeout-summary.md` | P2 shipped claims and residuals. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/prd.md` | P3 PDF, interop, task-package, and reimport requirements. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md` | P3 shipped claims, fixture gates, and residuals. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md` | P4 AI, plugins, collaboration, settings, appearance, and E2E requirements. |
| `.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md` | P4 shipped claims, aggregate test result, and residuals. |
| `.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/prd.md` | Custom titlebar platform, accessibility, security, and geometry requirements. |
| `.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/closeout-summary.md` | Custom titlebar implementation evidence and multi-OS residuals. |

### Current architecture and code patterns

#### Renderer entry and surface ownership

- `main.tsx` imports `appearance-bootstrap`, tokens, and global styles before mounting `<App />` in `StrictMode` (`apps/desktop/src/renderer/main.tsx:1`, `:4`, `:11`). Vite uses the renderer directory as its root, a relative base, and `dist/renderer` output (`apps/desktop/vite.config.ts:7`, `:8`, `:16`).
- `SurfaceKind` enumerates boot, recovery, welcome, projects, create/import, workbench, QA, export, templates, recycle, search, insights, assets, AI Control, plugins, collaboration, and settings (`apps/desktop/src/renderer/state/app-state.ts:55`). `AppSurface` is a discriminated union beginning at line 87, so route identity and surface-specific projection are compile-time visible rather than stringly routed.
- Initial state is intentionally non-mutable: Engine status is `connecting`, surface is boot, and `mutationsEnabled` is false (`apps/desktop/src/renderer/state/app-state.ts:325`).
- `App` owns root chrome and renders product surfaces conditionally beneath one stage (`apps/desktop/src/renderer/App.tsx:358`). Boot/recovery live at lines 394-424; welcome through import at 426-509; Workbench at 511-570; QA/export/templates/recycle/search at 572-699; insights/assets at 701-735; P4 surfaces at 737-793.
- P4 route context is not a URL router. Pure context and return-target resolution remain in `p4-route-context.ts` (`apps/desktop/src/renderer/state/p4-route-context.ts:50`, `:91`), matching the P4 decision to retain the application surface machine.

#### Async and navigation ownership

- `use-app-controller` exposes the cross-surface command contract (`apps/desktop/src/renderer/state/use-app-controller.ts:203`) and holds a generation counter used to reject stale work (`:344`, `:378`). Reconnect increments/invalidate generations and snapshots a dirty draft before rehydration (`:735`, `:781`).
- Navigation is guarded through `SaveCoordinator.flush()` (`apps/desktop/src/renderer/state/use-app-controller.ts:1226`). Document switching is an explicit save-before-hydrate path (`:2033`). This is a critical invariant to preserve during any shell or route refactor.
- Feature-heavy domains are already separated into dedicated hooks. Editor, assets, PDF, interop, task packages, reimport, AI, plugins, collaboration, and settings should remain independently owned rather than being folded back into `App.tsx` or a new global store.
- Renderer Engine calls use generic generated method/params/result types and route through `window.translunar` (`apps/desktop/src/renderer/lib/rpc.ts:14`, `:18`, `:22`). Durable domain state should therefore remain Engine-owned.

#### Electron boundary and titlebar

- The BrowserWindow defaults to 1400x860 with an 1180x700 minimum, a light fallback background, and a platform-derived titlebar style (`apps/desktop/src/main/index.ts:398`). Security preferences are `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true` (`:408`).
- The renderer-facing API types window controls in `desktop-api.ts` (`apps/desktop/src/shared/desktop-api.ts:129`). Preload exposes invoke-only methods (`apps/desktop/src/preload/index.cts:255`). Main registers minimize/maximize-toggle/close handlers (`apps/desktop/src/main/index.ts:1143`).
- Platform policy is explicit: macOS maps to `hiddenInset`; non-macOS maps to `hidden` plus custom renderer controls (`apps/desktop/src/main/window-chrome.ts:31`). The later titlebar task supersedes P4's earlier note that the default Electron frame remained.
- `AppChrome` uses Phosphor icons (`apps/desktop/src/renderer/shell/AppChrome.tsx:13`), supplies `aria-label` and `title`, and marks active navigation with `aria-current` (`:161`, `:163`, `:179`, `:181`).
- The product title strip is draggable while controls are no-drag (`apps/desktop/src/renderer/styles.css:197`, `:205`, `:286`, `:293`). Window control width is a stable 46px (`:297`), and close hover/active states use semantic error tokens (`:323`).

#### Appearance, accessibility, and layout

- Appearance is light-first with default accent seed `#765847` (`apps/desktop/src/renderer/tokens.css:6`, `:27`; `apps/desktop/src/renderer/state/appearance.ts:19`). Dark tokens begin at `tokens.css:87`; reduced-motion overrides zero the motion durations at `:119`.
- Global keyboard focus is visible through the shared focus ring (`apps/desktop/src/renderer/styles.css:180`). Icon-only chrome controls are named as described above.
- A static renderer search found no production `backdrop-filter`, `-webkit-backdrop-filter`, or `lucide-react` import. The only backdrop-filter matches are negative assertions in `appearance.test.ts` (`apps/desktop/src/renderer/state/appearance.test.ts:176`).
- `lucide-react` remains declared in `apps/desktop/package.json:24` despite no renderer import. This is a cleanup candidate, not evidence of a rendered icon-system regression.
- `styles.css` has no width-dependent media query; its only media block is `prefers-reduced-motion` (`apps/desktop/src/renderer/styles.css:333`). The shell also has a real minimum of 1180x700, while existing visual/overflow E2E coverage explicitly checks 1250x744, 1680x942, and 1920x1080 (`apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:248`). Add 1180x700 and long localized/identity content to the summit matrix.
- Generic `.btn--icon` controls are fixed at 32px (`apps/desktop/src/renderer/styles.css:439`). This is deliberate in parts of the dense editor geometry, so it should be usability-tested by context instead of globally resized without checking row/tool layout. Window controls already use a larger stable width.
- Functional state copy such as loading, empty, and error messages remains necessary. No exact forbidden `不是` contrast-pivot phrase was found in the renderer. Future copy should remain operational and concise rather than adding explanatory or guiding microcopy.

### Historical requirement audit

#### P0: vertical slice

- The P0 goal was a production-quality retained workflow with accessible, RPC-resilient, IME-safe, coherent surfaces (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/prd.md:14`, `:27`). Its surface map covered boot/recovery through export (`:43`, `:49`), and acceptance criteria covered routing, Engine state, recovery, edit/confirm/IME, QA/export, appearance, accessibility, and real-Engine E2E (`:170`).
- The closeout claims the shell/boot, lifecycle path, edit safety, QA/export, appearance, accessibility, and real-Engine flow shipped (`.trellis/tasks/archive/2026-08/08-08-frontend-rebuild-p0-vertical-slice/closeout-summary.md:8`).
- Still relevant: real OS Chinese/Japanese IME and an unexpected live Engine process kill were not manually executed; dedicated confirm and QA-active reconnect assertions were deferred (`:41`, `:45`, `:47`).
- Superseded: the P0 note that AI, multi-document management, task packages, and other later features were out of slice was subsequently addressed by P1-P4 and should not be reopened as a P0 defect (`:48`).

#### P1: project lifecycle

- P1 extended P0 with document switching, batch import, templates, recycle, search, insights, examples, and project lifecycle while preserving save/reconnect/IME contracts (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/prd.md:16`, `:18`, `:48`). Acceptance criteria run through the real-Engine/manual matrix at lines 183-212.
- The closeout records S9-S16 as shipped and reports a focused real-Engine Playwright matrix of 5/5 (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p1-project-lifecycle/closeout-summary.md:15`, `:22`, `:37`).
- Still relevant: forced Engine failure/picker-cancel/reconnect races were not fully replayed in Playwright; every new control was not exhaustively keyboard-replayed; the manual `pnpm dev:desktop` transcript was waived (`:54`, `:56`, `:57`, `:58`).

#### P2: editor and assets

- P2 established the professional editor operation boundary and six-section Asset Hub with generated Engine authority (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/prd.md:17`, `:34`, `:50`).
- The bridge audit found `selectSourceDocument()` excludes `tmx`, `tbx`, `csv`, and `tsv`; the explicit decision was to omit TM/TB import controls rather than ship a dead or untrusted path (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/wp0-bridge-note.md:17`, `:21`). Current source still exposes corpus import but no TM/TB import route (`apps/desktop/src/renderer/state/use-asset-controller.ts:1855`, `apps/desktop/src/renderer/surfaces/AssetHub.tsx:1114`).
- The closeout reports 215/215 desktop Vitest and a real six-section destination (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p2-editor-assets/closeout-summary.md:23`, `:35`).
- Still relevant: catalog/curation E2E remained presence-level, with exact parameters and rollback owned primarily by controller tests (`:87`, `:92`). The test-only `require-await` note is historical lint debt, not a known product behavior defect (`:91`).

#### P3: PDF, interop, task packages, and reimport

- P3 locked PDF review into a Workbench dock, interop/task packages into Project Insights, and reimport into a document action rather than new top-level routes (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/prd.md:181`, `:182`, `:183`). Acceptance criteria require real Engine evidence (`:163`, `:174`).
- The closeout reports the implementation and regression suites green but records four honest P3 fixture skips (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md:22`, `:34`). The actual gates are at `apps/desktop/tests/e2e/p3-interop-pdf.spec.ts:145`, `:177`, `:228`, and `:275`.
- Still relevant: full PDF OCR, interop review, interop table, and task-package input paths need their named fixtures and, for PDF, Poppler/Tesseract (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md:84`).
- Still current: reimport entry is Workbench-only. The current root only passes reimport into Workbench (`apps/desktop/src/renderer/App.tsx:529`), and the button lives in `surfaces/Workbench.tsx:181`.
- Lower priority polish remains documented: task-package confirmation presentation, PDF re-list after generation invalidation, and a defensive interop disposition check (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p3-interop-pdf/closeout-summary.md:89`).

#### P4: AI, plugins, collaboration, settings, and appearance

- P4 explicitly inherited the surface machine, generated RPC, SaveCoordinator/IME, save-before-navigation, reconnect guards, Phosphor, and solid appearance contracts (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/prd.md:3`, `:7`, `:20`). It required real routing plus fixture-aware real-Engine E2E (`:24`, `:110`, `:116`, `:118`).
- The closeout reports the four P4 product areas, 275 unit tests, and P0-P4 Playwright at `9 passed / 7 fixture-skipped / 0 failed` (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md:14`, `:40`, `:42`).
- Three P4 deep cases still skip unless `TRANSLUNAR_P4_LOOPBACK_AI`, `TRANSLUNAR_P4_PLUGIN_FIXTURE`, and `TRANSLUNAR_P4_CONNECTOR_FIXTURE` are set (`apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:329`, `:362`, `:390`). The closeout correctly labels these skips as not-pass evidence (`.trellis/tasks/archive/2026-08/08-10-frontend-rebuild-p4-ai-plugins-settings/closeout-summary.md:97`).
- Some controller/session suites remained thinner than the implementation plan, and the renderer emitted an approximately 693 kB chunk warning (`:98`, `:100`). Both should be reassessed against current build output before being carried forward as active findings.
- Superseded: P4's `default Electron frame remains` titlebar note (`:99`) was closed by the later custom-titlebar task and is not current architecture.

#### Custom titlebar follow-up

- Requirements cover Windows custom controls, macOS native traffic lights with hidden inset, explicit Linux behavior, drag/no-drag regions, appearance tokens, accessible names, and supported-width geometry (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/prd.md:15`, `:19`, `:21`, `:22`, `:23`, `:31`). Acceptance criteria are at lines 42-50.
- The closeout claims platform mapping, trusted IPC, renderer controller, accessible Phosphor controls, drag styling, and focused Windows native probe evidence shipped (`.trellis/tasks/archive/2026-08/08-10-desktop-custom-titlebar/closeout-summary.md:11`, `:13`, `:15`). Current code matches those structural claims.
- Still relevant: macOS first-frame/traffic-light geometry and Linux/Xvfb behavior lack host runtime evidence. Physical drag-pixel movement, Space-key activation, the full dark/custom-accent long-identity matrix, and a negative forged-IPC runtime probe were not instrumented (`:69`, `:71`, `:72`, `:73`).

### Current quality priorities

| Priority | Evidence gap or decision | Planning consequence |
| --- | --- | --- |
| P0 | P3/P4 fixture-backed real-Engine paths are skipped | Provision named fixtures/tools and require observable workflow assertions; do not convert skips into passes or mock persistence. |
| P0 | macOS/Linux titlebar behavior is not host-proven | Add platform-gated built-app verification on actual runners; keep Windows source/unit coverage green. |
| P0 | Active task requirements and acceptance criteria are still `TBD` | Convert this audit into explicit, bounded quality criteria before implementation (`.trellis/tasks/08-10-desktop-frontend-refactor-quality-summit/prd.md:5`, `:11`). |
| P1 | 1180x700 minimum, long identity/localized labels, dense toolbars, and dialogs lack a complete geometry matrix | Add screenshot plus overflow/focus/keyboard assertions at the real minimum and existing three supported viewports. |
| P1 | Real OS IME, live Engine kill/reconnect, and exhaustive keyboard paths remain manual residuals | Define a manual or automated host matrix with transcript/evidence; preserve generation and save-order invariants. |
| P1 | TM/TB import is absent by contract | Decide whether the summit includes this product expansion. If yes, plan shared API/main/preload/renderer ownership and trusted filters; if no, preserve the honest omission. |
| P1 | Catalog/curation and some P4 controller depth were historically thinner | Review current tests against high-risk mutation, rollback, secret, permission, and stale-response paths before adding broad snapshots. |
| P2 | 32px generic icon controls may be tight outside dense editor contexts | Audit actual usage and pointer/keyboard ergonomics contextually; avoid a global size change that destabilizes editor geometry. |
| P2 | Historical renderer chunk warning around 693 kB | Rebuild and measure current chunks; only then decide whether route/module splitting is worth complexity. |
| P3 | `lucide-react` is declared but unused in renderer source | Remove only after confirming no non-renderer/package consumer depends on it. |
| P3 | Optional P3 confirmation/re-list defensive polish | Address after the evidence and interaction blockers above. |

### Test inventory and validation map

- Current inventory by filename count: 36 renderer test files, 12 main-process test files, and 6 Electron E2E specs.
- Playwright is serial (`fullyParallel: false`, one worker), uses a 60-second test timeout, and retains traces on failure (`apps/desktop/playwright.config.ts:4`, `:5`, `:7`, `:8`, `:11`).
- P1 has a reusable horizontal-overflow assertion and compact 1250x744 checks (`apps/desktop/tests/e2e/p1-project-lifecycle.spec.ts:105`, `:183`, `:242`, `:368`).
- P4 tests appearance/overflow at 1250x744, 1680x942, and 1920x1080 (`apps/desktop/tests/e2e/p4-ai-plugins-settings.spec.ts:248`).
- Package-scoped commands available from `apps/desktop/package.json:9-15`:
  - `pnpm --filter @translunar/desktop test`
  - `pnpm --filter @translunar/desktop typecheck`
  - `pnpm --filter @translunar/desktop build`
  - `pnpm --filter @translunar/desktop test:e2e`
- Final repository gates required by `.trellis/spec/frontend/quality-guidelines.md` are `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm test:e2e:desktop`. A focused Playwright invocation reuses the current build, so rebuild after DOM/CSS changes.

### Planning boundaries

Keep work ownership isolated to reduce regression risk:

- Shell/runtime/titlebar: `apps/desktop/src/main`, `src/preload`, `src/shared`, `src/renderer/shell`, `tokens.css`, `styles.css`, and appearance bootstrap/state.
- App routing/integration: `App.tsx`, `state/app-state.ts`, `state/use-app-controller.ts`, and `state/p4-route-context.ts`.
- Workbench/P2/P3: `surfaces/Workbench.tsx`, `workbench/*`, Asset Hub, and the editor/PDF/interop/task/reimport controllers.
- Lifecycle/insights: project/template/recycle/search/insights surfaces plus their pure state helpers.
- P4: AI, plugins, collaboration, and settings surfaces/controllers.
- Verification: `apps/desktop/src/**/*.test.*` and `apps/desktop/tests/e2e/*`; use real Engine for persistence claims.

Avoid a root `App.tsx` rewrite, URL-router migration, new global store, renderer-side domain persistence, or broad bridge widening unless a scoped acceptance criterion requires it. Existing specs explicitly treat the surface machine, Engine authority, generation-scoped async work, and save-before-navigation as contracts.

### External references and version context

- No external web documentation was consulted. This audit is source- and Trellis-history-backed.
- Local review lens: the `ui-ux-pro-max` skill was read for desktop interaction, accessibility, responsive constraint, and stable control-dimension checks. It did not override repository-specific dense-editor or Electron contracts.
- Relevant pinned/current package versions: React 19.2.7 (`apps/desktop/package.json:25`), Electron 41.10.3 (`:40`), Vite 8.1.5 (`:45`), Playwright 1.61.1 (`:30`, `:43`), Vitest 4.1.10 (`:46`), TypeScript 6.0.3 (`:44`), and Phosphor React `^2.1.10` (`:21`).

### Related specs

- `.trellis/spec/frontend/index.md` - package routing and pre-development checklist.
- `.trellis/spec/frontend/electron-workbench.md` - Electron/renderer boundaries, Workbench, custom titlebar, and E2E contracts; titlebar residual notes begin at line 614.
- `.trellis/spec/frontend/project-lifecycle.md` - multi-document, import, templates, recycle/lifecycle, search, and save-before-navigation contracts.
- `.trellis/spec/frontend/editor-assets.md` - editor mutation ordering, Asset Hub async ownership, file boundary, and the dead-TM-import prohibition (`:527`).
- `.trellis/spec/frontend/interop-pdf.md` - P3 boundaries and fixture keys (`:134`), contracts (`:149`), and tests (`:270`).
- `.trellis/spec/frontend/ai-plugins-settings.md` - P4 source layout (`:38`), route/controller/appearance boundaries, visual locks (`:358`), E2E (`:447`), and residual notes (`:575`).
- `.trellis/spec/frontend/component-guidelines.md` - component shape, Phosphor (`:60`), appearance tokens (`:86`), accessibility/layout (`:172`), and UI copy (`:200`).
- `.trellis/spec/frontend/state-management.md` - ownership (`:3`), SaveCoordinator (`:75`), operation tokens (`:131`), and reconnect (`:174`).
- `.trellis/spec/frontend/quality-guidelines.md` - automated gates, fixture-aware E2E, accessibility, visual review, and forbidden static patterns.
- `.trellis/spec/frontend/type-safety.md` - generated contract and boundary typing rules.

## Caveats / Not Found

- Research scope prohibited git operations. No commit graph, diff chronology, blame, or recent-commit audit was performed. In this document, "history" means archived Trellis PRDs and closeouts. The orchestrator should inspect recent commits separately if commit-level provenance is required.
- `implement.jsonl` and `check.jsonl` were not read.
- Archived closeout test counts were not rerun. They establish prior evidence and accepted residuals only.
- No live Electron session, screenshot comparison, axe run, keyboard replay, OS IME session, Engine-kill test, macOS/Linux host test, or canvas/pixel inspection was performed in this research role.
- Fixture availability was not tested. The named skip gates remain the authoritative indication that seven deep cases may be absent from a default run.
- No production `lucide-react` renderer import or forbidden glass CSS was found. The package dependency itself remains and needs consumer confirmation before removal.
- No dedicated width breakpoint was found in `styles.css`; this is a verification risk, not by itself a defect, because the application enforces an 1180px minimum width.
- The active task PRD still has `TBD` requirements and acceptance criteria. Implementation should not begin until planning converts the evidence above into explicit scope and measurable acceptance conditions.
