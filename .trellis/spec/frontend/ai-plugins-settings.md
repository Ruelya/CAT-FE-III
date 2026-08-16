# Frontend AI Control, Plugins, Collaboration, and Settings (P4)

## 1. Scope / Trigger

Use this contract when changing:

- Top-level surfaces **AI Control**, **Plugins**, **Collaboration**, or
  **Product Settings**
- Chrome nav for `nav-ai-control` / `nav-plugins` / `nav-collaboration` /
  `nav-settings`
- Renderer-local **appearance-v1** (theme / accent seed) or pre-React bootstrap
- AI provider/credential/settings, conversations, grounding, runs, batch,
  usage, quality, apply
- Plugin inventory/lifecycle/permissions, plugin AI actions, UI panel sessions,
  external connectors
- Local collaboration members/locks/presence/assignments/op-log
- Shell locale, data directory migration, backup/restore, updates, tutorial
- Fake DesktopApi P4 methods or `tests/e2e/p4-ai-plugins-settings.spec.ts`

P4 extends the P0–P3 renderer **in place**. It adds four `AppSurface` kinds
and dedicated controllers. Domain facts remain Engine/main-owned through
generated `lib/rpc` invoke and existing `DesktopApi` trusted paths. React owns
forms, selection, paging cursors, polling timers, panel open state, and
presentation formatting only.

Custom Electron title-bar chrome is **shipped** outside P4 product surfaces:
platform-hidden frame, `AppChrome` drag strip, and non-macOS window controls.
See [electron-workbench.md](./electron-workbench.md) (Desktop custom title bar
chrome). P4 must not reintroduce a default OS title bar, glass material, or a
second appearance store for chrome.

Related: [electron-workbench.md](./electron-workbench.md) (bridge, window chrome,
save-before-nav, historical AI/plugin notes),
[project-lifecycle.md](./project-lifecycle.md) (feature ops),
[directory-structure.md](./directory-structure.md),
[quality-guidelines.md](./quality-guidelines.md).

### Source-backed modules (shipped layout)

| Area | Paths |
| --- | --- |
| Surfaces | `surfaces/AiControl.tsx`, `Plugins.tsx`, `Collaboration.tsx`, `ProductSettings.tsx` |
| Shell | `shell/AppChrome.tsx` — P4 nav test IDs + project-gated Collaboration |
| Route pure | `state/p4-route-context.ts` — context/return target extractors |
| Appearance | `state/appearance.ts`, `appearance-bootstrap.ts` (pre-`main.tsx`) |
| AI pure | `state/ai-view.ts`, `state/ai-events.ts` |
| Plugin pure | `state/plugin-view.ts`, `state/external-connector-request.ts` |
| Collab pure | `state/collab-view.ts` |
| Settings pure | `state/product-settings-view.ts` |
| Controllers | `use-ai-controller.ts`, `use-plugin-controller.ts`, `use-collaboration-controller.ts`, `use-product-settings.ts` |
| App gateway | `use-app-controller.ts` — `goAiControl` / `goPlugins` / `goCollaboration` / `goSettings` + flush/rehydrate only |
| Harness | `test/fake-desktop-api.ts` (P4 DesktopApi + invoke stubs) |
| E2E | `tests/e2e/p4-ai-plugins-settings.spec.ts` |

---

## 2. Signatures

### Route identity (global reducer only)

```ts
// state/p4-route-context.ts + app-state.ts
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

type AiControlSection =
  | "providers"
  | "interactive"
  | "batch"
  | "usage"
  | "quality";

type PluginsSection =
  | "installed"
  | "bundled"
  | "permissions"
  | "aiActions"
  | "uiPanels"
  | "connectors";

type CollaborationSection =
  | "members"
  | "locks"
  | "presence"
  | "assignments"
  | "opLog";

type SettingsSection =
  | "locale"
  | "appearance"
  | "data"
  | "updates"
  | "ocr"
  | "tutorial";

// AppSurface variants carry only route identity + section.
// Large projections live in dedicated controllers — not the global reducer.
```

