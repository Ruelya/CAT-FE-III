# Design — Frontend rebuild P0 vertical slice

## 1. Design summary

The renderer is a typed projection and interaction client over the existing preload `DesktopApi`. A small React state machine owns startup routing and cross-surface coordination; individual surfaces own only transient form/UI state. All durable domain facts are fetched from the Engine.

The design deliberately avoids a route library, state library, Tailwind, theme framework, and animation dependency. React, TypeScript, CSS custom properties, the existing test stack, and Phosphor are sufficient for P0.

## 2. Fixed constraints

- Main, preload, `DesktopApi`, generated contracts, and Engine behavior are authoritative.
- P0 Engine ledger is limited to:
  - `engine.initialize`
  - `project.create`, `project.list`, `project.get`
  - `document.import`, `document.list`, `document.get`
  - `segment.editor.list`, `segment.editor.updateTarget`, `segment.editor.confirm`
  - `tm.lookupExact`
  - `qa.run`, `qa.issue.list`, `qa.gate.check`
  - `document.export`
- Direct preload use is limited to `invoke`, source/export pickers, draft journal APIs, Engine status/restart/reconnect, and only shell/locale reads actually required by canonical project defaults.
- `ProductShellSettings` is not extended. Its update path remains locale-only. Theme/accent never enters shell settings.
- Light and advanced brown are fixed P0 appearance defaults.
- New renderer iconography is Phosphor even though the current long-term frontend spec names Lucide; closeout will reconcile that spec.
- No out-of-scope feature receives a navigation item, disabled placeholder, route, or empty shell.

## 3. Proposed source boundaries

```text
apps/desktop/src/renderer/
  main.tsx
  App.tsx
  global.d.ts
  styles.css
  tokens.css
  shell/
    AppChrome.tsx
    BootGate.tsx
    EngineStatusBanner.tsx
    RecoveryDialog.tsx
  routes/
    resolveSurface.ts
    resolveSurface.test.ts
  surfaces/
    Welcome.tsx
    ProjectHome.tsx
    CreateProject.tsx
    ImportDocument.tsx
    Workbench.tsx
    QaReview.tsx
    ExportReview.tsx
  workbench/
    SegmentGrid.tsx
    TargetEditor.tsx
    TmExactPanel.tsx
    PanelChrome.tsx
  state/
    app-state.ts
    use-app-controller.ts
    session.ts
    session.test.ts
    save-coordinator.ts
    draft-recovery.ts
    appearance.ts
    appearance.test.ts
  lib/
    rpc.ts
    errors.ts
    ime.ts
    ime.test.ts
  test-setup.ts
```

The exact split may be consolidated when a file would otherwise be trivial, but boundaries must remain recognizable:

- `shell`: persistent chrome, startup/reconnect/recovery containment;
- `routes`: pure surface decisions, not URL routing;
- `surfaces`: workflow-level screens;
- `workbench`: editor-specific interaction components;
- `state`: cross-surface controller, session, save, recovery, and appearance defaults;
- `lib`: typed bridge adapter and pure guards.

Tests should be colocated with pure units/components where current Vitest configuration permits. The new desktop Playwright spec belongs in the existing path included by `tsconfig.e2e.json`; implementation should confirm that path rather than alter test infrastructure unnecessarily.

## 4. Application composition

`main.tsx` retains React Strict Mode and `createRoot`. `App.tsx` becomes composition only:

1. construct the app controller;
2. render `AppChrome` with Engine status;
3. render a blocking `BootGate` or `RecoveryDialog` when applicable;
4. render exactly one resolved surface;
5. expose surface transitions through controller commands, not direct storage/RPC calls scattered through components.

The state controller uses `useReducer` plus focused hooks. No global third-party store is required because there is one Electron window and a bounded surface graph. Surface-local fields, disclosure state, and focus state remain local unless a transition must preserve them.

## 5. State ownership

