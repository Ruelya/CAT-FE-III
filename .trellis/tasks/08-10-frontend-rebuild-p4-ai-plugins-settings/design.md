# Design — Frontend rebuild P4 AI, plugins, collaboration, and settings

## 1. Design summary

P4 extends the shipped P0–P3 Electron renderer in place and completes the frontend rebuild. It adds four top-level app surfaces:

1. **AI Control** — provider/settings administration plus context-aware interactive, batch, usage, quality, and conversation operations.
2. **Plugins** — installed/bundled lifecycle, permissions, plugin AI actions, authorized plugin panels, and external connectors.
3. **Collaboration** — project-scoped local members, locks, presence, assignments, and operation log.
4. **Settings** — locale, data directory, backup/restore, updates, tutorial state, and renderer-local appearance.

P4 does not add a URL router or global state library. The current `AppSurface` discriminator remains the routing source, `use-app-controller` owns navigation/session/reconnect only, and dedicated feature hooks own their forms, paging, polling, and mutation state. Generated Engine contracts and the existing `DesktopApi` are sufficient; no protocol regeneration is planned.

## 2. Repository evidence and inherited locks

- `packages/contracts/src/index.ts` already lists all requested `ai.*`, `plugin.*`, `externalConnector.*`, and `collab.*` methods.
- `apps/desktop/src/shared/desktop-api.ts` already exposes AI credential write; plugin picker and panel session lifecycle; locale/shell settings; data-directory, backup/restore, update, tutorial, and Engine status APIs.
- Main/preload already validate the active sender and own plugin panel sessions, dialogs, keyring writes, workspace migration, restore tokens, and update operations.
- `App.tsx`, `AppChrome.tsx`, `app-state.ts`, and `use-app-controller.ts` implement a reducer/controller surface machine rather than URL routing.
- P1 established feature operation tokens and save-before-navigation. P2/P3 established dedicated hooks for large domain-local state and reconnect invalidation.
- P0 fixed appearance in `state/appearance.ts`, `tokens.css`, `styles.css`, and `index.html` is intentionally ready to be lifted in P4. The semantic colors are already separate from the brown accent.
- P0–P3 closeouts report desktop unit, build, and real-Engine E2E gates green. P4 must preserve them.

Inherited decisions:

- Workbench-first, compact, solid, and professional; no glass or marketing dashboard.
- Light remains the first-install/default theme; advanced brown remains the default seed.
- Phosphor only for new renderer icons.
- Engine/shell authority; no optimistic revisions/status/counts.
- `SaveCoordinator`, IME, identity-only session-v1, save-before-nav, and reconnect generation remain unchanged.
- Every visible destination is complete; context-inapplicable sections are hidden, not dead.

## 3. Runtime boundaries and module layout

Exact leaf files may consolidate, but ownership must remain equivalent to this layout:

```text
apps/desktop/src/renderer/
  appearance-bootstrap.ts          # pre-React read/apply of appearance-v1
  App.tsx                           # composes global chrome + one surface/hook owner
  shell/
    AppChrome.tsx                   # P4 nav actions, project-context gating
  surfaces/
    AiControl.tsx
    Plugins.tsx
    Collaboration.tsx
    ProductSettings.tsx
  ai/
    AiProviderPanel.tsx
    AiInteractivePanel.tsx
    AiBatchPanel.tsx
    AiUsagePanel.tsx
    AiQualityPanel.tsx
    AiConversationPanel.tsx
  plugins/
    PluginInventoryPanel.tsx
    PluginInspectDialog.tsx
    PluginPermissionsPanel.tsx
    PluginAiActionsPanel.tsx
    PluginUiPanels.tsx
    ExternalConnectorsPanel.tsx
  collaboration/
    CollabMembersPanel.tsx
    CollabLocksPanel.tsx
    CollabPresencePanel.tsx
    CollabAssignmentsPanel.tsx
    CollabOpLogPanel.tsx
  settings/
    LocaleSettings.tsx
    AppearanceSettings.tsx
    DataSettings.tsx
    UpdateSettings.tsx
    TutorialSettings.tsx
  state/
    app-state.ts                    # route identity and selected P4 section only
    use-app-controller.ts           # P4 enter/leave/rehydrate commands only
    p4-route-context.ts             # pure route/context extractors
    ai-view.ts / ai-events.ts       # pure guards, schema projection, event replay
    use-ai-controller.ts
    plugin-view.ts                  # pure lifecycle/permission/schema guards
    use-plugin-controller.ts
    external-connector-request.ts   # one typed V1 request builder/decoder boundary
    use-external-connector-controller.ts
    collab-view.ts                  # pure sequence/status/availability helpers
    use-collaboration-controller.ts
    appearance.ts                   # parse/derive/serialize/apply v1
    use-product-settings.ts
  test/
    fake-desktop-api.ts             # controllable P4 methods and deferred results
apps/desktop/tests/e2e/
  p4-ai-plugins-settings.spec.ts
```