### App controller gateway

```ts
goAiControl(section?: AiControlSection): Promise<void>;
goPlugins(section?: PluginsSection): Promise<void>;
goCollaboration(section?: CollaborationSection): Promise<void>;
goSettings(section?: SettingsSection): Promise<void>;
// Shared: Workbench → await SaveCoordinator.flush(); failure stays on Workbench.
// Collaboration command rejects missing project context even if chrome is hidden.
// Back: invalidate P4 work, revoke plugin panel sessions, rehydrate returnTarget.
```

### Appearance-v1 (renderer-local only)

```ts
// state/appearance.ts
const APPEARANCE_STORAGE_KEY = "translunar.renderer.appearance.v1";

interface RendererAppearancePreferenceV1 {
  version: 1;
  theme: "light" | "dark";
  accentSeed: string; // runtime: exactly #rrggbb (canonical lower-case)
}

const DEFAULT_APPEARANCE = {
  version: 1,
  theme: "light",
  accentSeed: "#765847",
} as const;

function parseAppearancePreference(value: unknown): RendererAppearancePreferenceV1;
function readAppearancePreference(storage?: Pick<Storage, "getItem"> | null): RendererAppearancePreferenceV1;
function serializeAppearancePreference(preference: RendererAppearancePreferenceV1): string;
function writeAppearancePreference(
  preference: RendererAppearancePreferenceV1,
  storage?: Pick<Storage, "setItem"> | null,
): { ok: true } | { ok: false; error: string };
function applyAppearance(
  preference: RendererAppearancePreferenceV1,
  root?: HTMLElement,
): void;
// appearance-bootstrap.ts runs before main.tsx — same read + apply.
```

**Never** write appearance into `ProductShellSettings` or `updateShellSettings`.

### DesktopApi (existing bridge; P4 uses these without main/preload widening)

```ts
// AI secret write (only path for AI credentials)
setAiCredential(profileId: string, secret: string): Promise<void>;

// Plugin package + authorized panel host
selectPluginPackage(): Promise<string | null>;
issuePluginPanelSession(request: {
  pluginId: string;
  contributionId: string;
  revision: number;
}): Promise<{
  sessionId: string;
  url: string;
  expiresAtMs: number;
  revision: number;
  bridgeVersion: 1;
}>;
revokePluginPanelSession(sessionId: string): Promise<boolean>;
onPluginPanelRevoked(listener: (pluginId: string | null) => void): () => void;

// Shell / data / backup / restore / updates / tutorial
getSystemLocale(): Promise<string>;
getShellSettings(): Promise<ProductShellSettings>;
updateShellSettings(patch: ShellLocalePreferencePatch): Promise<ProductShellSettings>;
// ShellLocalePreferencePatch is locale-only: { locale: string | null }
getDataDirectoryStatus(): Promise<DataDirectoryStatus>;
selectDataDirectory(): Promise<string | null>;
validateDataDirectory(path: string): Promise<DataDirectoryValidation>;
migrateDataDirectory(path: string): Promise<DataDirectoryMigrationResult>;
selectBackupDestination(suggestedName?: string): Promise<string | null>;
createWorkspaceBackup(destinationPath?: string | null): Promise<ShellActionResult>;
selectRestoreSource(): Promise<string | null>;
previewRestore(path: string): Promise<ShellActionResult>;
restoreWorkspaceBackup(params: RestoreApplyParams): Promise<DataDirectoryMigrationResult>;
getUpdateStatus(): Promise<UpdateStatusSnapshot>;
setUpdateMode(mode: UpdateMode): Promise<UpdateStatusSnapshot>;
checkForUpdates(): Promise<UpdateStatusSnapshot>;
deferUpdate(untilMs: number): Promise<UpdateStatusSnapshot>;
downloadUpdate(): Promise<UpdateStatusSnapshot>;
installUpdate(): Promise<UpdateStatusSnapshot>;
rollbackUpdate(): Promise<UpdateStatusSnapshot>;
openUpdateInstaller(): Promise<UpdateStatusSnapshot>;
getTutorialState(): Promise<TutorialState>;
updateTutorialState(patch: Partial<TutorialState>): Promise<TutorialState>;
```