| State | Owner | Persistence | Rule |
| --- | --- | --- | --- |
| Projects, documents, segments, revisions, statuses, counts, TM, QA, export result | Engine | Engine | Render returned facts; re-fetch after mutations. |
| Active project/document identity | App controller | Versioned `localStorage` identity only after a usable document exists | Validate through RPC before use. |
| Target draft and dirty/saving/error state | Save coordinator / target editor | Preload DraftJournal while pending | Never claim domain confirmation from local state. |
| Active segment and focused control | Workbench | Memory | Disposable interaction state. |
| Exact-TM panel collapsed state | Workbench | Optional namespaced local UI preference | Disposable UI preference only. |
| Light theme and advanced-brown accent | Appearance constants + CSS tokens | None in P0 | Fixed defaults; no settings UI. |
| Engine connection state | Preload events + startup RPC | Memory | Revalidate after reconnect. |
| Current surface | App controller | Derived from state/session | No URL or route snapshot persistence. |
| Form fields/errors | Owning surface | Memory | Preserve while a failed request remains on that surface. |

## 6. Surface state machine

Use a discriminated union so impossible surface payloads do not compile. Conceptual states:

- `boot`
- `recovery`
- `welcome`
- `projects`
- `create-project`
- `import-document(projectId)`
- `workbench(session)`
- `qa(session)`
- `export(session)`

Engine status is orthogonal to the surface. A transient reconnect overlays/banner-disables unsafe operations while preserving the current projection. A fatal initial failure remains in `boot` with Retry/Restart.

### Allowed transitions

| From | Event | To | Preconditions |
| --- | --- | --- | --- |
| Boot | no valid session + no projects | Welcome | `engine.initialize` and `project.list` succeeded. |
| Boot | no valid session + projects | Projects | Engine list succeeded. |
| Boot | valid session | Workbench | `project.get`, `document.get`, and segment hydration succeeded. |
| Boot | non-empty draft | Recovery | Engine is available; journal has been classified. |
| Recovery | recover valid draft | Workbench | Journal identities validated; draft attached as dirty local text. |
| Recovery | discard | startup resolution | `clearDraftJournal` succeeded, or failure is shown and transition is withheld. |
| Welcome/Projects | create | Create project | No pending transition. |
| Projects | open empty project | Import document | Project validated; `document.list` is empty. |
| Projects | open project with docs | Workbench | Selected Engine document validates and hydrates. |
| Create project | create success | Import document | Returned project identity is valid. |
| Import document | import success | Workbench | Session identity persisted only after authoritative hydration succeeds. |
| Workbench | QA | QA | Pending target update flush succeeded. |
| Workbench | Export | Export | Pending target update flush succeeded. |
| QA/Export | back to Workbench | Workbench | Session revalidated/retained; requested issue focus applied after render. |
| Any session surface | Home | Welcome/Projects | Workbench save flush succeeds, session identity is intentionally cleared, then `project.list` resolves Home. |
| Any | Engine reconnected | same logical surface | Current identity revalidated and projection rehydrated first. |
| Any session surface | identity invalid | Welcome/Projects | Session key cleared, then project list resolves Home. |

Navigation commands are asynchronous. The controller changes the surface only after its preconditions complete. This is the mechanism that enforces save-before-leave.

## 7. Startup and reconnect flow

### 7.1 Cold start

1. `index.html`/root CSS supplies the same light background as `--color-canvas`; no dark scaffold color remains.
2. Subscribe to `onEngineStatus` and `onEngineReconnected` with cleanup safe under Strict Mode remounts.
3. Invoke `engine.initialize` through the typed RPC adapter.
4. Read the DraftJournal and parse the versioned session identity independently. A malformed session never throws out of render.
5. If a session candidate exists, validate project and document through RPC and hydrate segment data.
6. Classify any journal against hydrated identities:
   - recoverable: show Recovery with Recover and Discard;
   - stale/unresolvable: show a typed recovery error with Retry validation and explicit Discard; never label it recovered;
   - empty: continue.