| Boundary | Owns | Must not own |
| --- | --- | --- |
| `use-app-controller` | P4 surface transitions, route context, Workbench flush, return rehydrate, feature-generation invalidation | Provider forms, plugin inventory pages, polling, settings forms |
| AI controller | Provider/settings CRUD, conversations, grounding, runs/events, batch, usage, quality state | Secret persistence, local AI scoring, local run terminal inference |
| Plugin controller | Inventory, inspect/lifecycle, permission decisions, AI actions, UI-panel session owner | Package parse, plugin execution, optimistic registry mutation |
| External connector controller | Catalog/profile/forms, ephemeral credential controls, typed invoke/checkpoint console | Runtime permission/network/checkpoint authority, CAT project mutation |
| Collaboration controller | Project-local lists/forms, heartbeat timers, sequence paging | Remote sync claims, lock arbitration, local op-log payload interpretation |
| Product settings hook | Shell API orchestration and appearance preference | Engine domain state, stuffing non-locale fields into `updateShellSettings` |
| Presentational leaves | Semantic layout, controlled inputs, intent callbacks | Direct Engine calls or alternate contract types |
| Main/preload | Existing dialogs, keyring, workspace/update orchestration, panel session authority | New P4 product state or presentation policy |

## 4. Surface, route, and chrome model

### 4.1 Route identity

P4 surface records carry only route identity and selected section. Large projections remain in dedicated controllers.

```ts
type P4ReturnTarget =
  | {
      kind: "workbench";
      session: SessionIdentity;
      activeSegmentId: string | null;
    }
  | { kind: "projects" }
  | { kind: "welcome" };

interface P4ProjectContext {
  projectId: string;
  projectName: string;
  documentId: string | null;
  activeSegmentId: string | null;
  session: SessionIdentity | null;
}

type AppSurface =
  | /* P0–P3 variants */
  | {
      kind: "ai-control";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section: "providers" | "interactive" | "batch" | "usage" | "quality";
    }
  | {
      kind: "plugins";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section:
        | "installed"
        | "bundled"
        | "permissions"
        | "aiActions"
        | "uiPanels"
        | "connectors";
    }
  | {
      kind: "collaboration";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext;
      section: "members" | "locks" | "presence" | "assignments" | "opLog";
    }
  | {
      kind: "settings";
      returnTarget: P4ReturnTarget;
      context: P4ProjectContext | null;
      section: "locale" | "appearance" | "data" | "updates" | "tutorial";
    };
```

Conversations are part of the AI interactive panel rather than another global route. External connectors are a Plugins section because their owner identity and lifecycle are plugin-backed. This avoids six top-level destinations while keeping both areas fully reachable.

### 4.2 Context derivation

A pure `resolveP4RouteContext(surface)` handles existing surface kinds:

- Workbench/QA/Export → session project/document; Workbench also supplies active segment ID.
- Insights/Assets with `returnTo: "workbench"` → retained session/project; no active segment unless already carried safely.
- Project Home/Welcome/Templates/Recycle/Search → no selected project context.
- P4 surface → retain its existing context/return target.

No full `SessionContext`, segment row, plugin data, or settings data enters localStorage or the global reducer.

### 4.3 Navigation sequence

```text
P4 nav intent
  → synchronously capture source surface + route context + feature op
  → if source is Workbench: await SaveCoordinator.flush()
  → on flush failure: keep Workbench/session/draft and show transition error
  → set P4 AppSurface (identity + initial section only)
  → dedicated controller loads current projections

Back from P4
  → invalidate P4 controller work and revoke any plugin panel session
  → returnTarget workbench: full Engine rehydrate, then surface/session commit
  → returnTarget projects/welcome: reload authoritative Home data
```

Settings/Plugins/AI are global destinations after boot. Collaboration chrome is rendered only when `resolveP4RouteContext` returns a project. Within AI, interactive/batch/quality sections are rendered only when their required context exists. Plugins sections are real regardless of project context; action invocation or context-bound panels are absent when their descriptor requires unavailable context.

### 4.4 Chrome

`AppChrome` adds Phosphor icon buttons with stable labels/test IDs:

- `nav-ai-control` — global after boot;
- `nav-plugins` — global after boot;
- `nav-collaboration` — project context only;
- `nav-settings` — global after boot.

Existing Home/Search/Assets/Insights/QA/Export rules stay intact. P4 buttons are icon-only at compact widths and always retain `aria-label` + `title`. `aria-current="page"` follows the owning surface. At 1250px the actions remain one compact row; identity truncates before controls overlap.