### Engine methods (generated catalog only — no invented RPC)

| Domain | Methods |
| --- | --- |
| AI providers/settings | `ai.provider.catalog/list/create/update/delete/test`, `ai.credential.status/delete`, `ai.settings.get/update` |
| AI ops | `ai.grounding.preview`, `ai.run.*`, `ai.result.apply`, `ai.batch.*`, `ai.usage.query`, `ai.quality.*`, `ai.conversation.*` |
| Plugins | `plugin.list/get/inspect/install/enable/disable/uninstall`, `plugin.version.list/upgrade/rollback`, `plugin.bundled.list/apply`, `plugin.permission.*`, `plugin.aiAction.*`, `plugin.uiPanel.list` |
| External connectors | `externalConnector.catalog`, `externalConnector.profile.*`, `externalConnector.credential.*`, `externalConnector.invoke`, `externalConnector.checkpoint.get` |
| Collaboration | `collab.member.*`, `collab.lock.*`, `collab.presence.*`, `collab.assignment.*`, `collab.opLog.list` |

External connector **credential set** uses the generated Engine method (secret
in that request only). AI credentials never use generic invoke params.

### Pure helpers (authoritative names)

```ts
// state/ai-view.ts
function projectConnectorSchema(schema): SchemaProjection; // text|boolean|integer|select only
function buildCreateConfiguration(fields, form): Record<string, unknown>;
function mergeConfiguration(existing, fields, form): Record<string, unknown>; // unknown keys survive
function isRunTerminal(status): boolean;
function isBatchTerminal(status): boolean;
// listRunnableProfiles: enabled && credentialPresent (controller)

// state/ai-events.ts
// pure run-event reducer: ignore dup/out-of-order at/below committed sequence

// state/external-connector-request.ts
type ConnectorOperation =
  | "validateConfig" | "test" | "pull" | "push" | "poll" | "webhook";
function buildExternalConnectorRequest(binding, form, allowedOps): Result;
function mergeUnknownConfig(existing, overlay): Record<string, unknown>;

// state/product-settings-view.ts
function allowedUpdateCommands(snapshot: UpdateStatusSnapshot): ReadonlySet<UpdateCommand>;
function canRunUpdateCommand(snapshot, command): boolean;
function decodeRestorePreviewSummary(data: unknown):
  | { ok: true; preview: RestorePreviewSummary }
  | { ok: false; error: string };
```

---

## 3. Contracts

### 3.1 Routing and chrome

- After boot resolves: AI Control, Plugins, and Settings are always available.
- Collaboration chrome renders only when `resolveP4RouteContext` yields a
  project; the command still hard-rejects missing context.
- Entering any P4 surface from Workbench awaits `SaveCoordinator.flush()`.
  Flush failure: no destination load; Workbench draft/session retained.
- Return to Workbench: full Engine rehydrate of retained identity before the
  editor becomes interactive. AI apply may retain an `EditorMutationResult`
  projection for display, but Workbench state is never interactively patched
  on the AI surface alone.
- Context-inapplicable sections are **absent**, not dead disabled tabs
  (e.g. interactive/quality without document+segment; batch without project).
- No URL router and no global state library. No dead visible nav.

Chrome test IDs (icon-only + `aria-label` + `title`):

| testid | Visibility |
| --- | --- |
| `nav-ai-control` | after boot |
| `nav-plugins` | after boot |
| `nav-collaboration` | project context only |
| `nav-settings` | after boot |

### 3.2 Async ownership

Each P4 controller uses independent list/read and mutation counters tied to
app `featureGeneration`. Completions commit only when generation + owner +
op id remain current. Section change, surface leave, unmount, and reconnect
invalidate tokens. Polling/heartbeat cleanup stops timers only — it does not
cancel durable Engine work unless the user explicitly cancels.

Duplicate mutations are blocked in command code (`beginMutation` returns null
when the owner is already pending), not only via disabled buttons.