7. If no valid session remains, clear invalid storage and invoke `project.list` to select Welcome or Project Home.
8. Release `BootGate` only after one complete destination is ready.

Startup operations carry a generation number. Results from an older retry/reconnect generation are ignored.

### 7.2 Engine status behavior

- **Connected:** all actions allowed according to local pending state.
- **Connecting/reconnecting:** retain projection, show a status banner, disable domain mutations and new navigation transitions.
- **Disconnected/failed:** retain recoverable local draft, show typed failure and Retry/Restart actions.
- **Reconnected event:** increment startup generation, reinitialize if required by the bridge contract, validate the active identities, and rehydrate. Only then return to Connected.

`restartEngine` is a bridge operation; it does not itself count as successful recovery. The renderer waits for status/reconnect evidence and hydration.

## 8. Session contract

Use a constant key such as `translunar.renderer.session.v1` and a JSON value with an explicit schema:

```ts
{
  version: 1;
  projectId: string;
  documentId: string;
}
```

The implementation should use canonical ID aliases when exported by contracts. The parser accepts only a plain object, exact supported version, and non-empty string IDs. It returns a result union rather than throwing. Unknown properties may be ignored on read, but only the canonical shape is written.

A syntactically valid identity becomes active only after:

1. `project.get` succeeds;
2. `document.get` succeeds and belongs to the project according to canonical data/request constraints;
3. `segment.editor.list` succeeds for that document.

If validation proves the identity no longer exists or is recycled, clear the key. Transport outages do not clear a potentially valid session; they remain a recoverable boot error.

No session key is written immediately after project creation because Workbench cannot resume without a document. After import/open hydration succeeds, write the session atomically. Panel preference, if persisted, uses a separate versioned UI key and never shares the session object.

### Existing project with multiple documents

P0 has no document manager. On Open with no stored document identity:

- call `document.list` for that project;
- zero documents → Import;
- one or more → select the first item in Engine-provided order, validate/hydrate it, then persist that exact identity.

The renderer must not sort by invented “recent” metadata. This deterministic fallback is a P0 trade-off and is covered as an assumption in the PRD.

## 9. Typed RPC boundary

`lib/rpc.ts` is the only generic Engine invocation adapter. It should:

- derive method names and request/response types from the intact Desktop API/contracts wherever possible;
- call `window.translunar.invoke` without duplicating protocol schemas;
- preserve canonical error code/message/details in a renderer `UiError` projection;
- avoid `any`, unchecked casts, and stringly typed method wrappers;
- let callers distinguish domain rejection, transport disconnection, user cancellation, and stale response suppression.

Picker and journal methods remain direct typed `DesktopApi` calls through small feature adapters where coordination is useful. Components receive commands/data; they do not call `window.translunar` directly.

## 10. Method ledger and data flow

| Operation | Trigger | Call sequence | Renderer result |
| --- | --- | --- | --- |
| Initialize | Cold boot, retry/reconnect as required | `engine.initialize` | Gate startup; do not synthesize connected status. |
| Resolve Home | No validated session | `project.list` | Empty → Welcome; non-empty → Project Home. |
| Validate project | Open/resume | `project.get` | Continue only with returned project. |
| Create | Create form submit | `project.create` | Keep returned project ID in memory; route Import. |
| Open project | Project row Open | `project.get` → `document.list` | Empty → Import; otherwise validate selected Engine-returned document. |
| Validate/hydrate document | Resume/open/import | `document.get` → `segment.editor.list` | Build Workbench projection; write session only after success for new/open paths. |
| Import | Import action | `selectSourceDocument` → `document.import` → document/segment hydrate | Cancel is no-op; success enters Workbench. |
| Save target | Debounce, blur, confirm, or leave | `segment.editor.updateTarget` | Acknowledge only submitted draft generation; refresh affected authoritative data as needed. |
| Confirm | Button/shortcut | flush target → `segment.editor.confirm` → `segment.editor.list` | Update status/counts from Engine; focus next only after success. |
| Exact TM | Active segment changes | `tm.lookupExact` | Render result only if request/session/segment generation is still current. |
| Run QA | QA Run | flush if entering from editor → `qa.run` → `qa.issue.list` | Render Engine issues/empty state. |
| Refresh issues | QA re-entry/retry | `qa.issue.list` | Replace issue projection from Engine. |
| Export | Export action | flush before entry → `qa.gate.check` → on pass `selectExportPath` → `document.export` | Failed gate blocks picker/export; canceled picker is no-op. |
| Reconnect | `onEngineReconnected` | validate session → rehydrate current context; refresh QA if on QA | Preserve draft and surface intent; re-enable after success. |