## 5. Async ownership model

Each controller uses independent list/read and mutation counters tied to `featureGeneration`. Large controllers may use one counter per subsection when requests can overlap.

```ts
interface FeatureToken {
  generation: number;
  ownerKey: string;  // surface + section + project/profile/plugin identity
  opId: number;      // independent domain counter
}
```

Required domains:

- AI: catalog/profiles, settings, credentials, conversations/messages, grounding, run, run-events, batch/list/items, usage, each quality report.
- Plugins: installed/get, bundled, inspect/lifecycle, versions, permissions/audit, AI actions/history/invoke, UI panels/session.
- External connectors: catalog/profiles, credentials, invoke, checkpoint.
- Collaboration: members, locks, presence, assignments, op log.
- Settings: shell/locale, data, backup, restore, update, tutorial; appearance is synchronous local state.

Rules:

1. Snapshot current form/query/revision from `stateRef` before setting pending.
2. `beginMutation` returns `null` if that owner already has one in flight.
3. A completion commits only if generation, owner key, and op ID are current.
4. Section change/unmount/reconnect invalidates its tokens; reconnect increments app feature generation.
5. Polling timers and subscriptions clean up in Strict Mode. Cleanup stops polling/heartbeat; it does not reinterpret or cancel durable Engine work unless the user explicitly chose cancel.
6. Errors are normalized through the existing typed UI-error boundary and remain with the owning form/projection.

## 6. Method ledger

### 6.1 AI Engine methods

| Group | Methods | Renderer use / authority rule |
| --- | --- | --- |
| Provider catalog/profile | `ai.provider.catalog`, `ai.provider.list`, `ai.provider.create`, `ai.provider.update`, `ai.provider.delete`, `ai.provider.test` | Catalog/schema and profile revisions are authoritative; unknown schema field kind makes the connector unavailable for edit rather than creating raw JSON config |
| Credentials | `ai.credential.status`, `ai.credential.delete` | Read/delete through generic generated RPC; write secret only through `DesktopApi.setAiCredential` |
| Global AI settings | `ai.settings.get`, `ai.settings.update` | Full fetched settings + exact revision; no optimistic toggle |
| Grounding | `ai.grounding.preview` | Segment context and expected segment revision loaded after entry; display sections/hash/truncation exactly |
| Interactive run | `ai.run.start`, `ai.run.get`, `ai.run.list`, `ai.run.events`, `ai.run.cancel`, `ai.run.resume` | Events page by `afterSequence`; terminal status from `AiRun`; cancel/resume exact run revision |
| Apply | `ai.result.apply` | Exact run + segment revisions; returned `EditorMutationResult` authoritative; Workbench rehydrates on return |
| Batch | `ai.batch.start`, `ai.batch.get`, `ai.batch.list`, `ai.batch.items`, `ai.batch.cancel`, `ai.batch.resume` | Engine counts/status/items only; revision-safe commands |
| Usage | `ai.usage.query` | User-selected time window/dimension and paging; preserve zeros/nullables |
| Quality | `ai.quality.scoreDocument`, `ai.quality.semanticQa`, `ai.quality.extractTerms` | Report-only; no QA/termbase mutation |
| Conversations | `ai.conversation.list`, `ai.conversation.create`, `ai.conversation.update`, `ai.conversation.messages` | Project-scoped, paged, exact revision on rename/archive; first submit binds returned conversation ID |

### 6.2 Plugin Engine methods

| Group | Methods | Renderer use / authority rule |
| --- | --- | --- |
| Inventory/lifecycle | `plugin.list`, `plugin.get`, `plugin.install`, `plugin.enable`, `plugin.disable`, `plugin.uninstall`, `plugin.inspect`, `plugin.version.list`, `plugin.upgrade`, `plugin.rollback` | Inspect before local mutation; Engine state/revision/provenance wins; reload all dependent projections after mutation |
| Bundled | `plugin.bundled.list`, `plugin.bundled.apply` | Catalog availability and action come from Engine; no resource paths in renderer |
| Permissions | `plugin.permission.request.list`, `plugin.permission.review`, `plugin.permission.grant`, `plugin.permission.deny`, `plugin.permission.revoke`, `plugin.permission.audit.list` | Exact scope, actor, reason, request revision; no local grant inference |
| AI actions | `plugin.aiAction.list`, `plugin.aiAction.invoke`, `plugin.aiAction.cancel`, `plugin.aiAction.history.list` | Active exact owner + declared schema/context; result proposal/usage authoritative |
| UI panels | `plugin.uiPanel.list`, `plugin.uiPanel.bridge.call` | Renderer lists inventory. Parent UI does not directly issue arbitrary bridge calls; authorized panel host/session path owns allowed bridge operations |