### 3.3 AI Control

- Catalog/profiles/settings/credentials load independently; post-mutation
  reloads authoritative projections (no optimistic status).
- Schema projection supports only `text` / `boolean` / `integer` / `select`.
  Unsupported fields → inventory stays visible; create/update disabled with
  explicit unsupported state (no raw JSON editor).
- Create configuration: only projected known keys. Update: merge from fetched
  `configuration` + overlay known fields (unknown keys preserved).
- Credentials: password only in the active control; write via
  `setAiCredential`; clear only on success; never localStorage/log/error
  interpolation/generic invoke.
- Runnable profiles: `enabled && credentialPresent`. Empty → honest
  empty/unavailable UI; start run/batch command rejects with domain error.
- Segment-dependent ops re-read revision after entry (never pre-flush capture).
- Interactive: conversation create binds returned ID; events page by
  `afterSequence`; terminal status from `ai.run.get`; apply uses exact run +
  segment revisions; failed apply retains proposal.
- Batch/usage: offset-aware loads with totals and Prev/Next; Engine
  counts/status only; no local terminal inference.
- Quality helpers are report-only (no QA/termbase/segment mutation RPC).

### 3.4 Plugins and external connectors

- Inventory lifecycle: inspect before local install/upgrade; picker cancel is
  no-op (no RPC). Mutations use current revisions; refresh installed, bundled,
  permissions, provider catalog, AI actions, UI panels, and connectors after
  successful lifecycle changes.
- Permissions: exact request id/revision/scopes; grant/deny/revoke require
  non-blank actor/reason; confirm dialog closes only after controller success.
- Plugin AI actions: supported schema only; hydrate bounded editor/project
  context; invoke/cancel/history; never auto-apply proposals.
- UI panels: issue session for active exact owner; mount only issued
  `translunar-plugin:` URL; revoke on close/nav/unmount/supersession/lifecycle;
  `onPluginPanelRevoked(pluginId|null)` unmounts matching/all; no parent
  postMessage bridge or generic `plugin.uiPanel.bridge.call` console.
- External connectors: join catalog to exact-owner plugin descriptors; missing
  schema is read-only. Credential slots are **declared-only** (no free-form
  slot inventing). Invoke uses one typed V1 builder for declared operations
  only; results show request ID/replay/checkpoint without claiming CAT project
  mutation.

### 3.5 Collaboration (local)

- Explicitly labeled local project state. No remote-sync, CRDT, or server-push
  claims.
- Presence: explicit start; immediate heartbeat; schedule before half TTL;
  stop timer on stop/section leave/surface leave/unmount.
- Assignments: complete with exact assignment revision; no cancel control
  (method absent).
- Op-log: page by `afterSequence`; Load more advances from max returned
  sequence; opaque payload is bounded inspection only (no domain cast).

### 3.6 Product Settings

- Locale: `updateShellSettings({ locale })` only; replace state from return;
  update `document.documentElement.lang`. System maps to `null`.
- Appearance: Settings UI over appearance-v1; Apply/Reset; storage write
  failure keeps in-memory applied palette and shows local persistence error.
- Data directory: select → validate → Cancel-first confirm → migrate; returned
  `activePath` is authority; success rehydrates identity / invalidates feature
  work as implemented.
- Backup: destination pick then create; cancel no-op.
- Restore: source → `previewRestore` → `decodeRestorePreviewSummary` →
  explicit confirm → `restoreWorkspaceBackup` with opaque token unchanged;
  failure retains preview; success cold-routes from authoritative shell/Engine.
- Updates: UI and command code both recheck `allowedUpdateCommands(snapshot)`;
  every success replaces snapshot.
- Tutorial: existing versioned state only via `getTutorialState` /
  `updateTutorialState` (reset/skip/complete).

### 3.7 Visual / a11y locks (inherited + P4)

- Phosphor only for new icons; no new renderer `lucide-react`.
- Solid surfaces only — no `backdrop-filter` / glass.
- Light default + advanced-brown seed `#765847`; dark uses solid theme tokens.
- Semantic success/warning/error tokens are theme-fixed and **never** derived
  from the accent seed.