Optional `getSystemLocale`/`getShellSettings` may initialize a required project locale only if the canonical `project.create` request needs it. They must not become settings UI or appearance persistence. `updateShellSettings` is unused.

## 11. Save coordinator, draft journal, and concurrency

### 11.1 Local edit model

For the active editable segment, track:

- `engineTarget`: last authoritative target text;
- `draftTarget`: current input text;
- `editGeneration`: incremented per local input;
- `savedGeneration`: latest Engine-acknowledged generation;
- `saveState`: idle, scheduled, saving, or error;
- `isComposing`.

A local draft is allowed because the input must remain responsive. It is visually/presentationally distinct from confirmed Engine status.

### 11.2 Journal and update sequence

1. On input outside no special mutation restriction, update `draftTarget` and generation in memory.
2. Queue the latest draft to `writeDraftJournal` through a trailing short write (approximately 150 ms) to avoid IPC per keystroke; flush it on blur/navigation/confirm.
3. Queue `segment.editor.updateTarget` through a trailing save (approximately 300–400 ms), with one in-flight mutation per active segment.
4. If text changes while a save is in flight, acknowledge only the submitted generation and retain the newer draft as dirty.
5. After an Engine update succeeds and no newer generation exists, clear the matching draft journal. If journal clear fails, surface recovery-state error without falsely marking the Engine update failed.
6. On update failure, retain the draft/journal and typed error. Retry always submits the latest generation.

Exact timings are implementation constants, not domain rules; fake timers cover them.

### 11.3 Confirm

The shared confirm command:

1. returns without side effects if composition is active or the originating keyboard event has `keyCode`/`which` 229;
2. flushes journal write and latest `updateTarget`;
3. stops on save failure;
4. invokes `segment.editor.confirm` once;
5. refreshes authoritative segments/counts;
6. advances focus only if the same document/segment command is still current and confirmation succeeded.

The explicit Confirm button is disabled while composition is active and also calls the guard defensively. Keyboard handling must not use `preventDefault` for a rejected composition event in a way that disrupts the IME.

### 11.4 Leave Workbench

`requestTransition(destination)` calls `saveCoordinator.flush()` before changing state. A rejection:

- leaves `surface` as Workbench;
- leaves input text/focus recoverable;
- renders a typed error associated with the transition;
- makes no QA/export/home call.

Window/app close is protected by the DraftJournal; this task does not add a new main-process close interception contract.

## 12. IME guard contract

`lib/ime.ts` contains pure event predicates and a tiny composition state helper used by `TargetEditor`.

Guarded cases:

- between `compositionstart` and `compositionend`;
- keyboard event `isComposing === true`;
- keyboard `keyCode === 229` or `which === 229` for compatibility;
- pending confirmation already in progress.

No guarded case may call update, confirm, move focus, or mutate selection. Tests must assert both negative side effects during composition and successful confirmation after composition ends.

## 13. Workbench composition

### 13.1 Chrome

Persistent chrome is compact and functional:

- brand mark/name;
- current project/document identity when available;
- connection status/recovery affordance;
- Home, QA, and Export actions only where valid.

There is no global sidebar full of future modules.

### 13.2 Main stage