### 6.3 Plugin DesktopApi methods

| Method | Contract |
| --- | --- |
| `selectPluginPackage()` | Trusted local directory/`.tlplugin` selection; null is cancel and causes no inspect/mutation |
| `issuePluginPanelSession(request)` | Request exact plugin, contribution, activation revision; returned URL/session/expiry are opaque |
| `revokePluginPanelSession(sessionId)` | Called on close, section/surface leave, unmount, and supersession; boolean false becomes safe revoked state, not success |
| `onPluginPanelRevoked(listener)` | Plugin ID match revokes matching panel; `null` revokes every open panel owned by this renderer |

### 6.4 External connector methods

| Group | Methods | Renderer use / authority rule |
| --- | --- | --- |
| Catalog/profile | `externalConnector.catalog`, `externalConnector.profile.list`, `externalConnector.profile.create`, `externalConnector.profile.update`, `externalConnector.profile.delete` | Exact contribution owner; profile update merges existing unknown config keys and overlays supported schema fields |
| Credentials | `externalConnector.credential.status`, `externalConnector.credential.set`, `externalConnector.credential.delete` | Generated API explicitly owns connector secret writes; password state is ephemeral and clears on successful returned status |
| Invoke | `externalConnector.invoke` | One typed V1 builder; declared operations only; Engine overwrites binding/config and enforces permission/runtime/checkpoint rules |
| Checkpoint | `externalConnector.checkpoint.get` | Explicit profile + stream lookup; display cursor/revision/hash safely; opaque payload is not interpreted as CAT state |

### 6.5 Collaboration methods

| Group | Methods | Renderer use / authority rule |
| --- | --- | --- |
| Members | `collab.member.list`, `collab.member.add`, `collab.member.remove` | Current project only; returned membership authoritative |
| Locks | `collab.lock.list`, `collab.lock.acquire`, `collab.lock.release`, `collab.lock.heartbeat` | Current project/document/segment identity; Engine holder/expiry/revision wins |
| Presence | `collab.presence.list`, `collab.presence.heartbeat` | Explicit Start presence, bounded TTL + timer; stop timer on leave; Engine TTL list authoritative |
| Assignments | `collab.assignment.list`, `collab.assignment.create`, `collab.assignment.complete` | Current project/document; exact assignment revision on complete |
| Operation log | `collab.opLog.list` | Page by `afterSequence`; render sequence/kind/actor/time; do not cast opaque payload into domain state |

### 6.6 Product-shell DesktopApi methods

| Area | Methods | Renderer contract |
| --- | --- | --- |
| Locale/settings | `getSystemLocale`, `getShellSettings`, `updateShellSettings` | Locale update patch is exactly `{ locale }`; display committed settings |
| Data directory | `getDataDirectoryStatus`, `selectDataDirectory`, `validateDataDirectory`, `migrateDataDirectory` | Validate → confirm → migrate; returned `activePath` is authority |
| Backup | `selectBackupDestination`, `createWorkspaceBackup` | Main owns filesystem; null selection no-op |
| Restore | `selectRestoreSource`, `previewRestore`, `restoreWorkspaceBackup` | Decode `ShellActionResult.data` once as `RestorePreviewSummary`; submit opaque path/token pair unchanged |
| Updates | `getUpdateStatus`, `setUpdateMode`, `checkForUpdates`, `deferUpdate`, `downloadUpdate`, `installUpdate`, `rollbackUpdate`, `openUpdateInstaller` | Command availability derives from status snapshot; every success replaces snapshot |
| Tutorial | `getTutorialState`, `updateTutorialState` | Existing versioned state only; no local duplicate |

## 7. AI design

### 7.1 Provider configuration

The controller loads catalog, profiles, credential status, and AI settings independently. Catalog and profile source identity are joined by generated fields. A pure schema projector supports `text`, `boolean`, `integer`, and `select` fields. Create emits only rendered known keys; update starts from the fetched profile `configuration` object and overlays known fields so future keys survive. Unsupported fields render an explicit unavailable state and disable create/update for that connector.

Provider mutation flow:

```text
snapshot catalog/profile/form/revision
  → validate ergonomic constraints
  → begin provider mutation
  → invoke generated create/update/delete/test
  → if token current: reload profile list + catalog + settings references + credential status
  → keep form/error on failure
```

Credential flow:

```text
password control → DesktopApi.setAiCredential(profileId, secret)
  → success: clear control; ai.credential.status reload
  → failure: keep only current control value; safe typed error; no logging/string interpolation
```

### 7.2 Context hydration