- Cancel-first destructive dialogs; non-destructive Escape; reduced motion.
- No filler subtitles / guiding microcopy / “不是”-style contrast copy.
- No document-level horizontal overflow at 1250×744, 1680×942, 1920×1080.

---

## 4. Validation & Error Matrix

| Condition | Required behavior |
| --- | --- |
| Dirty Workbench → P4, flush fails | Stay Workbench; draft/session retained; no P4 load |
| P4 completion after leave/reconnect | Ignore stale completion |
| No enabled credential-backed profile | Honest empty/unavailable; no synthetic online result; start commands reject |
| Unsupported provider/connector schema | Visible inventory; mutations disabled; no raw JSON editor |
| AI apply conflict | Keep proposal/diff; typed error; no silent target patch |
| AI secret write fails | Keep password only in active control; no echo/log/storage |
| Plugin picker canceled | No inspect/install/upgrade RPC |
| Permission actor/reason blank | No decision RPC; dialog stays open |
| Permission decision fails | Dialog stays open with error |
| Plugin panel revoked/expired | Immediate unmount + safe status; no interactive stale iframe |
| External undeclared operation / bad JSON | No invoke; retain form + field error |
| External invoke success | Show safe result/replay/checkpoint; **no** project mutation claim |
| Collaboration without project | No chrome entry; command rejects |
| Lock held by another actor | Show Engine holder/expiry; no optimistic lock |
| Presence panel unmounts | Cancel timer; no late setState |
| Op-log unknown payload | Bounded inspect or omit; do not cast to member/lock domain |
| Locale update fails | Keep form + committed locale; typed error |
| Data/backup/restore picker cancel | No validation/mutation after cancel |
| Restore `data` malformed / hashesOk false / incompatible | No apply; retain preview error |
| Update command not in allowed set | No DesktopApi call |
| Appearance storage missing/malformed/unsupported version | Default light/`#765847`; boot continues |
| Appearance storage write fails | Keep applied in-memory palette; show local persistence error |

---

## 5. Good / Base / Bad Cases

- **Good:** From dirty Workbench open Settings after flush; change dark + custom
  seed; relaunch Electron; preference restores; Reset restores defaults.
- **Good:** Create schema-driven provider profile; set credential via
  `setAiCredential`; test; start run only against credential-backed enabled
  profiles; apply uses exact revisions; Back rehydrates Workbench.
- **Good:** Select plugin package → inspect dialog → confirm install → dependent
  projections refresh; open UI panel from issued URL; leave Plugins → session
  revoked.
- **Good:** Connector profile update preserves unknown configuration keys;
  credential slots only from declared descriptors; invoke shows checkpoint
  without mutating segments.
- **Good:** Collaboration on a real project: member/lock/presence/assignment/
  op-log round-trip with honest empty lists and local-state labeling.
- **Base:** No fixtures → honest empty plugin/provider/connector states; always-on
  reachability, appearance, collab, and non-destructive Settings paths still run.
- **Bad:** Optimistic plugin enabled flag, secret in `localStorage` or generic
  invoke, raw JSON config editor, presence of dead “Coming soon” tabs, stuffing
  theme into `updateShellSettings`, auto-applying AI proposals, inventing remote
  collab sync, mounting a plugin iframe without an issued session URL.

---

## 6. Tests Required

### Pure / unit

- Appearance: default, dark/custom persist, malformed/unsupported version,
  storage exception, reset, contrast thresholds, semantic independence from
  accent, DOM apply (`appearance.test.ts`)
- Schema merge / event sequence / terminal guards (`ai-view`, `ai-events`)
- External connector builder + undeclared op + unknown config merge
- Restore preview decoder + update command matrix (`product-settings-view`)
- P4 route context / collaboration visibility (`p4-route-context`)
- Collab cursor/heartbeat/availability guards (`collab-view`)

### Controller / integration