Desktop workbench layout:

- top document/action bar;
- main segment grid occupying available width/height;
- right exact-TM panel, approximately 300–340 px when open and a compact named rail when collapsed.

The grid uses stable segment IDs as keys and semantic row/cell structure where practical. Columns are source, target editor, and Engine status. Selection styling never substitutes for focus styling. If the canonical list API exposes pagination, the renderer follows it rather than silently truncating; P0 does not introduce a virtualization dependency without evidence it is needed.

### 13.3 QA and export

QA and Export are focused workbench-adjacent surfaces under the same chrome. They are not settings dialogs or side panels layered over an unsaved editor. Entering them uses the transition flush contract.

- QA: Run action, concise issue list, conditional Jump, empty/error states.
- Export: gate status, path-selection action after pass, export pending/result/error state, return to QA/Workbench.

## 14. Visual system

### 14.1 Token contract

`tokens.css` owns appearance variables; `styles.css` owns reset/layout/component primitives. Proposed defaults:

| Token | Value | Role |
| --- | --- | --- |
| `--color-canvas` | `#F4F1EC` | Window background |
| `--color-surface` | `#FBFAF7` | Primary panels |
| `--color-surface-raised` | `#FFFDF9` | Raised controls/cards |
| `--color-surface-subtle` | `#ECE6DE` | Secondary rows/panels |
| `--color-border` | `#D8D0C5` | Standard division |
| `--color-border-strong` | `#B7AA9C` | Active structure |
| `--color-text` | `#261F1A` | Primary text |
| `--color-text-muted` | `#6B6158` | Secondary functional text |
| `--color-accent` | `#765847` | Primary advanced-brown action/focus family |
| `--color-accent-hover` | `#624638` | Accent hover |
| `--color-accent-active` | `#513A2E` | Accent pressed |
| `--color-accent-soft` | `#EBE0D6` | Selected/quiet accent surface |
| `--color-success` | `#2F7650` | Semantic success |
| `--color-warning` | `#96651C` | Semantic warning |
| `--color-error` | `#A83F3F` | Semantic error |
| `--color-focus` | `#765847` | Visible focus ring |

Brand-mark-only ribbon variables preserve the documented values:

- Burnt Orange `#D9562B`
- Solar Ochre `#D29A2E`
- Lichen Green `#87904A`
- Instrument Teal `#4F8076`
- Dusk Blue `#526F86`

Solid colors define surfaces. Alpha may be used for a conventional shadow, but not for translucent panel material. `backdrop-filter` and `-webkit-backdrop-filter` are forbidden.

### 14.2 Scale

- Typography: system desktop stack headed by Segoe UI Variable/Segoe UI; compact numeric/status styles; no webfont loading dependency.
- Spacing: 4, 8, 12, 16, 24, 32 px.
- Radius: restrained 6, 10, 14 px; avoid pill treatment except true status chips.
- Elevation: 1 px borders, tonal separation, and at most two restrained shadow levels.
- Motion: approximately 120 ms feedback and 180–220 ms shell/surface transitions; transform/opacity only where useful.
- `prefers-reduced-motion: reduce`: transitions/animations collapse to effectively immediate and no spatial flourish remains.

### 14.3 Token tests

A focused static/runtime token test verifies:

- light is the default marker;
- advanced brown is the interactive accent;
- semantic colors are separate token values;
- all required custom properties exist;
- CSS contains neither form of `backdrop-filter`;
- appearance defaults do not write theme/accent to shell settings or local storage.

## 15. Accessibility and interaction contracts