AI route carries stable IDs only. On project-context entry the AI controller re-reads the current document/segment projection through existing typed segment list/hydration helpers. The active segment ID may select the matching row; a missing/stale ID becomes an honest “no segment context” state. Expected segment revision is read immediately before grounding/start/apply, never captured before Workbench flush.

### 7.3 Interactive run and event replay

A pure run-event reducer owns sequence replay. It ignores duplicate/out-of-order events at or below the committed sequence and appends delta text only from Engine events. `ai.run.get` remains the terminal run authority.

```text
conversation (existing or create first)
  → grounding preview (optional explicit action)
  → ai.run.start with exact segment revision + returned conversation ID
  → poll ai.run.events(afterSequence) and periodically ai.run.get
  → stop timer at Engine terminal status or surface unmount
  → proposal remains until Discard (local) or ai.result.apply
  → apply success replaces local run/segment projection; return Workbench rehydrates
```

Cancel/resume send the currently displayed Engine run revision. A failed apply keeps the proposal and diff. Text diff is presentation-only and never changes the proposal.

### 7.4 Batch, usage, quality, conversations

- Batch list and items use returned offset/limit/total and status counts. Start snapshots the selected profile/project/document/options. Cancel/resume reload the run and items.
- Usage requires an explicit bounded time range and generated dimension; records/aggregates render as returned.
- Quality runs one report at a time per document. Scores/routes/findings/term candidates are report data only.
- Conversation list/messages are independently paged. Update sends title/archive plus current revision. Conversation deletion is not exposed because no delete method exists.

## 8. Plugin and external connector design

### 8.1 Inventory and lifecycle

The surface uses compact full-width tables/bands rather than cards:

- Installed: identity, version, tier, status, source, compatibility, contributions, diagnostics, actions.
- Bundled: package version/publisher/license/install state and authoritative Apply action.
- Versions: paged dialog for exact version IDs, state, provenance, diagnostics, rollback.

Local install/upgrade sequence:

```text
selectPluginPackage
  → null: return idle, no RPC
  → plugin.inspect(sourcePath)
  → show bounded inspection + compatibility/provenance/diagnostics
  → explicit Install/Upgrade confirmation
  → generated mutation with actor/reason/current revision as required
  → reload installed + bundled + permissions + provider catalog + actions + panels + connectors
```

Disable/uninstall/revoke must close matching plugin panel sessions before/alongside the authoritative reload. Stale revisions retain the dialog and reload current state for an explicit retry.

### 8.2 Permissions

Permission review is its own section and is also reachable from a plugin row. The controller never constructs a grant from display strings; it submits the exact Engine request ID, revision, and selected supported scope. Grant/deny/revoke require actor/reason. Audit paging preserves returned order and sequence.

### 8.3 Plugin AI actions

A pure schema projector supports public text/boolean/integer/number/select fields. `json` or unknown configuration is not exposed as an unbounded raw config editor; such action remains visible with unsupported-schema status. The invocation builder uses descriptor protocol/config versions, exact contribution ID, generated UUID-like invocation identity, bounded deadline, and current editor context from rehydrated IDs. Result modes render proposal text; no automatic segment mutation occurs. History and cancellation are independent Engine operations.

### 8.4 Plugin UI panels

Only `state === "active"` and supported placement/surface descriptors can open. The parent creates an iframe only from the opaque issued URL and uses a restrictive sandbox consistent with the existing host contract. Session owner state contains `{pluginId, contributionId, activationRevision, sessionId, url, expiresAtMs}` only.

```text
open descriptor
  → issuePluginPanelSession(exact owner)
  → if token current and not expired: mount iframe
  → close/nav/unmount: revoke session, remove iframe
  → onPluginPanelRevoked(pluginId|null): remove matching/all iframe immediately
```

No session token is persisted. Parent renderer does not add an ad-hoc `postMessage` bridge or direct generic `plugin.uiPanel.bridge.call` control.

### 8.5 External connectors

Catalog entries are joined to exact-owner plugin contribution descriptors from `plugin.get/list` to recover the public config schema and credential-slot descriptors. Missing/unsupported descriptors remain inspectable but cannot create a profile. Profile update uses unknown-preserving object merge.

The invocation builder is the one `unknown` boundary:

- type-only imports `ExternalConnectorRequestV1` and related public request/item types from `@translunar/plugin-sdk`;
- creates bounded operation-specific forms for validate/test, pull, push, poll, and webhook;
- parses JSON only for explicitly unknown metadata/webhook body fields through one tested decoder;
- generates request ID, contract version 1, deadline, placeholder binding/config required by the public type, idempotency/checkpoint fields, and operation payload; Engine replaces trusted binding/config;
- rejects undeclared operations, invalid JSON, blank stream/event IDs, over-limit item counts, or deadlines before invoke.