- Fake DesktopApi deferred completions for stale navigation/reconnect
- Flush-before each P4 enter; Collaboration gating; Back rehydrate
- AI credential lifecycle, runnable-profile filter, offset paging for
  runs/batch/usage, apply retention on conflict
- Plugin inspect-before-mutate, permission dialog success-only close, panel
  revoke paths, connector unknown-key update + declared credential slots
- Locale exact patch; restore token pass-through; update command guards

### Real-Engine E2E (`p4-ai-plugins-settings.spec.ts`)

**Always-on:**

- Reach AI / Plugins / Collaboration (with project) / Settings sections
- Local collab smoke where project exists
- Appearance dark/custom persistence across relaunch + reset/malformed recovery
- Locale / update / tutorial reachability; data/backup/restore picker-cancel
  non-destructive paths
- No console/page errors; three viewports no horizontal overflow

**Fixture-gated** (explicit `test.skip` with reason; do not skip always-on):

| Env | Deep path |
| --- | --- |
| `TRANSLUNAR_P4_LOOPBACK_AI=1` | credential → grounding → run/apply → usage |
| `TRANSLUNAR_P4_PLUGIN_FIXTURE=1` | install/permission/panel |
| `TRANSLUNAR_P4_CONNECTOR_FIXTURE=1` | profile/credential/invoke/checkpoint |

P0–P3 Playwright suites remain green in the rebuild matrix. Fixture absence is
residual risk, not pass evidence for skipped deep flows.

Static audit:

```text
rg -n "backdrop-filter|-webkit-backdrop-filter|lucide-react" apps/desktop/src/renderer
```

---

## 7. Wrong vs Correct

### Appearance and shell settings

#### Wrong

```ts
await desktop.updateShellSettings({
  locale: "zh-CN",
  theme: "dark", // not on ShellLocalePreferencePatch
  accentSeed: "#112233",
});
localStorage.setItem("theme", "dark"); // unversioned ad-hoc key
```

#### Correct

```ts
await desktop.updateShellSettings({ locale: selected }); // locale only
writeAppearancePreference({ version: 1, theme: "dark", accentSeed: "#112233" });
applyAppearance(preference, document.documentElement);
```

### Secrets and credentials

#### Wrong

```ts
await invoke("ai.credential.set", { profileId, secret }); // not a generic path
localStorage.setItem("ai-secret", secret);
console.log("credential", secret);
```

#### Correct

```ts
await desktop.setAiCredential(profileId, secretFromPasswordControl);
// clear control only after success; reload ai.credential.status
```

### Plugin panel session

#### Wrong

```tsx
<iframe src={contribution.fallbackUrl} /> // not issued
// leave surface without revoke
```

#### Correct

```ts
const session = await desktop.issuePluginPanelSession({
  pluginId,
  contributionId,
  revision,
});
// mount only session.url; on close/nav/unmount:
await desktop.revokePluginPanelSession(session.sessionId);
```

### External connector invoke

#### Wrong

```ts
await invoke("externalConnector.invoke", {
  request: JSON.parse(userRawJson), // arbitrary JSON console
});
// then patch segment rows from connector result
```

#### Correct

```ts
const built = buildExternalConnectorRequest(binding, form, declaredOps);
if (!built.ok) return showFieldError(built.error);
const result = await invoke("externalConnector.invoke", { request: built.request });
// display requestId / replayed / checkpoint only — no CAT project mutation
```

### Config merge

#### Wrong

```ts
configuration: { ...formOnlyKnownFields } // drops unknown Engine keys
```

#### Correct

```ts
configuration: mergeConfiguration(existingProfile.configuration, fields, form);
// create path: buildCreateConfiguration(fields, form)
```

---

## Residual notes (closeout)

- Deep fixture-gated AI/plugin/connector E2E and some deferred controller suites
  may remain thin when env fixtures are unset. Always-on gates and product
  completeness of shipped surfaces are required; skipped deep cases are not
  reinterpreted as passed.
- Custom title-bar chrome is maintained under the Electron workbench window-
  chrome contract, not as a P4 surface deliverable.