- Use buttons, inputs, textareas, lists/tables, headings, and dialogs with native semantics before ARIA recreation.
- Every field has a programmatic label; every icon-only button has `aria-label` or an equivalent accessible name.
- Recovery is a modal dialog: initial focus goes to the safest non-destructive action, focus is contained, Escape does not silently discard, and focus is restored when appropriate.
- Visible `:focus-visible` styling uses a high-contrast outline with offset and is not removed by selected-row styling.
- Pending operations communicate with text/status and disabled controls, not color alone.
- Errors are associated with their form/action and remain readable; connection status uses an appropriate live region without announcing every normal render.
- Segment keyboard navigation must not hijack typing, IME, Tab traversal, or screen-reader shortcuts.
- New E2E includes axe scans on stable states and keyboard traversal of primary actions.

## 16. Error, cancellation, and stale-response policy

Every async command has an operation ID and explicit pending state.

- **User cancellation:** picker returns no path; no error banner and no Engine mutation.
- **Domain rejection:** show canonical typed message/code near the operation; retain context.
- **Transport failure:** preserve session/draft, reflect disconnected status, offer recovery.
- **Stale success:** ignore when operation generation, active segment, document, or session changed.
- **Duplicate input:** disable action and guard in the command layer; UI disabling alone is not the invariant.
- **Partial sequence:** never continue to the next call after a required predecessor fails. Examples: failed save blocks QA; failed QA gate blocks picker/export; failed hydrate prevents session write/Workbench.
- **Retry:** reruns the smallest safe operation using current identities and current draft, not an obsolete request snapshot.

## 17. Test strategy

### 17.1 Pure unit tests

- Session parser: missing key, malformed JSON, arrays/null, unsupported version, blank IDs, valid identity, canonical serialization.
- Surface resolver: valid session, invalid/recycled session, empty/non-empty project list, empty/open project.
- IME guard: composition lifecycle, `isComposing`, key code/which 229, no side effects, post-composition confirm.
- Appearance/tokens: fixed light/brown defaults, semantic separation, required tokens, forbidden glass CSS.

### 17.2 Component/integration tests

Use a typed `DesktopApi` fake at the renderer boundary, with deferred promises where ordering matters:

- Strict Mode subscription/cleanup and boot generation handling;
- Welcome versus Project Home routing;
- project create and import cancel/error/success;
- session validation/clear and draft recovery/discard;
- target save generations, confirm sequencing, save-before-leave failure retention;
- stale exact-TM result suppression and panel accessibility;
- QA run/list/jump behavior;
- gate failure causing zero picker/export calls; gate pass/cancel/success;
- reconnect retaining draft and rehydrating before mutation enablement.

Assertions use accessible roles/names for semantics and stable test IDs only for workflow landmarks or Electron E2E synchronization.

### 17.3 Desktop E2E

Create a new P0 Playwright Electron spec with isolated temporary user data and deterministic source/export fixtures. The Engine remains real. Where native dialogs are unreliable in automation, the test may use `ElectronApplication.evaluate` to make the existing Electron dialog return deterministic paths for that test process; no test-only preload/main product branch is added.

Flow:

1. launch with isolated empty data;
2. wait for connected Welcome;
3. Create project;
4. Import deterministic supported document;
5. edit a target and Confirm;
6. run QA and inspect its stable state;
7. enter Export, observe gate outcome, select deterministic output, and export when passing;
8. assert output exists/has a successful result as supported by the export contract;
9. close and relaunch with the same user data;
10. assert validated resume to the same Workbench document;
11. run axe checks on stable Welcome, Workbench, QA, and Export states (Project Home can use a relaunch/cleared session case).

The E2E should use new test IDs such as `app-shell`, `boot-gate`, `engine-status`, `welcome`, `project-home`, `create-project`, `import-document`, `workbench`, `segment-row-<id>`, `target-editor-<id>`, `tm-panel`, `qa-review`, and `export-review`. Dynamic IDs must use stable Engine identities, never array indices.

The failed-gate/no-export branch is mandatory in component integration tests even if the deterministic real document produces a passing gate in E2E.

## 18. Key trade-offs