Results render operation, request ID, replayed flag, checkpoint revision, and a bounded safe JSON projection. They do not patch project/TM/document state. Checkpoint payload is shown only as bounded inspectable JSON and is never interpreted.

## 9. Collaboration design

Collaboration is explicitly labeled local project state. It requires `P4ProjectContext`; otherwise there is no chrome entry.

- **Members:** paged/list projection with add/remove forms. Owner/member role is generated. Removal is confirmed.
- **Locks:** list all project locks. Acquire is available only with document + segment IDs. Release and heartbeat use exact visible actor/segment context; Engine conflict holder/expiry is displayed.
- **Presence:** user explicitly starts presence. The controller calls heartbeat immediately, schedules the next heartbeat before half the returned/requested TTL, and stops the timer on Stop, section leave, surface leave, or unmount. Presence list refresh is separate from heartbeat ownership.
- **Assignments:** create with assignee, current document, ordinal range, optional due date; complete uses exact returned assignment revision. No cancel control because the method is absent.
- **Operation log:** request `{ projectId, afterSequence, limit }`; first page starts at zero/default, and Load more advances from the maximum sequence in the Engine-returned page (the page echoes `afterSequence` but has no separate terminal cursor). Empty/non-advancing pages stop paging. Render actor/kind/sequence/time and optionally bounded payload inspection without domain casts.

No polling or label implies a remote server, simultaneous editing transport, or advisory lock enforcement beyond Engine results.

## 10. Product settings design

### 10.1 Locale

On settings mount, load `getShellSettings` and `getSystemLocale`. The selected option is `settings.locale ?? normalizedSystemLocale`. Commit calls only:

```ts
updateShellSettings({ locale: selectedLocaleOrNull });
```

The returned `ProductShellSettings` replaces local shell state and updates `<html lang>`. “System” maps to `null`. No object spread sends unrelated shell fields back through the locale-only patch.

### 10.2 Data directory and backup/restore

Data migration state is finite:

```text
idle → selecting → validating → readyToConfirm → migrating → committed | error
```

The selected path is main-provided. Confirm dialog remains open while migration runs. A returned rollback/failure phase keeps the existing active path and shows code/message. On commit, `activePath` becomes display authority and app feature generation is invalidated before rehydrate.

Backup uses main selection then `createWorkspaceBackup(destination)`. Restore uses:

```text
selectRestoreSource
  → previewRestore(path): ShellActionResult
  → decodeRestorePreviewSummary(result.data)
  → explicit ConfirmDialog
  → restoreWorkspaceBackup({ path, confirmationToken })
  → on failure keep decoded preview + error
  → on success invalidate all controller work and cold-route from shell/Engine truth
```

`decodeRestorePreviewSummary` validates path/token, format/schema/version, file/byte counts, hash/compatibility booleans, and optional free-space values from `unknown`. The renderer never generates a token or reads backup files.

### 10.3 Updates

A pure `allowedUpdateCommands(snapshot)` table drives presentation and command guards. Every command rechecks the current snapshot before invoke and replaces it with the returned snapshot. At minimum:

- mode change allowed while not installing/recovery-busy;
- check allowed from idle/failed/available/deferred as supported by the returned mode;
- download only available update;
- install only ready and not recovery-busy;
- rollback only `canRollback`;
- open installer only `canOpenInstaller`;
- defer only when an update is available/ready and timestamp is finite/future.

The renderer never claims installed before main returns the authoritative state.

### 10.4 Tutorial

The Settings tutorial panel loads `getTutorialState`. Reset, skip, and complete call `updateTutorialState` with the minimum patch and replace state with the return value. Reset uses the existing version/first-step contract; no new overlay/content is introduced.

## 11. Appearance model

### 11.1 Persisted schema

```ts
const APPEARANCE_STORAGE_KEY = "translunar.renderer.appearance.v1";

interface RendererAppearancePreferenceV1 {
  version: 1;
  theme: "light" | "dark";
  accentSeed: `#${string}`; // runtime enforces exactly six hex digits
}

const DEFAULT_APPEARANCE = {
  version: 1,
  theme: "light",
  accentSeed: "#765847",
} as const;
```

`parseAppearancePreference(unknown)` and `readAppearancePreference(storage)` are total and field/version strict. Invalid/missing/unavailable storage returns a fresh default. `writeAppearancePreference` serializes the canonical lower-case seed; failure keeps the in-memory applied choice and displays a local persistence error.

### 11.2 Pre-React application

`index.html` retains the P0 light/brown inline fallback, preserving safe first-install paint. A CSP-compatible external `appearance-bootstrap.ts` runs before `main.tsx`, reads the versioned key, derives the palette, then sets:

```text
html[data-theme="light"|"dark"]
html.style --color-accent-seed / derived operational variables
html.style.colorScheme
```

React reads the same canonical preference and does not flash a second default. Settings changes call one `applyAppearance(preference, document.documentElement)` synchronously, persist, and update hook state. Reset removes/writes the default canonical value and reapplies it.

### 11.3 Theme and accent derivation

`tokens.css` defines complete solid light and dark surface/text/border/semantic token sets. The accent seed is custom, but operational values are derived by a pure color helper:

- normalize `#RRGGBB` to RGB;
- choose `--color-text-on-accent` as black or white with the higher WCAG contrast;
- derive hover/active by moving luminance toward the text-opposite direction while retaining hue;
- derive soft accent by mixing a small seed percentage into the current solid surface;
- derive a focus/border accent adjusted along the same hue until it reaches at least 3:1 against both canvas and raised surface;
- retain default brown values when derivation cannot produce finite values.

Theme semantic tokens (`--color-success`, `--color-warning`, `--color-error`) are fixed per light/dark theme and never computed from the accent. Tests assert token inequality and contrast thresholds. Component CSS uses `--color-text-on-accent` rather than the old fixed inverse value for accent buttons.

`styles.css` uses `color-scheme: var(--color-scheme)` or the applied root property rather than hard-coded light. Native controls therefore follow the chosen theme. No alpha surface/glass material is introduced; `color-mix` is allowed only for accent/solid-state derivation, not translucent panels.

## 12. Error and edge-case matrix

| Condition | Required behavior |
| --- | --- |
| Dirty Workbench → P4 destination, flush fails | Keep Workbench/draft/session; no P4 load |
| P4 load returns after reconnect/leave | Ignore stale completion |
| No AI profile/credential | Honest empty/unavailable; no synthetic online result |
| AI event duplicate/out of order | Ignore at/below committed sequence; `ai.run.get` remains authority |
| AI apply conflict | Keep proposal/diff; show typed error; no target patch |
| Provider/plugin config schema unsupported | Keep inventory visible; disable mutation with explicit unsupported state; no raw JSON fallback |
| Plugin picker canceled | No inspect/install/upgrade RPC |
| Plugin mutation fails/stale revision | Keep dialog/form; reload current projection for retry |
| Permission actor/reason blank | No decision RPC |
| Plugin panel session expires/revokes | Unmount immediately; revoke cleanup; safe status |
| External secret write fails | Keep only active password control; no echo/log/storage |
| External request JSON invalid | No invoke; retain operation form and field error |
| Connector invoke succeeds | Show safe result/replay/checkpoint; no project mutation claim |
| Collaboration lacks project context | No chrome entry or surface |
| Lock held by another actor | Display Engine conflict/holder; no optimistic lock |
| Presence section unmounts | Cancel timer/subscription; no late setState |
| Op-log payload unknown | Render bounded inspectable value or omit details; do not cast into member/lock state |
| Locale update fails | Keep selected form + committed locale; show error |
| Data picker/backup/restore picker cancel | No validation/mutation RPC after cancel |
| Restore `data` malformed/incompatible/hash false | No apply; retain preview error |
| Update command invalid for current snapshot | No DesktopApi call |
| Appearance storage malformed/unavailable | Apply light/brown default; boot continues |
| Accent too light/dark | Derive readable on-accent/focus operational values; semantic colors unchanged |

## 13. Accessibility, copy, and layout

- P4 sections use semantic tablists only when all tabs are real; ordinary subsection navigation may use labeled buttons/links.
- Tables/lists have real headings, loading status, empty rows/regions, and confined scrolling. Long plugin IDs, origins, hashes, and diagnostics wrap with `overflow-wrap: anywhere`.
- Destructive confirmations reuse `ConfirmDialog`/`ModalDialog`, focus Cancel first, trap focus, use non-destructive Escape, and remain mounted while pending/failing.
- Plugin iframe has a title from its exact descriptor and never captures focus after revocation.
- New icons are Phosphor and icon-only buttons have `title` + `aria-label`.
- No filler subtitle or explanatory marketing text is added. Functional statuses/errors and security-critical confirmation details remain allowed.
- Three supported viewports must have no document-level horizontal overflow. Dense panels use internal scroll and responsive label hiding with accessible names retained.
- `prefers-reduced-motion` collapses transitions without changing focus or lifecycle cleanup.

## 14. Test design

### 14.1 Pure tests