| Decision | Benefit | Cost / mitigation |
| --- | --- | --- |
| React reducer/controller instead of router/store dependencies | Small typed state graph; no unused framework surface | Controller can grow; keep RPC/save modules separate and use discriminated actions. |
| CSS custom properties instead of Tailwind/theme framework | Fits current repo, light-first control, easy static token test | Manual class discipline; keep token/component layers explicit. |
| No motion dependency | Avoids P0 bundle/API work; CSS satisfies restrained feedback | Rich spring choreography deferred intentionally. |
| Local responsive draft plus Engine save queue | Good typing UX with authoritative domain state | Requires generations and flush tests; save coordinator centralizes it. |
| First Engine-returned document fallback | Opens existing projects without building a document manager | Multi-document choice deferred; no invented “recent” sorting. |
| Conditional QA jump | Honest to varying issue payloads | Some issues lack Jump; no dead control is rendered. |
| Test-level deterministic native dialogs | Real Engine and bridge flow without OS dialog flakiness | Native dialog UI itself is not E2E-automated; picker boundary is covered in component tests. |

## 19. Risks and mitigations

| Risk | Impact | Mitigation / gate |
| --- | --- | --- |
| Canonical generated request/response shapes differ from presumed fields | Type/build blocker | At implementation start, inspect only exact method definitions and `DesktopApi`; build typed adapters first. Do not duplicate schemas or broaden protocol. |
| Engine status events race with Strict Mode effects or startup retries | Duplicate handlers/stale routing | Cleanup subscriptions, generation-tag startup, and test deferred/out-of-order events. |
| DraftJournal shape or lifecycle cannot identify a segment | Recovery ambiguity | Bind to authoritative type; classify stale journals; report a blocker rather than invent a second durable schema. |
| Save and confirm race with typing/navigation | Data loss or wrong status/focus | One in-flight mutation per segment, generation checks, centralized flush, and failure-retention tests. |
| IME emits inconsistent browser event fields | Accidental confirm/mutation | Guard composition state plus `isComposing`, `keyCode`, and `which` 229; test all paths. |
| TM/QA responses arrive after active identity changes | Wrong-panel or wrong-row data | Tag requests with session/document/segment generations and ignore stale results. |
| QA issue lacks segment reference | Dead jump | Render Jump only after resolving a valid reference in hydrated segments. |
| Native Windows file dialogs make E2E flaky | Workflow test instability | Deterministic dialog return in Playwright main context; component tests verify cancel/error bridge behavior. |
| Existing multi-document projects exceed P0 navigation | Ambiguous open | Deterministic Engine order fallback documented; full document selection remains out of scope. |
| Visual spec still names Lucide | Review inconsistency | Task decision and PRD explicitly override for this slice; closeout updates long-term spec. |
| Large segment lists may need pagination/windowing | Performance risk | Respect canonical pagination if present, use stable rendering, and do not silently truncate; escalate only on measured blocker. |

## 20. Rollback and compatibility

- No Engine schema, data migration, preload bridge, or main-process architecture change is planned.
- The renderer session record is versioned and disposable. Rollback can clear `translunar.renderer.session.v1` without affecting Engine data.
- Draft journal data is cleared only after matched save success or explicit user Discard. Rollback must not add an automatic journal purge.
- Package impact is limited to adding the official Phosphor React package and updating `pnpm-lock.yaml`. Revert those together with renderer imports.
- Source rollback is renderer/test scoped: restore the scaffold renderer, remove new E2E/unit tests, and revert the dependency/lockfile change.
- If implementation proves a main/preload/contract change is mandatory, stop and report the verified blocker to the Orchestrator rather than widening this task silently.

## 21. Design completion gate

Implementation may proceed when:

- every S0–S8 surface maps to a state and tested transition;
- exact protocol types can be bound without main/preload changes;
- session, draft, save, IME, QA gate, and reconnect invariants are retained;
- new UI contains no dead roadmap entry;
- Phosphor/light/brown/no-glass constraints are represented in code and tests;
- the real-Engine E2E fixture strategy is viable within existing Playwright/Electron infrastructure.