- P4 route context and collaboration visibility across every current surface kind.
- Appearance parse/serialize/default/storage failure, light/dark palette, arbitrary seed contrast, semantic independence, DOM application.
- AI schema merge, event sequence reducer, terminal/cancel/resume/apply guards, batch/usage/quality availability.
- Plugin config projection, lifecycle/permission command guards, exact-owner session selection.
- External connector operation-specific request builder, bounded JSON decoder, undeclared operation, idempotency/checkpoint fields.
- Collaboration assignment/lock availability, op-log cursor merge, heartbeat schedule/cleanup guards.
- Restore preview decoder and update command matrix.

### 14.2 Controller/integration tests

Extend the typed fake DesktopApi with controllable P4 results and deferred promises. Cover:

- Workbench flush-before each P4 entry and return rehydrate;
- stale completion discard after navigation/reconnect;
- provider/settings/credential success and failure secret handling;
- grounding → first conversation create → run/events/cancel/resume/apply;
- batch pages/terminal guards, usage, quality no-write;
- plugin inspect-before-install, bundled/lifecycle refresh, permission failure retention;
- AI-action result/cancel/history and panel issue/revoke/revocation event;
- connector profile unknown-preserving update, credential, invoke/checkpoint;
- collab member/lock/presence/assignment/op-log empty/error/success and timer cleanup;
- locale exact patch, data migration, backup, restore token, updates, tutorial;
- appearance reload and malformed storage boot.

### 14.3 Real-Engine Playwright

`p4-ai-plugins-settings.spec.ts` has always-on and fixture-gated groups.

Always-on:

- P4 chrome reachability/no dead tabs;
- local collaboration members/locks/presence/assignment/op-log on a real project;
- light → dark/custom accent → Electron relaunch persistence/reset/malformed-storage recovery;
- locale selection, update/tutorial status reachability, data/backup/restore picker-cancel non-destructive paths;
- honest empty/error plugin/provider/connector states when fixtures are absent;
- no console/page errors, no horizontal overflow, sampled axe/keyboard checks.

Fixture-gated with explicit `test.skip` reason:

- loopback AI provider credential → grounding → streaming run → apply → usage → credential delete;
- official bundled/local plugin inspect/install/permission/enable/version/rollback/uninstall;
- plugin AI action and issued UI panel/revocation;
- official external connector profile/credential/test/pull/checkpoint.

P0–P3 specs remain in the final real-Engine matrix.

## 15. Trade-offs

| Decision | Chosen | Rejected alternative | Reason |
| --- | --- | --- | --- |
| P4 navigation | Four `AppSurface` variants | URL router / modal-only UI | Matches shipped surface machine and supports honest deep panels |
| External connectors | Plugins subsection | Separate global destination | Exact plugin owner/lifecycle/permission coupling; less chrome crowding |
| Conversations | AI interactive subsection | Separate surface | Conversation is run context, not a global rebuild destination |
| Large feature state | Dedicated hooks | Expand `use-app-controller` with all forms | P2/P3 source-backed pattern; prevents controller monolith |
| Plugin config | Schema fields only | Raw descriptor JSON editor | Bounded, typed, safe, and historical contract compliant |
| External invoke | Operation-specific form + one typed unknown boundary | Generic arbitrary request JSON | Preserves public V1 contract and validates required fields |
| Appearance persistence | Renderer localStorage v1 | `ProductShellSettings` widening | Explicit P4 lock; appearance is renderer-only disposable preference |
| Accent | Seed + accessible derived palette | Directly trust every seed for all CSS tokens | Allows DIY while retaining control/focus readability |
| Collaboration | Local project panels | Remote sync UI | Matches existing Engine capability and avoids false claims |

## 16. Compatibility and rollback

- No Engine method, generated protocol, database schema, or session-v1 change is planned.
- Existing P0–P3 surface kinds, test IDs, save semantics, and route outcomes remain compatible.
- The new appearance key is additive. Older builds ignore it; malformed/newer versions safely fall back.
- P4 can be rolled back by reverting renderer/test changes and restoring fixed appearance tokens/constants. The local appearance key may remain harmless and ignored.
- A partially available external fixture or bundled catalog degrades only its panel; ordinary Engine/Workbench remains usable.
- If implementation proves a required method or DesktopApi path missing, do not fabricate a local contract. Report the exact method/signature gap to the Orchestrator and pause that work package.

## 17. Ready criteria

- PRD R01–R17 and AC01–AC27 are testable.
- Generated method and existing DesktopApi ledgers cover the P4 brief.
- Module ownership prevents app-controller and `App.tsx` domain-state bloat.
- Appearance schema, pre-React application, contrast, and shell-setting separation are explicit.
- Implementation order and validation gates are in `implement.md`.
- Context manifests contain real frontend/backend/guidance specs.
- `research_needed: []`.
